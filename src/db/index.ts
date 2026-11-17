import { Pool } from 'pg';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runMigrations } from './migrate.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export async function initDb() {
  try {
    const client = await pool.connect();
    client.release();
    logger.info('Connected to PostgreSQL successfully.');

    // Execute automatic migrations
    await runMigrations();
  } catch (error: any) {
    logger.error({ err: error }, 'Database connection or migration failed');
    logger.warn('Please ensure PostgreSQL is running and check DATABASE_URL in backend/.env');
  }
}
