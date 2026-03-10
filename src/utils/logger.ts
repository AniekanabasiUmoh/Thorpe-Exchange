import pino from 'pino';
import { env } from '../config/env.js';

const redactPaths = [
  'DATABASE_URL',
  'REDIS_URL',
  'BREET_API_KEY',
  'BREET_WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN',
  'SENTRY_DSN',
  // Request/response fields
  'req.headers.authorization',
  'req.headers["x-twilio-signature"]',
  'req.headers["x-breet-signature"]',
  'body.accountNumber',
  'body.payout_account',
  'payload.accountNumber',
  'payload.payout_account',
];

const baseOptions = {
  level: env.NODE_ENV === 'production' ? ('info' as const) : ('debug' as const),
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  base: { env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger =
  env.NODE_ENV !== 'production'
    ? pino({
        ...baseOptions,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      })
    : pino(baseOptions);

export type Logger = typeof logger;

/**
 * Create a child logger with consistent context fields.
 * Use this inside request handlers and services.
 */
export function createChildLogger(context: {
  requestId?: string;
  userId?: string;
  step?: string;
  event?: string;
}) {
  return logger.child(context);
}
