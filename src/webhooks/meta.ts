/**
 * WhatsApp (Meta/Twilio) webhook handler.
 * Sprint 4.2 — full implementation.
 * Stub only.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

export async function handleMetaWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await reply.code(200).send({ ok: true });

  // TODO: Sprint 4.2 — route to WhatsApp handler
  logger.info('Meta/WhatsApp webhook received — stub');
}
