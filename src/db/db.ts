import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected DB pool error');
});

/**
 * Connect to the database with exponential backoff.
 * Crashes the process if all retries are exhausted.
 */
export async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      logger.info('Database connected successfully');
      return;
    } catch (err) {
      const delay = RETRY_DELAY_MS * attempt;
      logger.warn({ attempt, delay, err }, 'DB connection failed, retrying...');

      if (attempt === MAX_RETRIES) {
        logger.fatal({ err }, 'DB connection failed after max retries. Exiting.');
        process.exit(1);
      }

      await sleep(delay);
    }
  }
}

/**
 * Run a block of SQL inside a transaction.
 * Automatically rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
