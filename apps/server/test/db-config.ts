/**
 * Test-database resolution + safety guard.
 *
 * The integration suite TRUNCATEs every table before each test (users … CASCADE),
 * which is correct for a disposable test database and catastrophic for the
 * DEVELOPMENT database. Historically the test default pointed at the same database
 * name as development (`scribe`), so running `pnpm test` against the dev Postgres
 * wiped real accounts, documents and memberships — the "I have to register again
 * after every change" symptom. The fix is a DISTINCT test database plus a guard that
 * refuses to run the destructive suite against anything that does not look like one.
 *
 * The default targets the docker-compose Postgres on its host port (5433, per
 * .env → POSTGRES_PORT) but a separate database (`scribe_test`), so development data
 * in `scribe` is never touched. Override with DATABASE_URL for other setups.
 */
export const DEFAULT_TEST_DATABASE_URL =
  'postgres://scribe:scribe_dev_password@localhost:5433/scribe_test';

/** The database URL the tests will use (explicit override wins over the default). */
export function resolveTestDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/** The database name from a postgres connection URL (e.g. "scribe_test"). */
export function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/**
 * Throw unless `url` clearly points at a TEST database. This is the safety net that
 * prevents the truncating integration suite from ever destroying a non-test (i.e.
 * development or production) database. Set ALLOW_NONTEST_DB=1 to consciously override.
 */
export function assertTestDatabase(url: string): void {
  const name = databaseNameOf(url);
  if (/test/i.test(name) || process.env.ALLOW_NONTEST_DB === '1') return;
  throw new Error(
    `Refusing to run integration tests against database "${name}": its name does not look like a ` +
      `test database. The suite TRUNCATEs all tables, which would destroy development data.\n` +
      `Point DATABASE_URL at a *_test database (default: ${DEFAULT_TEST_DATABASE_URL}), or set ` +
      `ALLOW_NONTEST_DB=1 to override deliberately.`,
  );
}
