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
import { sendToWhatsAppUser } from '../bot/whatsapp/sender.js';
import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';

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
        await sendToWhatsAppUser(userId, message);
      }
    } catch (err) {
      logger.error({ err, userId, channel }, 'Notification delivery failed');
      // Do not re-throw — notification failure must never crash the webhook pipeline
    }
  }
}

// ─── Queued (Sprint 3.2 BullMQ implementation) ───────────────────────────────
//
// BullMQ MUST NOT share a Redis connection with sessions/rate-limiter.
// It uses BLPOP blocking commands which block the connection for all other callers.
// We pass connection options (not a client instance) so BullMQ manages its own
// dedicated connections internally.

function getBullMQConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('notifications', { connection: getBullMQConnection() });
  }
  return _queue;
}

export class QueuedNotificationService implements NotificationService {
  async send(params: {
    userId: string;
    channel: 'whatsapp' | 'telegram';
    message: BotResponse;
  }): Promise<void> {
    await getQueue().add('send-notification', params, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 50 }, // keep last 50 for debugging
      removeOnFail: { count: 100 },
    });
    logger.debug({ userId: params.userId, channel: params.channel }, 'Queued notification');
  }
}

export function startNotificationWorker(): Worker {
  const worker = new Worker(
    'notifications',
    async (job: Job) => {
      const { userId, channel, message } = job.data as {
        userId: string;
        channel: 'whatsapp' | 'telegram';
        message: BotResponse;
      };
      // Exceptions thrown here are caught by BullMQ and trigger retries
      if (channel === 'telegram') {
        await sendToTelegramUser(userId, message);
      } else if (channel === 'whatsapp') {
        await sendToWhatsAppUser(userId, message);
      }
    },
    { connection: getBullMQConnection(), concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, userId: job?.data?.userId }, 'Notification job failed');
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id }, 'Notification job completed');
  });

  return worker;
}
