/**
 * Telegram Admin Commands Handler — Phase 7.1
 * Provides /admin functionality for bot operators.
 *
 * Security:
 *   - isAdmin() checks the caller's Telegram ID against TELEGRAM_ADMIN_ID
 *   - All commands are audit-logged via logger.info (Pino → structured logs)
 *   - Destructive commands (block/unblock) validate UUID format before DB access
 */
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getTodayVolumeStats, getFailedWebhooks, setBlockStatus } from '../../db/db.queries.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks if the user is authorized to run admin commands.
 */
export function isAdmin(telegramId: number): boolean {
  if (!env.TELEGRAM_ADMIN_ID) return false;
  return String(telegramId) === env.TELEGRAM_ADMIN_ID;
}

export async function handleAdminCommand(text: string, callerTelegramId: number): Promise<string> {
  const args = text.split(' ').slice(1);
  const subCommand = args[0]?.toLowerCase();

  // Audit every admin command attempt — provides accountability trail
  logger.info(
    { adminId: callerTelegramId, subCommand, args: args.slice(1) },
    'Admin command invoked',
  );

  switch (subCommand) {
    case 'metrics': {
      const stats = await getTodayVolumeStats();
      return `*Today\'s Metrics*\n\n` +
        `Volume: ₦${stats.totalVolume.toLocaleString()}\n` +
        `Profit: ₦${stats.profitMargin.toLocaleString()}\n` +
        `Active: ${stats.activeCount}`;
    }

    case 'failed': {
      const limit = Math.min(Number(args[1]) || 5, 20); // cap at 20
      const fails = await getFailedWebhooks(limit);
      if (fails.length === 0) return '✅ No failed webhooks recorded recently.';

      let msg = `*Last ${fails.length} Failed Webhooks*\n\n`;
      fails.forEach(f => {
        msg += `ID: \`${f.event_id}\`\nError: ${f.error}\nTime: ${f.created_at.toLocaleString()}\n\n`;
      });
      return msg;
    }

    case 'health': {
      let dbOk = false;
      let redisOk = false;

      // Check DB
      try {
        const { pool } = await import('../../db/db.js');
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        dbOk = true;
      } catch (err) {
        logger.error({ err }, 'Health check DB failed');
      }

      // Check Redis
      try {
        const { getRedisClient } = await import('../../db/redis.js');
        const redis = getRedisClient();
        await redis.ping();
        redisOk = true;
      } catch (err) {
        logger.error({ err }, 'Health check Redis failed');
      }

      const status = dbOk && redisOk ? '✅ *All Systems Operational*' : '⚠️ *System Degraded*';

      return `${status}\n\n` +
        `Database: ${dbOk ? '🟢 Connected' : '🔴 Offline'}\n` +
        `Redis: ${redisOk ? '🟢 Connected' : '🔴 Offline'}\n` +
        `Time: ${new Date().toISOString()}`;
    }

    case 'block': {
      const userId = args[1];
      if (!userId) return 'Usage: /admin block <user_uuid>';

      if (!UUID_REGEX.test(userId)) {
        logger.warn({ adminId: callerTelegramId, userId }, 'Admin block: invalid UUID format');
        return '❌ Invalid user ID format. Must be a UUID.';
      }

      const success = await setBlockStatus(userId, true);

      logger.info(
        { adminId: callerTelegramId, userId, action: 'block', success },
        'Admin: user block action',
      );

      return success
        ? `✅ User \`${userId}\` has been blocked.`
        : `❌ User not found.`;
    }

    case 'unblock': {
      const userId = args[1];
      if (!userId) return 'Usage: /admin unblock <user_uuid>';

      if (!UUID_REGEX.test(userId)) {
        logger.warn({ adminId: callerTelegramId, userId }, 'Admin unblock: invalid UUID format');
        return '❌ Invalid user ID format. Must be a UUID.';
      }

      const success = await setBlockStatus(userId, false);

      logger.info(
        { adminId: callerTelegramId, userId, action: 'unblock', success },
        'Admin: user unblock action',
      );

      return success
        ? `✅ User \`${userId}\` has been unblocked.`
        : `❌ User not found.`;
    }

    default:
      return `*Admin Panel*\n\n` +
        `/admin metrics — Today\'s volume & profit\n` +
        `/admin health — System uptime status\n` +
        `/admin failed [n] — Recent failed webhooks\n` +
        `/admin block <uuid> — Block a user\n` +
        `/admin unblock <uuid> — Unblock a user`;
  }
}
