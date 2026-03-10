/**
 * Telegram webhook handler.
 * Sprint 4.1 — full implementation via Grammy.js.
 * Stub only.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

export async function handleTelegramWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await reply.code(200).send({ ok: true });

  // TODO: Sprint 4.1 — route to Grammy bot handler
  logger.info({ body: request.body }, 'Telegram webhook received — stub');
}
