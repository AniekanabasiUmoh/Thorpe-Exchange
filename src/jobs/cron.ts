/**
 * Background Jobs — Phase 6 Hardening
 *
 * Runs a cron schedule to find and expire abandoned transactions.
 * If a user locks a rate but never sends funds within the expires_at window,
 * this job marks the transaction EXPIRED and notifies the user.
 *
 * Multi-instance safety:
 *   - A Redis distributed lock (NX EX 90s) ensures only one instance runs
 *     the sweep per cycle, preventing duplicate notifications and audit entries.
 *   - SELECT ... FOR UPDATE SKIP LOCKED means concurrent instances skip rows
 *     already being processed, providing additional defence.
 */
import cron from 'node-cron';
import { Redis } from 'ioredis';
import { pool } from '../db/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getRedisClient } from '../db/redis.js';
import { DirectNotificationService } from '../services/notification.service.js';
import { fillTemplate, messages } from '../copy/messages.js';

const notificationService = new DirectNotificationService();

const LOCK_KEY = 'cron:lock:expire-transactions';
const LOCK_TTL_SECONDS = 90; // Must exceed worst-case job duration

export function startCronJobs() {
  // Run every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    const jobId = crypto.randomUUID();
    const log = logger.child({ jobId, jobName: 'expire-transactions' });

    // ── Acquire distributed lock ──────────────────────────────────────────────
    // NX = only set if not exists; EX = expire after LOCK_TTL_SECONDS
    let lockAcquired = false;
    try {
      const redis = getRedisClient();
      const result = await redis.set(LOCK_KEY, jobId, 'EX', LOCK_TTL_SECONDS, 'NX');
      lockAcquired = result === 'OK';
    } catch (err) {
      // If Redis is down, run anyway (single instance is safe; multi-instance risk is low)
      log.warn({ err }, 'Cron: could not acquire Redis lock — running without lock');
      lockAcquired = true;
    }

    if (!lockAcquired) {
      log.debug('Cron: lock held by another instance — skipping this cycle');
      return;
    }

    try {
      const client = await pool.connect();
      try {
        // FOR UPDATE SKIP LOCKED: rows being processed by a concurrent sweep are skipped,
        // providing a second layer of duplicate-processing prevention.
        const result = await client.query(`
          SELECT t.id, t.user_id, t.asset_amount, t.asset_ticker,
                 u.telegram_id, u.whatsapp_number, u.preferred_channel
          FROM transactions t
          JOIN users u ON t.user_id = u.id
          WHERE t.status = 'AWAITING_DEPOSIT'
            AND t.expires_at < NOW()
          FOR UPDATE OF t SKIP LOCKED
        `);

        if (result.rowCount === 0) return;

        log.info({ count: result.rowCount }, 'Found expired transactions to process');

        for (const row of result.rows) {
          await client.query('BEGIN');

          try {
            // Use RETURNING to confirm the row was actually updated (guards against
            // a race where the user's own cancel handler updated it first)
            const updated = await client.query(
              `UPDATE transactions
               SET status = 'EXPIRED', updated_at = NOW()
               WHERE id = $1 AND status = 'AWAITING_DEPOSIT'
               RETURNING id`,
              [row.id],
            );

            if ((updated.rowCount ?? 0) === 0) {
              // Another process already handled this row
              await client.query('ROLLBACK');
              log.info({ transactionId: row.id }, 'Cron: transaction already handled — skipped');
              continue;
            }

            await client.query(
              `INSERT INTO audit_log (transaction_id, user_id, event, actor)
               VALUES ($1, $2, 'EXPIRED_BY_CRON', 'system')`,
              [row.id, row.user_id],
            );

            await client.query('COMMIT');

            // Notify user — best effort, outside the DB transaction
            const channel = row.preferred_channel ?? (row.telegram_id ? 'telegram' : 'whatsapp');
            const identifier = (channel === 'telegram' ? row.telegram_id : row.whatsapp_number) as string | null;

            if (identifier) {
              await notificationService.send({
                userId: identifier,
                channel,
                message: {
                  text: fillTemplate(messages.rateExpiredCron, {
                    amount: row.asset_amount,
                    ticker: row.asset_ticker,
                  }),
                  parseMode: 'Markdown',
                },
              }).catch((err: unknown) => {
                log.error({ err, transactionId: row.id }, 'Cron: notification failed');
              });
            }

            log.info({ transactionId: row.id, userId: row.user_id }, 'Transaction expired by cron');

          } catch (err) {
            await client.query('ROLLBACK');
            log.error({ err, transactionId: row.id }, 'Failed to expire transaction in cron');
          }
        }
      } finally {
        client.release();
      }
    } catch (err) {
      log.error({ err }, 'Cron job failed to connect to DB');
    } finally {
      // Always release the lock so the next cycle can run
      try {
        const redis = getRedisClient();
        // Only delete if we still own it (value check prevents deleting a lock
        // acquired by a newer instance if ours ran longer than LOCK_TTL_SECONDS)
        const currentOwner = await redis.get(LOCK_KEY);
        if (currentOwner === jobId) {
          await redis.del(LOCK_KEY);
        }
      } catch (err) {
        log.warn({ err }, 'Cron: could not release Redis lock');
      }
    }
  });

  logger.info('Background cron jobs started');
}
