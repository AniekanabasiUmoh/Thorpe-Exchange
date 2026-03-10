/**
 * Admin Dashboard API Plugin
 *
 * Exposes metrics and transaction lists to the internal Next.js dashboard.
 * Secured by a static Admin API key (x-admin-key header).
 *
 * All routes require NODE_ENV-aware authentication. In production the
 * ADMIN_API_KEY env var must be set (enforced at startup via env.ts).
 */
import { timingSafeEqual } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminApiPlugin: FastifyPluginAsync = async (app) => {

    // ─── Authentication pre-handler ─────────────────────────────────────────────
    // Every request to /api/admin/* must carry the correct x-admin-key header.
    app.addHook('preHandler', async (request, reply) => {
        const providedKey = request.headers['x-admin-key'];

        // In development without a key configured, allow but warn.
        if (!env.ADMIN_API_KEY) {
            if (env.NODE_ENV === 'production') {
                // env.ts .refine() already prevents boot without ADMIN_API_KEY in production,
                // but defend in depth in case something slips through.
                logger.error('Admin API accessed without ADMIN_API_KEY configured in production');
                return reply.code(500).send({ error: 'Server misconfiguration' });
            }
            logger.warn({ url: request.url }, 'Admin API: no ADMIN_API_KEY set — unauthenticated (dev mode)');
            return; // allow in dev
        }

        let isValid = false;
        if (providedKey) {
            try {
                isValid = timingSafeEqual(Buffer.from(String(providedKey)), Buffer.from(env.ADMIN_API_KEY));
            } catch {
                isValid = false;
            }
        }

        if (!isValid) {
            logger.warn({ ip: request.ip, url: request.url }, 'Admin API: unauthorized access attempt');
            return reply.code(401).send({ error: 'Unauthorized' });
        }
    });

    // ─── GET /api/admin/metrics ─────────────────────────────────────────────────
    app.get('/metrics', async (_request, reply) => {
        const client = await pool.connect();
        try {
            const [volRes, profitRes, activeRes, blockedRes] = await Promise.all([
                client.query(`
                    SELECT COALESCE(SUM(settled_fiat_amount), 0) as total_volume
                    FROM transactions
                    WHERE status = 'COMPLETED' AND created_at::date = CURRENT_DATE
                `),
                client.query(`
                    SELECT COALESCE(SUM(service_margin), 0) as daily_profit
                    FROM transactions
                    WHERE status = 'COMPLETED' AND created_at::date = CURRENT_DATE
                `),
                client.query(`
                    SELECT COUNT(id) as active_count
                    FROM transactions
                    WHERE status IN ('AWAITING_DEPOSIT', 'PROCESSING')
                `),
                client.query(`
                    SELECT COUNT(id) as blocked_count
                    FROM users
                    WHERE is_blocked = true
                `),
            ]);

            return reply.send({
                totalVolumeNGN: Number(volRes.rows[0]?.total_volume ?? 0),
                dailyProfitNGN: Number(profitRes.rows[0]?.daily_profit ?? 0),
                activeSessions: Number(activeRes.rows[0]?.active_count ?? 0),
                blockedUsers: Number(blockedRes.rows[0]?.blocked_count ?? 0),
            });
        } finally {
            client.release();
        }
    });

    // ─── GET /api/admin/webhooks/failed ─────────────────────────────────────────
    app.get('/webhooks/failed', async (_request, reply) => {
        const { getFailedWebhooks } = await import('../db/db.queries.js');
        try {
            const fails = await getFailedWebhooks(50);
            return reply.send({ fails });
        } catch (err) {
            logger.error({ err }, 'Admin API: failed fetching webhooks');
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // ─── GET /api/admin/transactions ────────────────────────────────────────────
    // Cursor-based pagination: ?cursor=<ISO timestamp>&limit=<number>
    app.get<{ Querystring: { cursor?: string; limit?: string } }>('/transactions', async (request, reply) => {
        const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10), 1), 200);
        const cursor = request.query.cursor;

        const cursorClause = cursor ? `AND t.created_at < $2` : '';
        const params: (string | number)[] = cursor ? [limit, cursor] : [limit];

        const res = await pool.query(
            `SELECT t.id, t.user_id, t.status, t.asset_amount, t.asset_ticker,
                    t.settled_fiat_amount, t.created_at,
                    u.telegram_id, u.whatsapp_number
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             WHERE true ${cursorClause}
             ORDER BY t.created_at DESC
             LIMIT $1`,
            params,
        );

        const rows = res.rows.map(row => {
            // Mask PII
            const maskPII = (val: string | null) => {
                if (!val) return null;
                if (val.length < 6) return '***';
                return val.slice(0, 4) + '***' + val.slice(-2);
            };
            return {
                ...row,
                telegram_id: maskPII(row.telegram_id),
                whatsapp_number: maskPII(row.whatsapp_number),
            };
        });
        const nextCursor = rows.length === limit ? rows[rows.length - 1]?.created_at : null;

        return reply.send({ transactions: rows, nextCursor });
    });

    // ─── POST /api/admin/users/:userId/block ────────────────────────────────────
    app.post<{ Params: { userId: string }; Body: { isBlocked: boolean } }>(
        '/users/:userId/block',
        async (request, reply) => {
            const { userId } = request.params;
            const { isBlocked } = request.body;

            if (!UUID_REGEX.test(userId)) {
                return reply.code(400).send({ error: 'Invalid user ID format' });
            }

            if (typeof isBlocked !== 'boolean') {
                return reply.code(400).send({ error: 'isBlocked must be a boolean' });
            }

            const result = await pool.query(
                'UPDATE users SET is_blocked = $1 WHERE id = $2 RETURNING id',
                [isBlocked, userId],
            );

            if (result.rowCount === 0) {
                return reply.code(404).send({ error: 'User not found' });
            }

            logger.info(
                { adminIp: request.ip, userId, isBlocked },
                `Admin: user ${isBlocked ? 'blocked' : 'unblocked'}`,
            );

            return reply.send({ success: true, userId, isBlocked });
        },
    );

    // ─── GET /api/admin/system ─────────────────────────────────────────────────
    app.get('/system', async (_request, reply) => {
        let dbOk = false;
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            dbOk = true;
        } catch {
            dbOk = false;
        }

        return reply.send({
            uptimeSeconds: Math.floor(process.uptime()),
            database: dbOk ? 'online' : 'offline',
            nodeEnv: env.NODE_ENV,
        });
    });
};
