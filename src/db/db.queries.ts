/**
 * DB queries — all parameterized SQL in one place.
 * All queries use pg parameterized $1, $2... syntax — no string concatenation.
 * Sprint 1.2 / 3.1 / 3.2
 */
import pg from 'pg';
import { pool, withTransaction } from './db.js';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DbUser = {
    id: string;
    whatsapp_number: string | null;
    telegram_id: string | null;
    is_blocked: boolean;
    block_reason: string | null;
};

export type DbTransaction = {
    id: string;
    user_id: string;
    breet_transaction_id: string | null;
    asset_amount: string;
    fiat_amount: string;
    locked_rate: string;
    raw_breet_rate: string;
    service_margin: string;
    rate_locked_at: string;
    expires_at: string;
    deposit_address: string | null;
    payout_bank_code: string | null;
    payout_account: string | null;
    payout_account_name: string | null;
    idempotency_key: string;
    status: string;
    failure_reason: string | null;
    settled_rate: string | null;
    settled_fiat_amount: string | null;
};

export type CreateTransactionParams = {
    userId: string;
    assetAmount: number;
    fiatAmount: number;
    lockedRate: number;
    rawBreetRate: number;
    serviceMargin: number;
    rateLocketAt: Date;
    expiresAt: Date;
    payoutBankCode: string;
    payoutAccount: string;
    payoutAccountName: string;
};

// ─── Users ────────────────────────────────────────────────────────────────────

export async function createOrFindUser(
    channel: 'whatsapp' | 'telegram',
    identifier: string,
): Promise<DbUser> {
    const col = channel === 'telegram' ? 'telegram_id' : 'whatsapp_number';

    const result = await pool.query<DbUser>(
        `INSERT INTO users (${col})
     VALUES ($1)
     ON CONFLICT (${col}) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
        [identifier],
    );

    return result.rows[0]!;
}

export async function getUserById(userId: string): Promise<DbUser | null> {
    const result = await pool.query<DbUser>(
        'SELECT * FROM users WHERE id = $1',
        [userId],
    );
    return result.rows[0] ?? null;
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function createTransaction(
    params: CreateTransactionParams,
): Promise<DbTransaction> {
    const result = await pool.query<DbTransaction>(
        `INSERT INTO transactions
       (user_id, asset_amount, fiat_amount, locked_rate, raw_breet_rate,
        service_margin, rate_locked_at, expires_at,
        payout_bank_code, payout_account, payout_account_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')
     RETURNING *`,
        [
            params.userId,
            params.assetAmount,
            params.fiatAmount,
            params.lockedRate,
            params.rawBreetRate,
            params.serviceMargin,
            params.rateLocketAt,
            params.expiresAt,
            params.payoutBankCode,
            params.payoutAccount,
            params.payoutAccountName,
        ],
    );
    return result.rows[0]!;
}
export async function getActiveTransaction(userId: string): Promise<DbTransaction | null> {
    const result = await pool.query<DbTransaction>(
        `SELECT * FROM transactions
     WHERE user_id = $1
       AND status IN ('PENDING', 'AWAITING_DEPOSIT', 'CONFIRMING', 'PROCESSING')
     ORDER BY created_at DESC
     LIMIT 1`,
        [userId],
    );
    return result.rows[0] ?? null;
}

export async function getTransactionById(txId: string): Promise<DbTransaction | null> {
    const result = await pool.query<DbTransaction>(
        'SELECT * FROM transactions WHERE id = $1',
        [txId],
    );
    return result.rows[0] ?? null;
}

export async function getTransactionByDepositAddress(
    depositAddress: string,
): Promise<DbTransaction | null> {
    const result = await pool.query<DbTransaction>(
        'SELECT * FROM transactions WHERE deposit_address = $1',
        [depositAddress],
    );
    return result.rows[0] ?? null;
}

export async function getTransactionByBreetId(
    breetTransactionId: string,
): Promise<DbTransaction | null> {
    const result = await pool.query<DbTransaction>(
        'SELECT * FROM transactions WHERE breet_transaction_id = $1',
        [breetTransactionId],
    );
    return result.rows[0] ?? null;
}

export async function updateTransactionStatus(
    txId: string,
    status: string,
    extra: Partial<{
        breetTransactionId: string;
        depositAddress: string;
        failureReason: string;
        settledRate: number;
        settledFiatAmount: number;
    }> = {},
): Promise<void> {
    await withTransaction(async (client) => {
        await client.query(
            `UPDATE transactions
       SET status = $1,
           breet_transaction_id = COALESCE($2, breet_transaction_id),
           deposit_address      = COALESCE($3, deposit_address),
           failure_reason       = COALESCE($4, failure_reason),
           settled_rate         = COALESCE($5, settled_rate),
           settled_fiat_amount  = COALESCE($6, settled_fiat_amount),
           updated_at           = NOW()
       WHERE id = $7`,
            [
                status,
                extra.breetTransactionId ?? null,
                extra.depositAddress ?? null,
                extra.failureReason ?? null,
                extra.settledRate ?? null,
                extra.settledFiatAmount ?? null,
                txId,
            ],
        );
    });
}

// ─── Volume checking ──────────────────────────────────────────────────────────

export async function getUserDailyVolumeNGN(userId: string): Promise<number> {
    const result = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(fiat_amount), 0) AS total
     FROM transactions
     WHERE user_id = $1
       AND status IN ('AWAITING_DEPOSIT', 'CONFIRMING', 'PROCESSING', 'COMPLETED')
       AND created_at >= NOW() - INTERVAL '24 hours'`,
        [userId],
    );
    return parseFloat(result.rows[0]?.total ?? '0');
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function writeAuditLog(
    event: string,
    actor: 'user' | 'bot' | 'breet' | 'system',
    opts: {
        transactionId?: string | undefined;
        userId?: string | undefined;
        payload?: Record<string, unknown> | undefined;
        client?: pg.PoolClient | undefined;
    } = {},
): Promise<void> {
    const query = `
    INSERT INTO audit_log (transaction_id, user_id, event, actor, payload)
    VALUES ($1, $2, $3, $4, $5)`;
    const values = [
        opts.transactionId ?? null,
        opts.userId ?? null,
        event,
        actor,
        opts.payload ? JSON.stringify(opts.payload) : null,
    ];

    if (opts.client) {
        await opts.client.query(query, values);
    } else {
        await pool.query(query, values);
    }
}

// ─── Webhook idempotency ──────────────────────────────────────────────────────

export async function isWebhookProcessed(eventId: string): Promise<boolean> {
    const result = await pool.query(
        'SELECT 1 FROM processed_webhooks WHERE event_id = $1',
        [eventId],
    );
    return (result.rowCount ?? 0) > 0;
}

export async function markWebhookProcessed(
    eventId: string,
    client: pg.PoolClient,
): Promise<void> {
    await client.query(
        'INSERT INTO processed_webhooks (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [eventId],
    );
}

export async function saveFailedWebhook(
    eventId: string | null,
    payload: unknown,
    error: string,
): Promise<void> {
    try {
        await pool.query(
            'INSERT INTO failed_webhooks (event_id, payload, error) VALUES ($1, $2, $3)',
            [eventId, JSON.stringify(payload), error],
        );
    } catch (err) {
        // Don't let the dead letter save fail silently crash the flow
        logger.error({ err, eventId }, 'Failed to save to failed_webhooks');
    }
}
