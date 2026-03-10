/**
 * Webhook signature verification middleware.
 * Sprint 5.1 — HMAC-SHA256 verification for Breet and Twilio.
 * Stub: passes all requests through in development.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

export async function verifyBreetSignature(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // TODO: Sprint 5.1 — implement HMAC-SHA256 signature verification
  await Promise.resolve();
  logger.debug('Breet signature verification — stub (passes all)');
}

export async function verifyTwilioSignature(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // TODO: Sprint 5.1 — implement Twilio signature verification
  await Promise.resolve();
  logger.debug('Twilio signature verification — stub (passes all)');
}
