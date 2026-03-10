/**
 * Telegram webhook handler — Sprint 4.1
 *
 * Receives updates from Telegram's servers.
 * Grammy handles all update parsing, session management, and routing.
 *
 * Security: Telegram sends a secret_token header we verify before processing.
 */
import { timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Update } from 'grammy/types';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getBotInstance } from '../bot/telegram/index.js';

export async function handleTelegramWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Verify Telegram webhook secret header
  const secretHeader = request.headers['x-telegram-bot-api-secret-token'] as string | undefined;

  if (env.TELEGRAM_WEBHOOK_SECRET) {
    let isValid = false;
    if (secretHeader) {
      try {
        isValid = timingSafeEqual(Buffer.from(secretHeader), Buffer.from(env.TELEGRAM_WEBHOOK_SECRET));
      } catch {
        isValid = false;
      }
    }

    if (!isValid) {
      logger.warn({ ip: request.ip }, 'Telegram webhook: invalid secret token — rejected');
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
  } else if (env.NODE_ENV === 'production') {
    // env.ts .refine() prevents boot without this secret in production,
    // but defend in depth — never accept unsigned updates on live traffic.
    logger.error('TELEGRAM_WEBHOOK_SECRET not set in production — rejecting update');
    await reply.code(401).send({ error: 'Unauthorized' });
    return;
  } else {
    logger.warn({ ip: request.ip }, 'Telegram webhook: no secret configured (dev mode) — accepting');
  }

  // Acknowledge receipt immediately — Grammy processes async
  await reply.code(200).send({ ok: true });

  const bot = getBotInstance();
  if (!bot) {
    logger.error('Telegram webhook received but bot is not initialized');
    return;
  }

  // Let Grammy handle the update
  try {
    await bot.handleUpdate(request.body as Update);
  } catch (err) {
    logger.error({ err }, 'Grammy handleUpdate error');
  }
}
