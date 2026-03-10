/**
 * Simple migration runner — no ORM, raw SQL via pg.
 * Runs each migration file in order, tracks applied migrations in a migrations table.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new pg.Client({ connectionString: env.DATABASE_URL });

async function migrate() {
  await client.connect();

  // Ensure migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL      PRIMARY KEY,
      filename   TEXT        NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT id FROM _migrations WHERE filename = $1',
      [file],
    );

    if (rows.length > 0) {
      logger.info({ file }, 'Migration already applied, skipping');
      continue;
    }

    logger.info({ file }, 'Running migration...');
    const sql = await readFile(path.join(migrationsDir, file), 'utf-8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'Migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ file, err }, 'Migration failed, rolled back');
      process.exit(1);
    }
  }

  await client.end();
  logger.info('All migrations complete');
}

migrate().catch((err) => {
  logger.fatal({ err }, 'Migration runner crashed');
  process.exit(1);
});
