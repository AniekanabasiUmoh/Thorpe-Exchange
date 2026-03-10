import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),

  // Breet API
  BREET_MOCK: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  BREET_API_KEY: z.string().optional(),
  BREET_API_BASE_URL: z.string().url().default('https://api.breet.io'),
  BREET_WEBHOOK_SECRET: z.string().optional(),

  // Rate / Spread
  SPREAD_PERCENT: z.coerce.number().min(0).max(10).default(1.5),

  // Transaction limits
  MIN_TX_AMOUNT: z.coerce.number().positive().default(10),
  MAX_TX_AMOUNT: z.coerce.number().positive().default(10000),
  MAX_MESSAGES_PER_MINUTE: z.coerce.number().positive().default(5),
  MAX_TX_PER_DAY: z.coerce.number().positive().default(3),
  MAX_DAILY_VOLUME_NGN: z.coerce.number().positive().default(500000),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // WhatsApp / Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  TWILIO_BUTTON_TEMPLATE_SID: z.string().optional(),
  TWILIO_LIST_TEMPLATE_SID: z.string().optional(),

  // Support
  SUPPORT_CONTACT: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),

  // Admin API (required in production)
  ADMIN_API_KEY: z.string().optional(),

  // Admin dashboard CORS origin (required in production)
  ADMIN_DASHBOARD_URL: z.string().url().optional(),
}).refine(
  (data) => data.NODE_ENV !== 'production' || !!data.BREET_WEBHOOK_SECRET,
  { message: 'BREET_WEBHOOK_SECRET is required in production', path: ['BREET_WEBHOOK_SECRET'] },
).refine(
  (data) => data.NODE_ENV !== 'production' || !!data.TELEGRAM_WEBHOOK_SECRET,
  { message: 'TELEGRAM_WEBHOOK_SECRET is required in production', path: ['TELEGRAM_WEBHOOK_SECRET'] },
).refine(
  (data) => data.NODE_ENV !== 'production' || !!data.ADMIN_API_KEY,
  { message: 'ADMIN_API_KEY is required in production', path: ['ADMIN_API_KEY'] },
).refine(
  (data) => data.NODE_ENV !== 'production' || (data.ADMIN_API_KEY?.length ?? 0) >= 32,
  { message: 'ADMIN_API_KEY must be at least 32 characters in production', path: ['ADMIN_API_KEY'] },
);

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
