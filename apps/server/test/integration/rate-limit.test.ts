import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Phase 4 — the rate limiter actually blocks abuse. Rate limits are effectively off
 * under test so other suites can drive many requests; here we force a low ceiling via
 * RATE_LIMIT_MAX BEFORE importing the app, so the limiter engages. This keeps the
 * suite fast (a handful of requests) while proving the protection is wired to the
 * real routes, not mocked. The override is unset immediately after import so it can't
 * leak to other files.
 */
process.env.RATE_LIMIT_MAX = '3';

const { buildApp } = await import('../../src/app.js');
const { pool } = await import('../../src/db/pool.js');

delete process.env.RATE_LIMIT_MAX;

async function dbReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const available = await dbReachable();
const suite = available ? describe : describe.skip;
if (!available) {
  console.warn('[integration] Postgres not reachable — skipping rate-limit tests.');
  await pool.end().catch(() => {});
}

suite('Rate limiting blocks excessive requests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns 429 once the credential-endpoint ceiling is exceeded', async () => {
    // Login is chosen so no DB writes are needed; wrong creds return 401 until the
    // limiter trips, then 429 regardless of credentials.
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'password123' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt()).statusCode);

    // With max=3, the 4th and 5th requests in the window must be rejected with 429.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
