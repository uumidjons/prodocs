// Runs before any test module is imported, so the config singleton (evaluated at
// import time) sees a valid test environment. Integration tests additionally need
// a reachable Postgres at DATABASE_URL; they skip themselves when it is absent.
import { DEFAULT_TEST_DATABASE_URL } from './db-config.js';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_at_least_16_chars';
process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_at_least_16_chars';
process.env.JWT_ACCESS_TTL ??= '15m';
process.env.JWT_REFRESH_TTL ??= '30d';
// A DISTINCT test database (never the dev `scribe` DB): the integration suite
// truncates every table, so it must not point at development data. See db-config.ts.
process.env.DATABASE_URL ??= DEFAULT_TEST_DATABASE_URL;
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
// Isolate media uploads to an OS temp dir so tests never write binaries into the repo.
process.env.MEDIA_DIR ??= `${process.env.TMPDIR ?? '/tmp'}/scribe-media-test`;
// A small cap so the size-limit path is cheap to exercise in tests.
process.env.MEDIA_MAX_BYTES ??= String(256 * 1024);
