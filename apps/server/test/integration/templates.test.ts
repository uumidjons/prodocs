import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { AuthResultDto, DocumentDto, TemplateDto } from '@scribe/shared';
import { COLLAB_FIELD, SYSTEM_TEMPLATES } from '@scribe/shared';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import {
  loadSnapshot,
  loadUpdatesAfter,
  saveSnapshot,
} from '../../src/modules/persistence/repo.js';
import { seedSystemTemplates } from '../../src/modules/documents/templates.js';

/**
 * System-template model (task §1/§2/§3). Templates are product-provided SOURCE
 * documents; creating from one produces a NEW, independent user document. A user's
 * own documents are never templates, and template-created documents are normal
 * documents (they never appear in the template list).
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
  console.warn('[integration] Postgres not reachable — skipping template tests.');
  await pool.end().catch(() => {});
}

/** Reconstruct a document's Y.Doc from persisted state (snapshot + tail replay). */
async function reconstruct(documentId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const snapshot = await loadSnapshot(documentId);
  if (snapshot) Y.applyUpdate(doc, snapshot.state);
  const tail = await loadUpdatesAfter(documentId, snapshot?.throughSeq ?? 0);
  for (const update of tail) Y.applyUpdate(doc, update);
  return doc;
}

function bodyText(doc: Y.Doc): string {
  return JSON.stringify(doc.getXmlFragment(COLLAB_FIELD).toJSON());
}

const MEETING_NOTES = SYSTEM_TEMPLATES.find((t) => t.key === 'meeting-notes')!;

suite('System templates', () => {
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
    // TRUNCATE removes the system user + template docs (CASCADE); re-seed them.
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    await seedSystemTemplates();
  });

  const register = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123', displayName: email },
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
  const listDocs = (token: string) =>
    app.inject({ method: 'GET', url: '/api/documents', headers: { authorization: token } });
  const listTemplates = (token: string) =>
    app.inject({ method: 'GET', url: '/api/templates', headers: { authorization: token } });

  it('exposes the system templates via GET /api/templates', async () => {
    const a = await register('t-owner@example.com');
    const res = await listTemplates(bearer(a));
    expect(res.statusCode).toBe(200);
    const tpls = res.json() as TemplateDto[];
    const titles = tpls.map((t) => t.title).sort();
    expect(titles).toEqual([...SYSTEM_TEMPLATES.map((t) => t.title)].sort());
  });

  it('does not list a user’s own document as a template', async () => {
    const a = await register('t-user@example.com');
    const mine = (await createDoc(bearer(a), { title: 'My Notes' })).json() as DocumentDto;

    const tpls = (await listTemplates(bearer(a))).json() as TemplateDto[];
    expect(tpls.some((t) => t.id === mine.id)).toBe(false);
    expect(tpls.some((t) => t.title === 'My Notes')).toBe(false);
  });

  it('does not include templates in the user’s Documents list', async () => {
    const a = await register('t-docs@example.com');
    await createDoc(bearer(a), { title: 'Real Doc' });

    const docs = (await listDocs(bearer(a))).json() as DocumentDto[];
    expect(docs.some((d) => d.id === MEETING_NOTES.id)).toBe(false);
    expect(docs.map((d) => d.title)).toEqual(['Real Doc']);
  });

  it('blank create makes an empty document (no copied content)', async () => {
    const a = await register('t-blank@example.com');
    const doc = (await createDoc(bearer(a), {})).json() as DocumentDto;
    expect(doc.title).toBe('Untitled document');
    // No persisted content is created at REST-create time (the blank doc is seeded
    // empty only when first opened via the collab load path).
    expect(await loadSnapshot(doc.id)).toBeNull();
  });

  it('creates an independent document from a template (new id, owner, no copied members, template title, content copied)', async () => {
    const a = await register('t-create@example.com');
    const ownerId = auth(a).user.id;

    const res = await createDoc(bearer(a), { fromTemplateId: MEETING_NOTES.id });
    expect(res.statusCode).toBe(201);
    const doc = res.json() as DocumentDto;

    // New instance owned by the creator, titled after the template (never "Copy of").
    expect(doc.id).not.toBe(MEETING_NOTES.id);
    expect(doc.ownerId).toBe(ownerId);
    expect(doc.role).toBe('owner');
    expect(doc.title).toBe(MEETING_NOTES.title);

    // Exactly one membership: the creator as owner (the template's owner is NOT copied).
    const { rows } = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM memberships WHERE document_id = $1',
      [doc.id],
    );
    expect(rows.map((m) => m.user_id)).toEqual([ownerId]);

    // The template's content was copied into the new document's own persisted state.
    const copy = await reconstruct(doc.id);
    expect(bodyText(copy)).toContain('Agenda');

    // It is a normal document, not a template: it appears in Documents, not templates.
    const docs = (await listDocs(bearer(a))).json() as DocumentDto[];
    expect(docs.some((d) => d.id === doc.id)).toBe(true);
    const tpls = (await listTemplates(bearer(a))).json() as TemplateDto[];
    expect(tpls.some((t) => t.id === doc.id)).toBe(false);
  });

  it('creating from the same template twice yields two independent documents', async () => {
    const a = await register('t-twice@example.com');
    const one = (
      await createDoc(bearer(a), { fromTemplateId: MEETING_NOTES.id })
    ).json() as DocumentDto;
    const two = (
      await createDoc(bearer(a), { fromTemplateId: MEETING_NOTES.id })
    ).json() as DocumentDto;
    expect(one.id).not.toBe(two.id);

    // Editing document ONE must not change document TWO or the template.
    const templateBefore = bodyText(await reconstruct(MEETING_NOTES.id));
    const twoBefore = bodyText(await reconstruct(two.id));

    const oneDoc = await reconstruct(one.id);
    oneDoc.getXmlFragment(COLLAB_FIELD).push([new Y.XmlElement('paragraph')]);
    await saveSnapshot(one.id, Y.encodeStateAsUpdate(oneDoc), 0);

    expect(bodyText(await reconstruct(two.id))).toBe(twoBefore);
    expect(bodyText(await reconstruct(MEETING_NOTES.id))).toBe(templateBefore);
  });

  it('editing a template-created document does not modify the original template', async () => {
    const a = await register('t-indep@example.com');
    const before = Buffer.from(Y.encodeStateAsUpdate(await reconstruct(MEETING_NOTES.id)));

    const doc = (
      await createDoc(bearer(a), { fromTemplateId: MEETING_NOTES.id })
    ).json() as DocumentDto;
    const copy = await reconstruct(doc.id);
    copy.getXmlFragment(COLLAB_FIELD).push([new Y.XmlElement('paragraph')]);
    await saveSnapshot(doc.id, Y.encodeStateAsUpdate(copy), 0);

    const after = Buffer.from(Y.encodeStateAsUpdate(await reconstruct(MEETING_NOTES.id)));
    expect(after.equals(before)).toBe(true);
  });

  it('rejects creating from a non-template id (404)', async () => {
    const a = await register('t-reject@example.com');
    // A normal user document id is NOT a valid template source.
    const mine = (await createDoc(bearer(a), { title: 'Not a template' })).json() as DocumentDto;
    const res = await createDoc(bearer(a), { fromTemplateId: mine.id });
    expect(res.statusCode).toBe(404);
  });
});
