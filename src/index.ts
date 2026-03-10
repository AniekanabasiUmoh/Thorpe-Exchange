import 'dotenv/config';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectWithRetry, pool } from './db/db.js';
import { handleBreetWebhook } from './webhooks/breet.js';
import { handleTelegramWebhook } from './webhooks/telegram.js';
import { handleMetaWebhook } from './webhooks/meta.js';

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

// Dev simulator endpoints (disabled in production)
if (env.NODE_ENV !== 'production') {
  app.post('/dev/simulate/deposit', async (_request, reply) => {
    // TODO: Sprint 2.2 — fire fake DEPOSIT_CONFIRMED event
    return reply.send({ message: 'Deposit simulation — stub' });
  });

  app.post('/dev/simulate/payout', async (_request, reply) => {
    // TODO: Sprint 2.2 — fire fake PAYOUT_COMPLETED event
    return reply.send({ message: 'Payout simulation — stub' });
  });
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

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, `Server listening on port ${env.PORT}`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void start();
