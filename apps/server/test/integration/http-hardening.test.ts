import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResultDto, DocumentDto } from '@scribe/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';

/**
 * Phase 4 — HTTP input/abuse hardening: request-body size cap, malformed-input
 * rejection, and role enforcement (viewer cannot mutate) at the REST layer. These
 * complement the cross-user 404 tests already in api.test.ts.
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
  console.warn('[integration] Postgres not reachable — skipping http-hardening tests.');
  await pool.end().catch(() => {});
}

suite('HTTP hardening', () => {
  let app: FastifyInstance;
  let seq = 0;

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

  async function newUser() {
    seq += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `h${seq}@example.com`, password: 'password123', displayName: 'H' },
    });
    const body = res.json() as AuthResultDto;
    return { id: body.user.id, token: body.accessToken };
  }

  it('rejects an over-limit request body with 413', async () => {
    const huge = 'x'.repeat(config.limits.maxHttpBodyBytes + 1024);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: `{"email":"a@b.com","password":"${huge}"}`,
    });
    expect(res.statusCode).toBe(413);
  });

  it('rejects malformed JSON with 400 (no stack trace leaked)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ not valid json',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).not.toMatch(/at Object|node_modules|SyntaxError:.*\//);
  });

  it('rejects an invalid document id (non-UUID) safely with 400', async () => {
    const { token } = await newUser();
    const res = await app.inject({
      method: 'GET',
      url: '/api/documents/not-a-uuid',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forbids a viewer from mutating a document via REST (403), while an editor can', async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const editor = await newUser();

    const created = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { title: 'Doc' },
    });
    const doc = created.json() as DocumentDto;

    await pool.query('INSERT INTO memberships (document_id, user_id, role) VALUES ($1,$2,$3)', [
      doc.id,
      viewer.id,
      'viewer',
    ]);
    await pool.query('INSERT INTO memberships (document_id, user_id, role) VALUES ($1,$2,$3)', [
      doc.id,
      editor.id,
      'editor',
    ]);

    const viewerWrite = await app.inject({
      method: 'PATCH',
      url: `/api/documents/${doc.id}`,
      headers: { authorization: `Bearer ${viewer.token}` },
      payload: { title: 'Hacked' },
    });
    expect(viewerWrite.statusCode).toBe(403);

    const editorWrite = await app.inject({
      method: 'PATCH',
      url: `/api/documents/${doc.id}`,
      headers: { authorization: `Bearer ${editor.token}` },
      payload: { title: 'Legit edit' },
    });
    expect(editorWrite.statusCode).toBe(200);
  });
});
