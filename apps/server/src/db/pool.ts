import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

/**
 * Single shared connection pool. The backend must not assume Postgres is
 * instantly available (docker-compose starts them together), so callers use
 * {@link waitForDatabase} at startup and the pool retries transient failures.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Prevent an unhandled 'error' event on idle clients from crashing the process.
pool.on('error', (err) => {
  console.error('Unexpected idle Postgres client error:', err.message);
});

export type Db = pg.Pool;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Application-level readiness: poll `SELECT 1` with capped exponential backoff.
 * This is the reliable readiness mechanism (not arbitrary sleeps); the compose
 * healthcheck for Postgres is a complementary, coarser gate.
 */
export async function waitForDatabase(
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const retries = opts.retries ?? 15;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastErr = err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 5_000);

      console.warn(`Database not ready (attempt ${attempt}/${retries}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error(
    `Database unreachable after ${retries} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** Lightweight health probe used by GET /ready. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
