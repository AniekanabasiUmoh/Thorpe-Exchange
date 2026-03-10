/**
 * Notification service — sends messages to users via their channel.
 * Sprint 3.2 — BullMQ queue integration for reliable delivery.
 * Stub only.
 */
import type { BotResponse } from '../types/session.types.js';
import { logger } from '../utils/logger.js';

export interface NotificationService {
  send(params: {
    userId: string;
    channel: 'whatsapp' | 'telegram';
    message: BotResponse;
  }): Promise<void>;
}

// TODO: Sprint 3.2 — implement with BullMQ queue + retry logic
export class QueuedNotificationService implements NotificationService {
  async send(params: {
    userId: string;
    channel: 'whatsapp' | 'telegram';
    message: BotResponse;
  }): Promise<void> {
    // Stub: log only
    logger.info(
      { userId: params.userId, channel: params.channel },
      `[STUB] Notification: ${params.message.text.slice(0, 60)}...`,
    );
  }
}
