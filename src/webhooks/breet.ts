/**
 * Breet webhook handler.
 * Sprint 3.2 — full implementation.
 * Stub: acknowledges receipt only.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

export async function handleBreetWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Always 200 immediately — processing happens async
  await reply.code(200).send({ received: true });

  // TODO: Sprint 3.2 — implement full webhook processing pipeline
  logger.info({ body: request.body }, 'Breet webhook received — stub');
}
