import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResultDto, DocumentDto } from '@scribe/shared';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';

/** Probe Postgres once; if it is not reachable, skip the whole suite cleanly. */
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
  console.warn(
    '[integration] Postgres not reachable at DATABASE_URL — skipping integration tests.',
  );
  await pool.end().catch(() => {});
}

suite('HTTP API integration', () => {
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

  const registerUser = async (email: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123', displayName: 'Test User' },
    });
    return res;
  };

  const bearer = (r: { json: () => unknown }) =>
    `Bearer ${(r.json() as AuthResultDto).accessToken}`;

  describe('health', () => {
    it('GET /health reports ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('GET /ready reports the database is up', async () => {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe('ready');
    });
  });

  describe('auth', () => {
    it('registers a user, sets a refresh cookie, and assigns a color', async () => {
      const res = await registerUser('alice@example.com');
      expect(res.statusCode).toBe(201);
      const body = res.json() as AuthResultDto;
      expect(body.user.email).toBe('alice@example.com');
      expect(body.user.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(body.accessToken).toBeTruthy();
      expect(res.headers['set-cookie']).toBeTruthy();
      // Secret must never be exposed.
      expect(JSON.stringify(body)).not.toContain('password');
    });

    it('rejects duplicate email with 409', async () => {
      await registerUser('dup@example.com');
      const res = await registerUser('dup@example.com');
      expect(res.statusCode).toBe(409);
    });

    it('rejects invalid registration input with 400 + field details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'not-an-email', password: 'x', displayName: '' },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('validation_error');
    });

    it('logs in with correct credentials and rejects wrong ones generically', async () => {
      await registerUser('bob@example.com');
      const ok = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'bob@example.com', password: 'password123' },
      });
      expect(ok.statusCode).toBe(200);

      const bad = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'bob@example.com', password: 'wrong-password' },
      });
      expect(bad.statusCode).toBe(401);
    });

    it('returns the current user for a valid access token and 401 without one', async () => {
      const reg = await registerUser('carol@example.com');
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: bearer(reg) },
      });
      expect(me.statusCode).toBe(200);
      expect((me.json() as { email: string }).email).toBe('carol@example.com');

      const anon = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(anon.statusCode).toBe(401);
    });

    it('refreshes an access token using the refresh cookie', async () => {
      const reg = await registerUser('dave@example.com');
      const cookie = reg.headers['set-cookie'];
      expect(cookie).toBeTruthy();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : String(cookie) },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as AuthResultDto).accessToken).toBeTruthy();
    });

    it('rejects refresh without a cookie', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('documents', () => {
    it('creates, lists, fetches, and updates a document', async () => {
      const reg = await registerUser('erin@example.com');
      const auth = { authorization: bearer(reg) };

      const created = await app.inject({
        method: 'POST',
        url: '/api/documents',
        headers: auth,
        payload: { title: 'My Notes' },
      });
      expect(created.statusCode).toBe(201);
      const doc = created.json() as DocumentDto;
      expect(doc.title).toBe('My Notes');
      expect(doc.role).toBe('owner');
      expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);

      const list = await app.inject({ method: 'GET', url: '/api/documents', headers: auth });
      expect((list.json() as DocumentDto[]).length).toBe(1);

      const fetched = await app.inject({
        method: 'GET',
        url: `/api/documents/${doc.id}`,
        headers: auth,
      });
      expect(fetched.statusCode).toBe(200);

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/documents/${doc.id}`,
        headers: auth,
        payload: { title: 'Renamed' },
      });
      expect(updated.statusCode).toBe(200);
      expect((updated.json() as DocumentDto).title).toBe('Renamed');
    });

    it('defaults the title when none is given', async () => {
      const reg = await registerUser('frank@example.com');
      const created = await app.inject({
        method: 'POST',
        url: '/api/documents',
        headers: { authorization: bearer(reg) },
        payload: {},
      });
      expect((created.json() as DocumentDto).title).toBe('Untitled document');
    });

    it("returns 404 (not 403) for another user's document", async () => {
      const owner = await registerUser('owner@example.com');
      const created = await app.inject({
        method: 'POST',
        url: '/api/documents',
        headers: { authorization: bearer(owner) },
        payload: { title: 'Private' },
      });
      const doc = created.json() as DocumentDto;

      const intruder = await registerUser('intruder@example.com');
      const res = await app.inject({
        method: 'GET',
        url: `/api/documents/${doc.id}`,
        headers: { authorization: bearer(intruder) },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects unauthenticated document access with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/documents' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for a non-existent document id', async () => {
      const reg = await registerUser('grace@example.com');
      const res = await app.inject({
        method: 'GET',
        url: '/api/documents/00000000-0000-0000-0000-000000000000',
        headers: { authorization: bearer(reg) },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
