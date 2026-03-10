/**
 * Seed script — 2 test users, 3 mock transactions for local dev.
 * Sprint 1.2 will flesh this out fully.
 */
import { pool } from './db.js';
import { logger } from '../utils/logger.js';

async function seed() {
  logger.info('Seeding database...');

  // TODO: Sprint 1.2 — insert test users and mock transactions

  await pool.end();
  logger.info('Seed complete');
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed script crashed');
  process.exit(1);
});
