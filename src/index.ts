import 'dotenv/config';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectWithRetry, pool } from './db/db.js';
import { handleBreetWebhook, setNotificationService } from './webhooks/breet.js';
import { handleTelegramWebhook } from './webhooks/telegram.js';
import { handleMetaWebhook } from './webhooks/meta.js';
import { registerSimulatorRoutes } from './webhooks/simulator.js';
import { createTelegramBot, registerTelegramWebhook } from './bot/telegram/index.js';
import { DirectNotificationService } from './services/notification.service.js';
import { createBreetService } from './services/breet.service.js';
import { getSessionService } from './services/session.service.js';

const app = Fastify({
  logger: false, // We use our own Pino instance
  trustProxy: true,
  requestIdHeader: 'x-request-id',
  genReqId: () => crypto.randomUUID(),
});

// ─── Request logging ──────────────────────────────────────────────────────────

app.addHook('onRequest', async (request) => {
  request.log = logger.child({ requestId: request.id });
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

  // Never expose internal details to clients
  const statusCode = error.statusCode ?? 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  void reply.code(statusCode).send({
    error: isClientError ? error.message : 'Internal server error',
    statusCode,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async (_request, reply) => {
  let dbOk = false;
  let status: 'ok' | 'degraded' = 'ok';

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    dbOk = true;
  } catch {
    status = 'degraded';
  }

  return reply.code(status === 'ok' ? 200 : 503).send({
    status,
    ts: new Date().toISOString(),
    services: {
      db: dbOk ? 'ok' : 'down',
    },
  });
});

// Webhooks
app.post('/webhook/breet', handleBreetWebhook);
app.post('/webhook/telegram', handleTelegramWebhook);
app.post('/webhook/whatsapp', handleMetaWebhook);

// Dev simulator endpoints — disabled in production
if (env.NODE_ENV !== 'production') {
  registerSimulatorRoutes(app);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received, closing gracefully...');

  try {
    await app.close();
    await pool.end();
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
  // Connect to DB first — crashes on failure (intended)
  await connectWithRetry();

  // ── Wire up services ────────────────────────────────────────────────────────
  const breetService = createBreetService();
  const sessionService = getSessionService();
  const notificationService = new DirectNotificationService();

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

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, `Server listening on port ${env.PORT}`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void start();

