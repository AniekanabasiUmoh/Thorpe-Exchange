/**
 * WhatsApp (Twilio) Sender Utility
 *
 * Dispatches outbound messages to users via the Twilio Messaging API.
 */
import twilio from 'twilio';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { BotResponse } from '../../types/session.types.js';

let twilioClient: twilio.Twilio | null = null;

function getClient(): twilio.Twilio {
    if (!twilioClient) {
        if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
            throw new Error('Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in environment.');
        }
        twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    }
    return twilioClient;
}

/**
 * Sends a text message to a WhatsApp user via Twilio.
 * 
 * NOTE: The `BotResponse.keyboard` is currently flattened into text
 * since WhatsApp interactive buttons require pre-approved templates
 * or specific JSON structures which vary from Telegram's simple markup.
 * 
 * Once API keys are verified, we will enhance this to use WhatsApp
 * Interactive Messages (lists/buttons).
 *
 * @param toPhoneNumber The recipient's WhatsApp number (without 'whatsapp:' prefix)
 * @param text The message content, or a BotResponse
 */
export async function sendToWhatsAppUser(
    toPhoneNumber: string,
    message: string | BotResponse
): Promise<void> {
    try {
        let body: string | undefined;
        let contentSid: string | undefined;
        let contentVariables: Record<string, string> | undefined;

        if (typeof message === 'string') {
            body = message;
        } else {
            body = message.text;

            if (message.keyboard && Array.isArray(message.keyboard)) {
                // Twilio WhatsApp interactive messages (Buttons/Lists) require the Content API.
                // If templates are configured, dynamically map the keyboard to the template variables.
                if (env.TWILIO_BUTTON_TEMPLATE_SID && message.keyboard.flat().length <= 3) {
                    contentSid = env.TWILIO_BUTTON_TEMPLATE_SID;
                    // Standard Twilio Button Template usually maps {{1}} to body text, and subsequent variables to buttons
                    contentVariables = { '1': message.text };
                    message.keyboard.flat().forEach((btn, index) => {
                        contentVariables![String(index + 2)] = btn.text;
                    });
                } else if (env.TWILIO_LIST_TEMPLATE_SID && message.keyboard.flat().length > 3) {
                    contentSid = env.TWILIO_LIST_TEMPLATE_SID;
                    contentVariables = { '1': message.text };
                    message.keyboard.flat().forEach((btn, index) => {
                        contentVariables![String(index + 2)] = btn.text;
                    });
                } else {
                    // Temporary graceful fallback: append options as a numbered list
                    body += '\n\nPlease reply with your choice:';
                    message.keyboard.forEach((row: { text: string; payload?: string }[]) => {
                        row.forEach((btn: { text: string; payload?: string }) => {
                            body += `\n- ${btn.text}`;
                        });
                    });
                }
            }
        }

        // Just mock it if we don't have keys yet to prevent crashes
        if (!env.TWILIO_ACCOUNT_SID) {
            logger.info({ to: toPhoneNumber, body, contentSid }, '[MOCK] Sending outbound WhatsApp message');
            return;
        }

        const client = getClient();

        // Sender MUST have 'whatsapp:' prefix
        const fromNumber = env.TWILIO_WHATSAPP_NUMBER
            ? `whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`
            : 'whatsapp:+14155238886'; // Twilio default sandbox number

        // Recipient MUST have 'whatsapp:' prefix
        const to = `whatsapp:${toPhoneNumber.startsWith('+') ? toPhoneNumber : '+' + toPhoneNumber}`;

        const payload: any = {
            from: fromNumber,
            to,
        };

        if (contentSid) {
            payload.contentSid = contentSid;
            if (contentVariables) {
                payload.contentVariables = JSON.stringify(contentVariables);
            }
        } else {
            payload.body = body;
        }

        await client.messages.create(payload);

        logger.debug({ to, type: contentSid ? 'interactive' : 'text' }, 'Successfully sent WhatsApp message');

    } catch (err) {
        logger.error({ err, to: toPhoneNumber }, 'Failed to send outbound WhatsApp message');
        throw err; // Re-throw so NotificationService can track failures
    }
}
