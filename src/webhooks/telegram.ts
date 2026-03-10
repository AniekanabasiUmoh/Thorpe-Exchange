/**
 * Telegram webhook handler — Sprint 4.1
 *
 * Receives updates from Telegram's servers.
 * Grammy handles all update parsing, session management, and routing.
 *
 * Security: Telegram sends a secret_token header we verify before processing.
 */
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

  if (env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn({ secretHeader }, 'Telegram webhook: invalid secret token');
    await reply.code(401).send({ error: 'Unauthorized' });
    return;
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
