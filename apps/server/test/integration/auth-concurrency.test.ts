import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';

/**
 * Phase 4 — concurrent refresh must NOT be mistaken for token theft. With the
 * default (non-zero) grace window, two refreshes carrying the same cookie at once
 * (e.g. the WebSocket token callback racing an API 401 on app load) should both
 * succeed and the session should stay alive. The DB transaction (SELECT ... FOR
 * UPDATE) serializes them; the grace window keeps the second from revoking the family.
 */

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
  console.warn('[integration] Postgres not reachable — skipping auth-concurrency tests.');
  await pool.end().catch(() => {});
}

const refreshCookie = (res: { cookies: Array<{ name: string; value: string }> }) =>
  res.cookies.find((c) => c.name === 'scribe_refresh')?.value ?? null;

suite('Auth security: concurrent refresh tolerance', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  it('two simultaneous refreshes with the same cookie both succeed and keep the session alive', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'race@example.com', password: 'password123', displayName: 'Race' },
    });
    const c1 = refreshCookie(reg)!;

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `scribe_refresh=${c1}` },
      }),
      app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `scribe_refresh=${c1}` },
      }),
    ]);

    // Neither concurrent refresh is treated as theft.
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    // Both issued working tokens (same family), so the session survives the race.
    const ca = refreshCookie(a)!;
    const cb = refreshCookie(b)!;
    const followUp = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `scribe_refresh=${ca}` },
    });
    expect(followUp.statusCode).toBe(200);
    expect(cb).toBeTruthy();
  });
});
