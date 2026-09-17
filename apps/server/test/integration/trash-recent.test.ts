import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResultDto, DocumentDto } from '@scribe/shared';
import { SYSTEM_TEMPLATES } from '@scribe/shared';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { seedSystemTemplates } from '../../src/modules/documents/templates.js';

/**
 * Trash (soft delete) + Recent (per-user last-opened) + Shared-with-me scoping
 * (task §2/§4/§5). Verifies each sidebar view returns exactly the right documents
 * and that Trash operations are owner-only and template-safe.
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
  console.warn('[integration] Postgres not reachable — skipping trash/recent tests.');
  await pool.end().catch(() => {});
}

const MEETING_NOTES = SYSTEM_TEMPLATES.find((t) => t.key === 'meeting-notes')!;

suite('Trash, Recent, and Shared views', () => {
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
    await seedSystemTemplates();
  });

  const register = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123', displayName: email.split('@')[0] },
    });
  const auth = (r: { json: () => unknown }) => r.json() as AuthResultDto;
  const bearer = (r: { json: () => unknown }) => `Bearer ${auth(r).accessToken}`;

  const createDoc = (token: string, body: object = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: { authorization: token },
      payload: body,
    });
  const listDocs = (token: string, view = 'mine') =>
    app.inject({
      method: 'GET',
      url: `/api/documents?view=${view}`,
      headers: { authorization: token },
    });
  const openDoc = (token: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: { authorization: token } });
  const trashDoc = (token: string, id: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}`,
      headers: { authorization: token },
    });
  const restoreDoc = (token: string, id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${id}/restore`,
      headers: { authorization: token },
    });
  const purgeDoc = (token: string, id: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}/permanent`,
      headers: { authorization: token },
    });
  const addMember = (token: string, docId: string, userId: string, role: string) =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/members`,
      headers: { authorization: token },
      payload: { userId, role },
    });
  const ids = (r: { json: () => unknown }) => (r.json() as DocumentDto[]).map((d) => d.id);

  describe('Recent', () => {
    it('lists documents the user has opened, newest first, and excludes unopened ones', async () => {
      const a = await register('r-a@example.com');
      const opened = (await createDoc(bearer(a), { title: 'Opened' })).json() as DocumentDto;
      const untouched = (await createDoc(bearer(a), { title: 'Untouched' })).json() as DocumentDto;

      // Opening (GET) marks it recent for this user.
      await openDoc(bearer(a), opened.id);

      const recent = ids(await listDocs(bearer(a), 'recent'));
      expect(recent).toContain(opened.id);
      expect(recent).not.toContain(untouched.id);
    });

    it('is scoped per-user: another user opening a shared doc does not add it to my Recent', async () => {
      const owner = await register('r-owner@example.com');
      const other = await register('r-other@example.com');
      const otherId = auth(other).user.id;
      const doc = (await createDoc(bearer(owner), { title: 'Shared' })).json() as DocumentDto;
      await addMember(bearer(owner), doc.id, otherId, 'editor');

      // The OTHER user opens it; the owner never did.
      await openDoc(bearer(other), doc.id);

      expect(ids(await listDocs(bearer(other), 'recent'))).toContain(doc.id);
      expect(ids(await listDocs(bearer(owner), 'recent'))).not.toContain(doc.id);
    });

    it('never includes system templates', async () => {
      const a = await register('r-tpl@example.com');
      // Opening a template document id is not possible (no membership → 404), so it
      // can never enter Recent.
      const res = await openDoc(bearer(a), MEETING_NOTES.id);
      expect(res.statusCode).toBe(404);
      expect(ids(await listDocs(bearer(a), 'recent'))).toEqual([]);
    });
  });

  describe('Shared with me', () => {
    it('shows only documents owned by others, never the user’s own', async () => {
      const owner = await register('s-owner@example.com');
      const me = await register('s-me@example.com');
      const meId = auth(me).user.id;

      const mine = (await createDoc(bearer(me), { title: 'Mine' })).json() as DocumentDto;
      const theirs = (await createDoc(bearer(owner), { title: 'Theirs' })).json() as DocumentDto;
      await addMember(bearer(owner), theirs.id, meId, 'viewer');

      const shared = ids(await listDocs(bearer(me), 'shared'));
      expect(shared).toContain(theirs.id);
      expect(shared).not.toContain(mine.id);

      // The shared doc still appears in "mine" (the primary collection) too.
      expect(ids(await listDocs(bearer(me), 'mine'))).toEqual(
        expect.arrayContaining([mine.id, theirs.id]),
      );
    });
  });

  describe('Trash', () => {
    it('moving to trash removes it from every normal list and shows it in Trash', async () => {
      const a = await register('t-a@example.com');
      const doc = (await createDoc(bearer(a), { title: 'Doomed' })).json() as DocumentDto;
      await openDoc(bearer(a), doc.id); // also make it recent

      expect((await trashDoc(bearer(a), doc.id)).statusCode).toBe(204);

      expect(ids(await listDocs(bearer(a), 'mine'))).not.toContain(doc.id);
      expect(ids(await listDocs(bearer(a), 'recent'))).not.toContain(doc.id);
      expect(ids(await listDocs(bearer(a), 'trash'))).toContain(doc.id);

      // A trashed document can no longer be opened.
      expect((await openDoc(bearer(a), doc.id)).statusCode).toBe(404);
    });

    it('restores a document back into Documents', async () => {
      const a = await register('t-restore@example.com');
      const doc = (await createDoc(bearer(a), { title: 'Back' })).json() as DocumentDto;
      await trashDoc(bearer(a), doc.id);

      expect((await restoreDoc(bearer(a), doc.id)).statusCode).toBe(204);
      expect(ids(await listDocs(bearer(a), 'mine'))).toContain(doc.id);
      expect(ids(await listDocs(bearer(a), 'trash'))).not.toContain(doc.id);
    });

    it('a non-owner (editor) cannot trash the owner’s document', async () => {
      const owner = await register('t-owner@example.com');
      const editor = await register('t-editor@example.com');
      const editorId = auth(editor).user.id;
      const doc = (await createDoc(bearer(owner), { title: 'Protected' })).json() as DocumentDto;
      await addMember(bearer(owner), doc.id, editorId, 'editor');

      expect((await trashDoc(bearer(editor), doc.id)).statusCode).toBe(403);
      // Still live for everyone.
      expect(ids(await listDocs(bearer(owner), 'mine'))).toContain(doc.id);
    });

    it('a system template cannot be trashed through the document API', async () => {
      const a = await register('t-tpl@example.com');
      // No membership on the template → 404, and it is never soft-deleted.
      expect((await trashDoc(bearer(a), MEETING_NOTES.id)).statusCode).toBe(404);
      const { rows } = await pool.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM documents WHERE id = $1',
        [MEETING_NOTES.id],
      );
      expect(rows[0]?.deleted_at).toBeNull();
    });

    it('permanently deletes a document (owner-only, irreversible)', async () => {
      const a = await register('t-purge@example.com');
      const doc = (await createDoc(bearer(a), { title: 'Gone' })).json() as DocumentDto;
      await trashDoc(bearer(a), doc.id);

      expect((await purgeDoc(bearer(a), doc.id)).statusCode).toBe(204);
      const { rowCount } = await pool.query('SELECT 1 FROM documents WHERE id = $1', [doc.id]);
      expect(rowCount).toBe(0);
    });
  });
});
