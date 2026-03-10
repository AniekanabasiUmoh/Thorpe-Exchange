/**
 * Notification service — Sprint 3.2 / 4.1
 *
 * Implements the NotificationService interface for the webhook handler.
 * Routes outbound messages to the correct channel (Telegram / WhatsApp).
 *
 * Split into two:
 *   DirectNotificationService — sends via bot API immediately (used after webhook events)
 *   QueuedNotificationService — stub for BullMQ queue (Sprint 3.2 full implementation)
 *
 * The webhook handler (breet.ts) uses DirectNotificationService.
 * Messages go out best-effort — failure is logged, never re-thrown.
 */
import type { BotResponse } from '../types/session.types.js';
import { logger } from '../utils/logger.js';
import { sendToTelegramUser } from '../bot/telegram/index.js';

export interface NotificationService {
  send(params: {
    userId: string;
    channel: 'whatsapp' | 'telegram';
    message: BotResponse;
  }): Promise<void>;
}

// ─── Direct (immediate) implementation ───────────────────────────────────────

export class DirectNotificationService implements NotificationService {
  async send(params: {
    userId: string;
    channel: 'whatsapp' | 'telegram';
    message: BotResponse;
  }): Promise<void> {
    const { userId, channel, message } = params;

    try {
      if (channel === 'telegram') {
        await sendToTelegramUser(userId, message);
        logger.debug({ userId, channel }, 'Notification sent');
      } else if (channel === 'whatsapp') {
        // TODO: Sprint 5.1 — Twilio WhatsApp implementation
        logger.info({ userId, channel }, '[STUB] WhatsApp notification — not yet implemented');
      }
    } catch (err) {
      logger.error({ err, userId, channel }, 'Notification delivery failed');
      // Do not re-throw — notification failure must never crash the webhook pipeline
    }
  }
}

// ─── Queued (stub — Sprint 3.2 full BullMQ implementation) ───────────────────

export class QueuedNotificationService implements NotificationService {
  async send(params: {
    userId: string;
    channel: 'whatsapp' | 'telegram';
    message: BotResponse;
  }): Promise<void> {
    // Stub: log only — BullMQ queue implementation in Sprint 3.2
    await Promise.resolve();
    logger.info(
      { userId: params.userId, channel: params.channel },
      `[STUB] Queued notification: ${params.message.text.slice(0, 60)}...`,
    );
  }
}
