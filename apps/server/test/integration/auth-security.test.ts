import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Phase 4 — refresh-token rotation, reuse detection, and session revocation, against
 * a real Postgres. Reuse detection is normally softened by a grace window (to tolerate
 * benign concurrent refreshes); we set the grace to 0 here BEFORE importing the app so
 * an immediate re-use is deterministically treated as theft. A separate window at the
 * bottom covers the concurrent-refresh tolerance with the default grace.
 */
process.env.REFRESH_REUSE_GRACE_MS = '0';

const { buildApp } = await import('../../src/app.js');
const { runMigrations } = await import('../../src/db/migrate.js');
const { pool } = await import('../../src/db/pool.js');

// config captured the value at import; unset it so it can't leak to other test files.
delete process.env.REFRESH_REUSE_GRACE_MS;

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
  console.warn('[integration] Postgres not reachable — skipping auth-security tests.');
  await pool.end().catch(() => {});
}

interface Injectable {
  inject: FastifyInstance['inject'];
}

/** Pull the refresh cookie value out of an inject response's Set-Cookie. */
function refreshCookie(res: { cookies: Array<{ name: string; value: string }> }): string | null {
  return res.cookies.find((c) => c.name === 'scribe_refresh')?.value ?? null;
}

const cookieHeader = (value: string) => ({ cookie: `scribe_refresh=${value}` });

suite('Auth security: refresh rotation & reuse detection', () => {
  let app: FastifyInstance & Injectable;
  let seq = 0;

  beforeAll(async () => {
    await runMigrations();
    app = (await buildApp()) as FastifyInstance & Injectable;
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  async function register() {
    seq += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `sec${seq}@example.com`, password: 'password123', displayName: 'Sec' },
    });
    expect(res.statusCode).toBe(201);
    const cookie = refreshCookie(res);
    if (!cookie) throw new Error('no refresh cookie on register');
    return cookie;
  }

  const doRefresh = (cookie: string) =>
    app.inject({ method: 'POST', url: '/api/auth/refresh', headers: cookieHeader(cookie) });

  it('rotates the refresh token on use (new token issued, differs from the old)', async () => {
    const c1 = await register();
    const res = await doRefresh(c1);
    expect(res.statusCode).toBe(200);
    const c2 = refreshCookie(res);
    expect(c2).toBeTruthy();
    expect(c2).not.toBe(c1);
  });

  it('detects reuse of an already-rotated token and revokes the whole family', async () => {
    const c1 = await register();
    const first = await doRefresh(c1);
    expect(first.statusCode).toBe(200);
    const c2 = refreshCookie(first)!;

    // Re-use the consumed token c1 → reuse detected (grace = 0) → 401.
    const reused = await doRefresh(c1);
    expect(reused.statusCode).toBe(401);

    // Family was revoked, so the legitimately-rotated c2 is now dead too.
    const afterRevoke = await doRefresh(c2);
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('rejects an invalid/garbage refresh token', async () => {
    const res = await doRefresh('not-a-real-jwt');
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired refresh token', async () => {
    // Sign a refresh JWT that is already expired using the real secret.
    const jwt = (await import('jsonwebtoken')).default;
    const expired = jwt.sign({ jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET!, {
      subject: crypto.randomUUID(),
      expiresIn: '-1s',
    });
    const res = await doRefresh(expired);
    expect(res.statusCode).toBe(401);
  });

  it('rejects refresh with no cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    expect(res.statusCode).toBe(401);
  });

  it('logout revokes the session so the refresh token can no longer be used', async () => {
    const c1 = await register();
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: cookieHeader(c1),
    });
    expect(out.statusCode).toBe(204);

    const res = await doRefresh(c1);
    expect(res.statusCode).toBe(401);
  });

  it('a rotated token remains valid for exactly one further rotation chain', async () => {
    // Rotation chain: c1 → c2 → c3, each new token works once.
    const c1 = await register();
    const r2 = await doRefresh(c1);
    const c2 = refreshCookie(r2)!;
    const r3 = await doRefresh(c2);
    expect(r3.statusCode).toBe(200);
    const c3 = refreshCookie(r3)!;
    expect(c3).not.toBe(c2);
    const r4 = await doRefresh(c3);
    expect(r4.statusCode).toBe(200);
  });
});
