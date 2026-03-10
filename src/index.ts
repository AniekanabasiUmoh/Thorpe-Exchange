import 'dotenv/config';
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectWithRetry, pool } from './db/db.js';
import { handleBreetWebhook, setNotificationService } from './webhooks/breet.js';
import { handleTelegramWebhook } from './webhooks/telegram.js';
import { handleMetaWebhook } from './webhooks/meta.js';
import { registerSimulatorRoutes } from './webhooks/simulator.js';
import { createTelegramBot, registerTelegramWebhook } from './bot/telegram/index.js';
import { QueuedNotificationService, startNotificationWorker } from './services/notification.service.js';
import { createBreetService } from './services/breet.service.js';
import { getSessionService } from './services/session.service.js';

// ─── Initialize Sentry (must be earliest) ────────────────────────────────────
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
  logger.info('Sentry initialized');
}

import cors from '@fastify/cors';
import { adminApiPlugin } from './admin/api.js';

const app = Fastify({
  logger: false, // We use our own Pino instance
  // Only trust X-Forwarded-For when behind a real proxy (Railway/Nginx in production)
  trustProxy: env.NODE_ENV === 'production',
  requestIdHeader: 'x-request-id',
  genReqId: () => crypto.randomUUID(),
});

// Configure CORS — locked to dashboard origin in production
app.register(cors, {
  origin: env.NODE_ENV === 'production'
    ? (env.ADMIN_DASHBOARD_URL ?? false)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
});

// Register Admin API
app.register(adminApiPlugin, { prefix: '/api/admin' });

// ─── Request logging ──────────────────────────────────────────────────────────

app.addHook('onRequest', async (request) => {
  logger.info({ method: request.method, url: request.url, requestId: request.id }, 'Request received');
});

app.addHook('onResponse', async (request, reply) => {
  logger.info(
    { requestId: request.id, statusCode: reply.statusCode, method: request.method, url: request.url },
    'Request completed',
  );
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.setErrorHandler((error, request, reply) => {
  logger.error(
    { err: error, requestId: request.id },
    'Unhandled request error',
  );

  if (env.SENTRY_DSN) {
    Sentry.captureException(error);
  }

  // Never expose internal details to clients
  const err = error as { statusCode?: number; message?: string };
  const statusCode = err.statusCode ?? 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  void reply.code(statusCode).send({
    error: isClientError ? (err.message ?? 'Bad request') : 'Internal server error',
    statusCode,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async (_request, reply) => {
  let dbOk = false;
  let redisOk = false;

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    dbOk = true;
  } catch { /* db down */ }

  try {
    const { getRedisClient } = await import('./db/redis.js');
    await getRedisClient().ping();
    redisOk = true;
  } catch { /* redis down */ }

  const status = dbOk ? (redisOk ? 'ok' : 'degraded') : 'degraded';

  return reply.code(dbOk ? 200 : 503).send({
    status,
    ts: new Date().toISOString(),
    services: {
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
    },
  });
});

// Webhooks — tight body limit to prevent HMAC-amplification DoS
const WEBHOOK_BODY_LIMIT = 8192; // 8 KB — far above any real payload
app.post('/webhook/breet', { bodyLimit: WEBHOOK_BODY_LIMIT }, handleBreetWebhook);
app.post('/webhook/telegram', { bodyLimit: WEBHOOK_BODY_LIMIT }, handleTelegramWebhook);
app.post('/webhook/whatsapp', { bodyLimit: WEBHOOK_BODY_LIMIT }, handleMetaWebhook);

// Dev simulator endpoints — disabled in production
if (env.NODE_ENV !== 'production') {
  registerSimulatorRoutes(app);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let _notificationWorker: import('bullmq').Worker | null = null;

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received, closing gracefully...');

  try {
    if (_notificationWorker) await _notificationWorker.close();
    await app.close();
    await pool.end();
    try {
      const { getRedisClient } = await import('./db/redis.js');
      await getRedisClient().quit();
    } catch { /* Redis already gone — ignore */ }

    logger.info('Server and DB pool closed. Goodbye.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  // Connect to DB first — throws on failure, caught below
  try {
    await connectWithRetry();
  } catch (err) {
    logger.fatal({ err }, 'Database connection failed — cannot start server');
    if (env.SENTRY_DSN) Sentry.captureException(err);
    process.exit(1);
  }

  // ── Wire up services ────────────────────────────────────────────────────────
  const breetService = createBreetService();
  const sessionService = getSessionService();
  const notificationService = new QueuedNotificationService();

  const engineServices = { breetService, sessionService, notificationService };

  // ── Create Telegram bot (if token is configured) ────────────────────────────
  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      const bot = createTelegramBot(engineServices);

      // Wire notification service into the webhook handler
      setNotificationService(notificationService);

      // Register webhook URL with Telegram (idempotent)
      if (env.NODE_ENV === 'production') {
        const host = process.env['RAILWAY_STATIC_URL'] ?? process.env['APP_URL'];
        if (host) {
          await registerTelegramWebhook(bot, `https://${host}/webhook/telegram`);
        } else {
          logger.warn('No APP_URL set — Telegram webhook not registered. Set APP_URL env var.');
        }
      } else {
        logger.info('Development mode — Telegram in polling or manual webhook mode');
        // Webhook is set manually via ngrok / Railway preview URL
      }
    } catch (err) {
      logger.warn({ err }, 'Telegram bot failed to start — continuing without it');
    }
  } else {
    logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
  }

  // ── Create Twilio WhatsApp webhook ──────────────────────────────────────────
  const { createWhatsAppHandler } = await import('./bot/whatsapp/index.js');
  app.post('/webhook/twilio', { bodyLimit: WEBHOOK_BODY_LIMIT }, createWhatsAppHandler(engineServices));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, `Server listening on port ${env.PORT}`);

    // Start background jobs after server starts successfully
    const { startCronJobs } = await import('./jobs/cron.js');
    startCronJobs();
    _notificationWorker = startNotificationWorker();

  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    if (env.SENTRY_DSN) {
      const Sentry = await import('@sentry/node');
      Sentry.captureException(err);
    }
    process.exit(1);
  }
}

void start();

