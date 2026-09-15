import { afterEach, describe, expect, it } from 'vitest';
import { assertTestDatabase, databaseNameOf } from './db-config.js';

/**
 * The guard that prevents the truncating integration suite from ever wiping a
 * non-test (development/production) database — the root cause of "I lose my account
 * after every change". These are pure, DB-free assertions.
 */
describe('test database guard', () => {
  const prev = process.env.ALLOW_NONTEST_DB;
  afterEach(() => {
    if (prev === undefined) delete process.env.ALLOW_NONTEST_DB;
    else process.env.ALLOW_NONTEST_DB = prev;
  });

  it('extracts the database name from a connection URL', () => {
    expect(databaseNameOf('postgres://u:p@host:5433/scribe_test')).toBe('scribe_test');
    expect(databaseNameOf('postgres://u:p@host:5432/scribe')).toBe('scribe');
  });

  it('allows a database whose name looks like a test database', () => {
    expect(() => assertTestDatabase('postgres://u:p@host:5433/scribe_test')).not.toThrow();
  });

  it('refuses a non-test database (prevents wiping dev data)', () => {
    delete process.env.ALLOW_NONTEST_DB;
    expect(() => assertTestDatabase('postgres://u:p@host:5432/scribe')).toThrow(
      /does not look like/,
    );
  });

  it('can be overridden deliberately with ALLOW_NONTEST_DB=1', () => {
    process.env.ALLOW_NONTEST_DB = '1';
    expect(() => assertTestDatabase('postgres://u:p@host:5432/scribe')).not.toThrow();
  });
});
