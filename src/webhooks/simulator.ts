/**
 * Mock webhook simulator — Sprint 2.2
 *
 * Dev-only endpoints that fire fake Breet webhook events against our own
 * webhook handler, complete with a valid HMAC-SHA256 signature so the
 * verification middleware passes cleanly.
 *
 * Endpoints (disabled in production):
 *   POST /dev/simulate/deposit  — fires DEPOSIT_CONFIRMED
 *   POST /dev/simulate/payout   — fires PAYOUT_COMPLETED
 *   POST /dev/simulate/expire   — fires TRANSACTION_EXPIRED
 *   POST /dev/simulate/fail     — fires PAYOUT_FAILED
 *
 * Usage:
 *   curl -X POST http://localhost:3000/dev/simulate/deposit \
 *     -H "Content-Type: application/json" \
 *     -d '{"depositAddress": "TRC20_MOCK_ABCD1234", "amount": 100}'
 */
import { createHmac } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { BreetWebhookPayload, BreetWebhookEvent } from '../types/breet.types.js';

// The secret used to sign simulated webhooks — must match what verifyBreetSignature checks
const SIMULATOR_SECRET = env.BREET_WEBHOOK_SECRET ?? 'dev-simulator-secret';

// ─── HMAC signing ─────────────────────────────────────────────────────────────

function signPayload(payload: string): string {
  return createHmac('sha256', SIMULATOR_SECRET).update(payload).digest('hex');
}

// ─── Dispatch a fake event to our own webhook endpoint ────────────────────────

async function dispatchWebhook(
  event: BreetWebhookEvent,
  overrides: Partial<BreetWebhookPayload> = {},
): Promise<{ dispatched: boolean; eventId: string; signature: string }> {
  const eventId = `sim_${event}_${Date.now()}`;

  const payload: BreetWebhookPayload = {
    eventId,
    event,
    transactionId: `mock_tx_sim_${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...overrides,
  };

  const body = JSON.stringify(payload);
  const signature = signPayload(body);

  // Self-call — fire at our own /webhook/breet endpoint
  const webhookUrl = `http://localhost:${env.PORT}/webhook/breet`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-breet-signature': `sha256=${signature}`,
        'x-simulated': 'true',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });

    logger.info(
      { event, eventId, status: response.status },
      'Simulator: webhook dispatched',
    );

    return { dispatched: true, eventId, signature: `sha256=${signature}` };
  } catch (err) {
    logger.error({ event, eventId, err }, 'Simulator: webhook dispatch failed');
    return { dispatched: false, eventId, signature: `sha256=${signature}` };
  }
}

// ─── Request body types ───────────────────────────────────────────────────────

type SimulateDepositBody = {
  depositAddress?: string;
  transactionId?: string;
  amount?: number;
};

type SimulatePayoutBody = {
  transactionId?: string;
  nairaAmount?: number;
};

type SimulateExpireBody = {
  transactionId?: string;
  depositAddress?: string;
};

type SimulateFailBody = {
  transactionId?: string;
  reason?: string;
};

// ─── Route handlers ───────────────────────────────────────────────────────────

async function simulateDeposit(
  request: FastifyRequest<{ Body: SimulateDepositBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { depositAddress, transactionId, amount = 100 } = request.body ?? {};

  const result = await dispatchWebhook('DEPOSIT_CONFIRMED', {
    depositAddress: depositAddress ?? `TRC20_MOCK_${Date.now()}`,
    transactionId: transactionId ?? `mock_tx_sim_${Date.now()}`,
    amount,
  });

  await reply.send({
    ok: true,
    message: 'DEPOSIT_CONFIRMED event dispatched',
    ...result,
  });
}

async function simulatePayout(
  request: FastifyRequest<{ Body: SimulatePayoutBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { transactionId, nairaAmount = 152000 } = request.body ?? {};

  const result = await dispatchWebhook('PAYOUT_COMPLETED', {
    transactionId: transactionId ?? `mock_tx_sim_${Date.now()}`,
    nairaAmount,
  } as Partial<BreetWebhookPayload>);

  await reply.send({
    ok: true,
    message: 'PAYOUT_COMPLETED event dispatched',
    ...result,
  });
}

async function simulateExpire(
  request: FastifyRequest<{ Body: SimulateExpireBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { transactionId, depositAddress } = request.body ?? {};

  const result = await dispatchWebhook('TRANSACTION_EXPIRED', {
    transactionId: transactionId ?? `mock_tx_sim_${Date.now()}`,
    depositAddress: depositAddress ?? `TRC20_MOCK_${Date.now()}`,
  });

  await reply.send({
    ok: true,
    message: 'TRANSACTION_EXPIRED event dispatched',
    ...result,
  });
}

async function simulateFail(
  request: FastifyRequest<{ Body: SimulateFailBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { transactionId, reason = 'Bank declined transfer' } = request.body ?? {};

  const result = await dispatchWebhook('PAYOUT_FAILED', {
    transactionId: transactionId ?? `mock_tx_sim_${Date.now()}`,
    reason,
  } as Partial<BreetWebhookPayload>);

  await reply.send({
    ok: true,
    message: 'PAYOUT_FAILED event dispatched',
    ...result,
  });
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerSimulatorRoutes(app: FastifyInstance): void {
  app.post<{ Body: SimulateDepositBody }>('/dev/simulate/deposit', simulateDeposit);
  app.post<{ Body: SimulatePayoutBody }>('/dev/simulate/payout', simulatePayout);
  app.post<{ Body: SimulateExpireBody }>('/dev/simulate/expire', simulateExpire);
  app.post<{ Body: SimulateFailBody }>('/dev/simulate/fail', simulateFail);

  logger.info('Dev simulator routes registered: /dev/simulate/{deposit,payout,expire,fail}');
}
