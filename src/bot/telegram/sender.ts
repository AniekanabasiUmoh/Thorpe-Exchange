/**
 * Telegram notification sender — Sprint 4.1
 *
 * Converts a BotResponse (channel-agnostic) into Grammy API calls.
 * Used by both the conversation engine (direct reply) and the
 * notification service (async webhook-triggered messages).
 */
import { Bot, InlineKeyboard } from 'grammy';
import type { BotResponse, InlineKeyboard as AppInlineKeyboard } from '../../types/session.types.js';
import { logger } from '../../utils/logger.js';

/**
 * Send a BotResponse to a Telegram user.
 * Converts our InlineKeyboard type to Grammy's InlineKeyboard.
 */
export async function sendTelegramMessage(
    bot: Bot,
    chatId: string | number,
    response: BotResponse,
): Promise<void> {
    try {
        const parseMode = response.parseMode === 'HTML' ? 'HTML' : 'Markdown';

        if (response.keyboard?.type === 'inline') {
            const kb = buildInlineKeyboard(response.keyboard);
            await bot.api.sendMessage(chatId, response.text, {
                parse_mode: parseMode,
                reply_markup: kb,
            });
        } else if (response.keyboard?.type === 'reply') {
            // Reply keyboard — only used for simple yes/no prompts
            await bot.api.sendMessage(chatId, response.text, {
                parse_mode: parseMode,
                reply_markup: {
                    keyboard: response.keyboard.buttons.map((row) =>
                        row.map((label) => ({ text: label })),
                    ),
                    one_time_keyboard: response.keyboard.oneTime ?? true,
                    resize_keyboard: true,
                },
            });
        } else {
            await bot.api.sendMessage(chatId, response.text, {
                parse_mode: parseMode,
            });
        }
    } catch (err) {
        logger.error({ err, chatId }, 'Failed to send Telegram message');
        throw err;
    }
}

function buildInlineKeyboard(kb: AppInlineKeyboard): InlineKeyboard {
    const grammy = new InlineKeyboard();
    for (const row of kb.buttons) {
        for (const btn of row) {
            grammy.text(btn.text, btn.callbackData);
        }
        grammy.row();
    }
    return grammy;
}
