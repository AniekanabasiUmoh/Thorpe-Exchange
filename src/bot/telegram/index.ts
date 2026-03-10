/**
 * Telegram bot — Grammy.js setup — Sprint 4.1
 *
 * Architecture:
 *   - Webhook mode in production (Telegram POSTs to /webhook/telegram)
 *   - Grammy middleware handles message → engine → reply
 *
 * Security:
 *   - Telegram webhook secret header verified before processing (in telegram.ts)
 *   - Rate limiting is handled at the Fastify layer (upstream)
 *   - User ID is always the Telegram chat ID (string for consistency with WhatsApp)
 *
 * Note: We do NOT use Grammy sessions — all session state lives in Redis
 * via the engine. Grammy is purely a routing layer.
 */
import { Bot, Context } from 'grammy';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { createEngine, type EngineServices } from '../engine.js';
import { sendTelegramMessage } from './sender.js';
import type { BotResponse } from '../../types/session.types.js';

// ─── Singleton bot instance ───────────────────────────────────────────────────

let _bot: Bot<Context> | null = null;

/** Returns the bot singleton after createTelegramBot() has been called. */
export function getBotInstance(): Bot<Context> | null {
  return _bot;
}

export function createTelegramBot(services: EngineServices): Bot<Context> {
  if (_bot) return _bot;

  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot will not start');
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new Bot<Context>(token);
  const engine = createEngine(services);

  // ── Log every update ─────────────────────────────────────────────────────────

  bot.use(async (ctx, next) => {
    logger.debug(
      { updateId: ctx.update.update_id, type: Object.keys(ctx.update)[1] },
      'Telegram update received',
    );
    await next();
  });

  // ── /start command ───────────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });
    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text: '/start',
    });
    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── /help command ────────────────────────────────────────────────────────────

  bot.command('help', async (ctx) => {
    await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });
    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text: 'help',
    });
    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── /cancel command ──────────────────────────────────────────────────────────

  bot.command('cancel', async (ctx) => {
    await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });
    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text: 'cancel',
    });
    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── /status command ──────────────────────────────────────────────────────────

  bot.command('status', async (ctx) => {
    await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });
    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text: 'status',
    });
    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── /support command ─────────────────────────────────────────────────────────

  bot.command('support', async (ctx) => {
    await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });
    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text: 'support',
    });
    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── /admin command (Phase 7.1) ───────────────────────────────────────────────

  bot.command('admin', async (ctx) => {
    const { isAdmin, handleAdminCommand } = await import('./admin.js');
    if (!isAdmin(ctx.chat.id)) {
      // Silently ignore or return standard bot response
      return;
    }

    // Pass the full text and caller ID (for audit logging inside the handler)
    const replyText = await handleAdminCommand(ctx.message?.text ?? '', ctx.chat.id);
    await sendTelegramMessage(bot, ctx.chat.id, { text: replyText });
  });

  // ── Inline keyboard callbacks ────────────────────────────────────────────────

  bot.on('callback_query:data', async (ctx) => {
    // Answer callback immediately to remove loading spinner on the button
    await ctx.answerCallbackQuery();

    const chatId = String(ctx.chat?.id ?? ctx.from.id);
    if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });

    const response = await engine.handleMessage({
      userId: chatId,
      channel: 'telegram',
      text: '',
      callbackData: ctx.callbackQuery.data,
    });

    await sendTelegramMessage(bot, parseInt(chatId, 10), response);
  });

  // ── Text messages (main conversation flow) ───────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? '';

    // Slash commands are handled above — skip them here to avoid double firing
    if (text.startsWith('/')) return;

    if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => { });

    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text,
    });

    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── Unsupported message types (stickers, photos, etc.) ───────────────────────

  bot.on('message', async (ctx) => {
    // Only fires if no more-specific handler matched above
    // (i.e., user sent non-text like a photo or file)
    const response = await engine.handleMessage({
      userId: String(ctx.chat.id),
      channel: 'telegram',
      text: '',
    });
    await sendTelegramMessage(bot, ctx.chat.id, response);
  });

  // ── Error handler ────────────────────────────────────────────────────────────

  bot.catch(async (err) => {
    const ctx = err.ctx;
    logger.error(
      { err: err.error, updateId: ctx.update.update_id },
      'Grammy bot error',
    );

    // Try to send a graceful error message back to the user
    try {
      const chatId = ctx.chat?.id;
      if (chatId) {
        await ctx.api.sendMessage(
          chatId,
          '⚠️ Something went wrong. Please try again or type /help.',
        );
      }
    } catch {
      // Suppress any send errors inside the error handler
    }
  });

  _bot = bot;
  logger.info('Telegram bot created');
  return bot;
}

/**
 * Register the Telegram webhook URL with Telegram's servers.
 * Called once at startup after the express server is listening.
 */
export async function registerTelegramWebhook(
  bot: Bot<Context>,
  webhookUrl: string,
): Promise<void> {
  const webhookInfo = await bot.api.getWebhookInfo();

  if (webhookInfo.url === webhookUrl) {
    logger.info({ webhookUrl }, 'Telegram webhook already set — skipping');
    return;
  }

  const opts: Parameters<typeof bot.api.setWebhook>[1] = {
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  };

  if (env.TELEGRAM_WEBHOOK_SECRET) {
    opts.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  }

  await bot.api.setWebhook(webhookUrl, opts);
  logger.info({ webhookUrl }, 'Telegram webhook registered');
}

/**
 * Push an outbound message to a Telegram user.
 * Used by DirectNotificationService for async webhook-triggered messages.
 */
export async function sendToTelegramUser(
  chatId: string,
  response: BotResponse,
): Promise<void> {
  if (!_bot) {
    logger.error('sendToTelegramUser called before bot was created');
    return;
  }
  await sendTelegramMessage(_bot, parseInt(chatId, 10), response);
}
