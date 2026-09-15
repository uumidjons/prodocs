import pg from 'pg';
import { assertTestDatabase, databaseNameOf, resolveTestDatabaseUrl } from './db-config.js';

/**
 * Vitest global setup — runs ONCE before any test worker. Two jobs:
 *   1. Guard: refuse to run the destructive integration suite against a database
 *      that does not look like a test database (prevents wiping dev/prod data).
 *   2. Convenience: create the test database if it is missing, so `pnpm test` works
 *      against a fresh docker-compose Postgres without a manual `createdb` step.
 *      Table creation is left to each suite's `runMigrations()` (idempotent).
 *
 * If Postgres is unreachable we do nothing: the integration suites detect that and
 * skip themselves (see each `dbReachable()` check), while pure unit tests still run.
 */
export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  // Ensure workers (which read process.env at import time) use the resolved URL.
  process.env.DATABASE_URL = url;

  assertTestDatabase(url);
  await ensureDatabaseExists(url);
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const dbName = databaseNameOf(url);
  // Defensive: dbName comes from our own config, but it is interpolated into DDL
  // (identifiers cannot be parameterized), so reject anything unexpected.
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`Unsafe test database name: "${dbName}"`);
  }

  // Connect to the always-present maintenance database to check/create ours.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch {
    // Postgres not reachable — integration suites will skip; nothing to create.
    return;
  }
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}
