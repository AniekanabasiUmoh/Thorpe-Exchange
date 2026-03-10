/**
 * WhatsApp (Twilio) Webhook Router — Phase 5 Scaffolding
 *
 * This receives inbound messages from Twilio, verifies the Twilio signature,
 * and passes the parsed text to the core conversation engine.
 */
import twilio from 'twilio';
import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { EngineServices, createEngine } from '../engine.js';
import { sendToWhatsAppUser } from './sender.js';

// Define the incoming Twilio POST body
interface TwilioWebhookBody {
  SmsMessageSid: string;
  NumMedia: string;
  ProfileName: string;
  SmsSid: string;
  WaId: string;
  SmsStatus: string;
  Body: string;
  To: string;
  NumSegments: string;
  ReferralNumMedia: string;
  MessageSid: string;
  AccountSid: string;
  From: string;
  ApiVersion: string;
}

export function createWhatsAppHandler(engineServices: EngineServices) {
  const engine = createEngine(engineServices);

  // We bind the handler to the engine so we can pass it to Fastify routes
  return async function handleTwilioWebhook(
    request: FastifyRequest<{ Body: TwilioWebhookBody }>,
    reply: FastifyReply
  ) {
    const body = request.body;
    const signature = request.headers['x-twilio-signature'] as string;
    const twilioUrl = `https://${request.headers.host}${request.url}`;

    // ── Security Check ──────────────────────────────────────────────────────────
    // Only run Twilio validator in production, or if TWILIO_AUTH_TOKEN is strictly set
    if (env.TWILIO_AUTH_TOKEN) {
      const isValid = twilio.validateRequest(
        env.TWILIO_AUTH_TOKEN,
        signature,
        twilioUrl,
        body as unknown as Record<string, string>
      );

      if (!isValid) {
        logger.warn({ ip: request.ip }, 'Invalid Twilio WhatsApp signature');
        return reply.code(403).send('Forbidden');
      }
    }

    // ── Ack to Twilio quickly ──────────────────────────────────────────────────
    // Twilio requires a fast 2xx response, usually TwiML. To defer actual replies
    // to outbound API calls (which our engine will do asynchronously), we send an
    // empty <Response></Response> block.
    const twiml = new twilio.twiml.MessagingResponse();
    reply.type('text/xml').send(twiml.toString());

    // ── Process Message ────────────────────────────────────────────────────────
    try {
      // Extract the user's plain phone number from the "whatsapp:+1234567890" format
      const userId = (body.From || '').replace('whatsapp:', '');

      // Only process text (ignore images/audio for now)
      if (body.NumMedia !== '0') {
        logger.info({ userId }, 'Received unsupported media on WhatsApp');
        await sendToWhatsAppUser(userId, 'I can only understand text messages right now. Please type your answer.');
        return;
      }

      // Route to engine
      logger.info({ userId }, 'Processing incoming WhatsApp message');

      const response = await engine.handleMessage({
        userId,
        channel: 'whatsapp',
        text: body.Body || ''
      });

      // Dispatch outbound response back to user
      await sendToWhatsAppUser(userId, response.text);

    } catch (err) {
      logger.error({ err }, 'Failed to process WhatsApp webhook');
    }
  };
}
