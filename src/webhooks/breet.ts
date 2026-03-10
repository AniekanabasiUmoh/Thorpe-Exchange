/**
 * Breet webhook handler — Sprint 3.2
 *
 * Security-critical code. Processes all Breet lifecycle events.
 *
 * Processing pipeline (always after 200 reply is sent):
 *   1. Verify HMAC-SHA256 signature
 *   2. Parse payload
 *   3. Check idempotency (duplicate suppression)
 *   4. Load transaction by deposit_address or breet_transaction_id
 *   5. Validate state transition is legal
 *   6. Atomic DB update + idempotency row insert
 *   7. Write audit log
 *   8. Enqueue user notification
 *   9. On DEPOSIT_CONFIRMED with expired rate → re-calculate settled amount
 *  10. On failure → save to failed_webhooks dead letter table
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { withTransaction } from '../db/db.js';
import {
  getTransactionByDepositAddress,
  getTransactionByBreetId,
  writeAuditLog,
  isWebhookProcessed,
  markWebhookProcessed,
  saveFailedWebhook,
  getUserById,
} from '../db/db.queries.js';
import { messages, fillTemplate } from '../copy/messages.js';
import type { BreetWebhookPayload } from '../types/breet.types.js';
import type { BotResponse } from '../types/session.types.js';
import type { NotificationService } from '../services/notification.service.js';
import { RateService } from '../services/rate.service.js';

// ─── Legal state transitions ──────────────────────────────────────────────────

const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  AWAITING_DEPOSIT: ['CONFIRMING', 'EXPIRED', 'FAILED'],
  CONFIRMING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
};

function isLegalTransition(currentStatus: string, nextStatus: string): boolean {
  return LEGAL_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

function eventToStatus(event: string): string {
  switch (event) {
    case 'DEPOSIT_CONFIRMED': return 'CONFIRMING';
    case 'PAYOUT_COMPLETED': return 'COMPLETED';
    case 'PAYOUT_FAILED': return 'FAILED';
    case 'TRANSACTION_EXPIRED': return 'EXPIRED';
    default: return '';
  }
}

// ─── HMAC Signature Verification ──────────────────────────────────────────────

function verifySignature(rawBody: string, signatureHeader: string): boolean {
  const secret = env.BREET_WEBHOOK_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      // env.ts .refine() prevents boot without this secret in production,
      // but defend in depth — never skip verification on live traffic.
      logger.error('BREET_WEBHOOK_SECRET not set in production — rejecting webhook');
      return false;
    }
    logger.warn('BREET_WEBHOOK_SECRET not set — skipping signature verification (dev only)');
    return true;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

let _notificationService: NotificationService | null = null;

export function setNotificationService(svc: NotificationService): void {
  _notificationService = svc;
}

export async function handleBreetWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Step 1: Return 200 immediately — processing is async
  await reply.code(200).send({ received: true });

  // All processing below must never throw back to Fastify
  void processWebhook(request).catch((err: unknown) => {
    logger.error({ err }, 'Unhandled error in webhook processing');
  });
}

async function processWebhook(request: FastifyRequest): Promise<void> {
  const rawBody = JSON.stringify(request.body);
  const signatureHeader = (request.headers['x-breet-signature'] as string) ?? '';

  // Step 2: Verify HMAC signature
  if (!verifySignature(rawBody, signatureHeader)) {
    logger.warn(
      { signature: signatureHeader },
      'Breet webhook rejected: invalid signature',
    );
    // Logged and dropped — no retry since this is a security rejection
    return;
  }

  const payload = request.body as BreetWebhookPayload;
  const { eventId, event, transactionId: breetTxId, depositAddress } = payload;

  logger.info({ eventId, event, breetTxId }, 'Breet webhook: processing');

  // Determine extra fields based on event type, declared outside transaction for later use
  let settledFiatAmount: number | undefined;
  let settledRate: number | undefined;
  let actualAssetAmount: number | undefined;

  try {
    // Step 3: Idempotency check
    if (await isWebhookProcessed(eventId)) {
      logger.info({ eventId }, 'Breet webhook: duplicate — silently ignored');
      return;
    }

    // Step 4: Load transaction
    const tx = depositAddress
      ? await getTransactionByDepositAddress(depositAddress)
      : await getTransactionByBreetId(breetTxId ?? '');

    if (!tx) {
      logger.error({ eventId, event, breetTxId, depositAddress }, 'Webhook: transaction not found');
      await saveFailedWebhook(eventId, payload, 'Transaction not found');
      return;
    }

    const nextStatus = eventToStatus(event);
    if (!nextStatus) {
      logger.warn({ event, eventId }, 'Webhook: unknown event type');
      return;
    }

    // Step 5: Validate state transition
    if (!isLegalTransition(tx.status, nextStatus)) {
      logger.error(
        { currentStatus: tx.status, nextStatus, event, txId: tx.id },
        'Webhook: illegal state transition — dropped',
      );
      await saveFailedWebhook(eventId, payload, `Illegal transition: ${tx.status} → ${nextStatus}`);
      return;
    }

    // Step 6 & 7: Atomic update + idempotency + audit — all in one transaction
    await withTransaction(async (client) => {
      // Mark webhook as processed (idempotency)
      await markWebhookProcessed(eventId, client);

      // On deposit confirmed: check if amount differs or rate has expired and recalculate
      if (event === 'DEPOSIT_CONFIRMED') {
        const expectedAssetAmount = parseFloat(tx.asset_amount);
        actualAssetAmount = payload.cryptoReceived !== undefined
          ? parseFloat(payload.cryptoReceived)
          : expectedAssetAmount;

        let rateToUse = parseFloat(tx.locked_rate);

        const now = new Date();
        const rateExpiredAt = new Date(tx.expires_at);
        const rateLockExpired = now > rateExpiredAt;

        if (rateLockExpired) {
          // Rate expired — honour the locked rate to avoid shortchanging the user.
          logger.warn(
            { txId: tx.id, settledRate: rateToUse, originalAmount: tx.asset_amount, actualAmount: actualAssetAmount, expiredAt: tx.expires_at, depositReceivedAt: now.toISOString() },
            'Webhook: RATE_LOCK_EXPIRED_AT_DEPOSIT — deposit arrived after rate window; honouring locked rate',
          );
        }

        // Calculate fiat equivalent using exact asset amount received
        settledRate = rateToUse;
        settledFiatAmount = actualAssetAmount * rateToUse;

        if (actualAssetAmount !== expectedAssetAmount) {
          logger.warn(
            { txId: tx.id, expected: expectedAssetAmount, received: actualAssetAmount },
            'Webhook: PARTIAL_OR_OVER_PAYMENT detected. Calculated fiat payout based strictly on actual received amount.',
          );
        }
      }

      // Failure reason from payload
      const failureReason = (payload as Record<string, unknown>)['reason'] as string | undefined;

      await client.query(
        `UPDATE transactions
         SET status              = $1,
             breet_transaction_id = COALESCE($2, breet_transaction_id),
             failure_reason      = COALESCE($3, failure_reason),
             settled_rate        = COALESCE($4, settled_rate),
             settled_fiat_amount = COALESCE($5, settled_fiat_amount),
             updated_at          = NOW()
         WHERE id = $6`,
        [
          nextStatus,
          breetTxId ?? null,
          failureReason ?? null,
          settledRate ?? null,
          settledFiatAmount ?? null,
          tx.id,
        ],
      );

      // Audit log
      await writeAuditLog(event, 'breet', {
        transactionId: tx.id,
        userId: tx.user_id,
        payload: { eventId, nextStatus, settledFiatAmount, settledRate, actualAssetAmount },
        client,
      });
    });

    logger.info({ txId: tx.id, event, nextStatus }, 'Breet webhook: processed successfully');

    // Mutate tx object with correctly finalized values so the notification prints accurately
    if (settledFiatAmount !== undefined) tx.settled_fiat_amount = String(settledFiatAmount);
    if (actualAssetAmount !== undefined) tx.asset_amount = String(actualAssetAmount);

    // Step 8: Notify user (best-effort — failure here must not unwind the DB commit)
    await notifyUser(tx, event, payload).catch((err: unknown) => {
      logger.error({ err, txId: tx.id, event }, 'Webhook: user notification failed');
    });

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, eventId, event }, 'Breet webhook: processing error');
    await saveFailedWebhook(eventId, payload, error);
  }
}

// ─── User notifications ───────────────────────────────────────────────────────

async function notifyUser(
  tx: { id: string; user_id: string; asset_amount: string; fiat_amount: string; payout_bank_code: string | null; payout_account: string | null; settled_fiat_amount: string | null },
  event: string,
  _payload: BreetWebhookPayload,
): Promise<void> {
  if (!_notificationService) return;

  const user = await getUserById(tx.user_id);
  if (!user) return;

  const channel = user.telegram_id ? 'telegram' : 'whatsapp';
  const channelId = (user.telegram_id ?? user.whatsapp_number) as string;

  let message: BotResponse | null = null;

  const naira = RateService.formatNGN(
    parseFloat(tx.settled_fiat_amount ?? tx.fiat_amount),
  );

  switch (event) {
    case 'DEPOSIT_CONFIRMED':
      message = {
        text: fillTemplate(messages.depositReceived, {
          amount: tx.asset_amount,
          naira,
        }),
        parseMode: 'Markdown',
      };
      break;

    case 'PAYOUT_COMPLETED': {
      const lastFour = (tx.payout_account ?? '****').slice(-4);
      message = {
        text: fillTemplate(messages.payoutCompleted, {
          naira,
          bankName: tx.payout_bank_code ?? 'your bank',
          lastFour,
        }),
        parseMode: 'Markdown',
      };
      break;
    }

    case 'TRANSACTION_EXPIRED':
      message = { text: messages.transactionExpired, parseMode: 'Markdown' };
      break;

    case 'PAYOUT_FAILED':
      message = { text: messages.genericError, parseMode: 'Markdown' };
      break;
  }

  if (message) {
    await _notificationService.send({ userId: channelId, channel, message });
  }
}
