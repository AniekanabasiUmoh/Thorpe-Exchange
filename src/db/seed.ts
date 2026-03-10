/**
 * Seed script — 2 test users, 3 mock transactions for local dev.
 * Safe to run multiple times (upserts on unique keys).
 */
import { pool, withTransaction } from './db.js';
import { logger } from '../utils/logger.js';

const NOW = new Date();
const TEN_MIN = 10 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;

async function seed() {
  logger.info('Seeding database...');

  await withTransaction(async (client) => {
    // ── Users ──────────────────────────────────────────────────────────────────

    // User 1: Telegram user (active, not blocked)
    const { rows: [user1] } = await client.query<{ id: string }>(`
      INSERT INTO users (telegram_id, preferred_channel)
      VALUES ($1, 'telegram')
      ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `, ['123456789']);

    // User 2: WhatsApp user (blocked — for testing blocked-user flow)
    const { rows: [user2] } = await client.query<{ id: string }>(`
      INSERT INTO users (whatsapp_number, preferred_channel, is_blocked, block_reason)
      VALUES ($1, 'whatsapp', true, 'Test blocked user')
      ON CONFLICT (whatsapp_number) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `, ['+2348000000001']);

    logger.info({ user1Id: user1?.id, user2Id: user2?.id }, 'Users seeded');

    if (!user1 || !user2) {
      throw new Error('Failed to seed users');
    }

    // ── Transactions ───────────────────────────────────────────────────────────

    // Tx 1: COMPLETED — happy path reference
    await client.query(`
      INSERT INTO transactions (
        user_id, breet_transaction_id,
        asset_amount, fiat_amount,
        locked_rate, raw_breet_rate, service_margin,
        rate_locked_at, expires_at,
        deposit_address,
        payout_bank_code, payout_account, payout_account_name,
        status
      ) VALUES (
        $1, 'mock_breet_tx_001',
        100, 152000,
        1520, 1497.04, 2280,
        $2, $3,
        'TRC20_SEED_ADDR_001',
        '058', '0123456789', 'JOHN DOE',
        'COMPLETED'
      )
      ON CONFLICT (breet_transaction_id) DO NOTHING
    `, [user1.id, NOW, new Date(NOW.getTime() + TEN_MIN)]);

    // Tx 2: AWAITING_DEPOSIT — for testing deposit flow + expiry cron
    await client.query(`
      INSERT INTO transactions (
        user_id, breet_transaction_id,
        asset_amount, fiat_amount,
        locked_rate, raw_breet_rate, service_margin,
        rate_locked_at, expires_at,
        deposit_address,
        payout_bank_code, payout_account, payout_account_name,
        status
      ) VALUES (
        $1, 'mock_breet_tx_002',
        50, 76000,
        1520, 1497.04, 1140,
        $2, $3,
        'TRC20_SEED_ADDR_002',
        '044', '9876543210', 'JANE SMITH',
        'AWAITING_DEPOSIT'
      )
      ON CONFLICT (breet_transaction_id) DO NOTHING
    `, [user1.id, NOW, new Date(NOW.getTime() + THIRTY_MIN)]);

    // Tx 3: EXPIRED — for testing the expired rate re-quote flow
    await client.query(`
      INSERT INTO transactions (
        user_id, breet_transaction_id,
        asset_amount, fiat_amount,
        locked_rate, raw_breet_rate, service_margin,
        rate_locked_at, expires_at,
        deposit_address,
        payout_bank_code, payout_account, payout_account_name,
        status,
        settled_rate, settled_fiat_amount,
        failure_reason
      ) VALUES (
        $1, 'mock_breet_tx_003',
        200, 300000,
        1500, 1477.83, 4434,
        $2, $3,
        'TRC20_SEED_ADDR_003',
        '033', '1122334455', 'TEST USER',
        'EXPIRED',
        1485, 297000,
        'Rate window expired before deposit was received'
      )
      ON CONFLICT (breet_transaction_id) DO NOTHING
    `, [user2.id, new Date(NOW.getTime() - THIRTY_MIN), new Date(NOW.getTime() - TEN_MIN)]);

    logger.info('Transactions seeded');

    // ── Audit log entries ──────────────────────────────────────────────────────

    // Fetch transaction IDs for audit log
    const { rows: txRows } = await client.query<{ id: string; breet_transaction_id: string }>(
      `SELECT id, breet_transaction_id FROM transactions WHERE breet_transaction_id IN ($1, $2, $3)`,
      ['mock_breet_tx_001', 'mock_breet_tx_002', 'mock_breet_tx_003'],
    );

    const txMap = Object.fromEntries(txRows.map((r) => [r.breet_transaction_id, r.id]));

    const auditEvents = [
      { txKey: 'mock_breet_tx_001', userId: user1.id, event: 'RATE_LOCKED',        actor: 'bot',    payload: { rate: 1520 } },
      { txKey: 'mock_breet_tx_001', userId: user1.id, event: 'DEPOSIT_RECEIVED',   actor: 'breet',  payload: { amount: 100 } },
      { txKey: 'mock_breet_tx_001', userId: user1.id, event: 'PAYOUT_COMPLETED',   actor: 'breet',  payload: { naira: 152000 } },
      { txKey: 'mock_breet_tx_002', userId: user1.id, event: 'RATE_LOCKED',        actor: 'bot',    payload: { rate: 1520 } },
      { txKey: 'mock_breet_tx_002', userId: user1.id, event: 'ADDRESS_GENERATED',  actor: 'system', payload: { address: 'TRC20_SEED_ADDR_002' } },
      { txKey: 'mock_breet_tx_003', userId: user2.id, event: 'RATE_LOCKED',        actor: 'bot',    payload: { rate: 1500 } },
      { txKey: 'mock_breet_tx_003', userId: user2.id, event: 'TRANSACTION_EXPIRED', actor: 'system', payload: { originalRate: 1500, settledRate: 1485 } },
    ];

    for (const e of auditEvents) {
      const txId = txMap[e.txKey];
      if (!txId) continue;
      await client.query(
        `INSERT INTO audit_log (transaction_id, user_id, event, actor, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [txId, e.userId, e.event, e.actor, JSON.stringify(e.payload)],
      );
    }

    logger.info('Audit log seeded');
  });

  await pool.end();
  logger.info('✅ Seed complete');
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed script crashed');
  process.exit(1);
});
