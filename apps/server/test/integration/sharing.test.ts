import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResultDto, DocumentDto, MemberDto } from '@scribe/shared';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';

/**
 * Phase 5 — sharing / membership API against a REAL Postgres. Proves the
 * authorization boundary (owner-only mutations), the owner invariant, IDOR
 * rejection, input validation, duplicate handling, and user search. Access control
 * is enforced server-side; these are not replaced by any frontend test.
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
  console.warn('[integration] Postgres not reachable — skipping sharing tests.');
  await pool.end().catch(() => {});
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

suite('Sharing / membership API', () => {
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

  // --- helpers -------------------------------------------------------------

  interface Actor {
    id: string;
    email: string;
    token: string;
  }

  async function makeUser(email: string): Promise<Actor> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123', displayName: email.split('@')[0] },
    });
    const body = res.json() as AuthResultDto;
    return { id: body.user.id, email, token: body.accessToken };
  }

  const auth = (a: Actor) => ({ authorization: `Bearer ${a.token}` });

  async function makeDoc(owner: Actor, title = 'Doc'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: auth(owner),
      payload: { title },
    });
    return (res.json() as DocumentDto).id;
  }

  const listMembers = (a: Actor, docId: string) =>
    app.inject({ method: 'GET', url: `/api/documents/${docId}/members`, headers: auth(a) });

  const addMember = (a: Actor, docId: string, userId: string, role: string) =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/members`,
      headers: auth(a),
      payload: { userId, role },
    });

  // --- list ----------------------------------------------------------------

  it('lists the owner as the sole member of a new document', async () => {
    const owner = await makeUser('owner@example.com');
    const docId = await makeDoc(owner);
    const res = await listMembers(owner, docId);
    expect(res.statusCode).toBe(200);
    const members = res.json() as MemberDto[];
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: owner.id, role: 'owner', isOwner: true });
    // No secret fields leak.
    expect(JSON.stringify(members)).not.toContain('password');
  });

  // --- add -----------------------------------------------------------------

  it('owner adds an editor and a viewer', async () => {
    const owner = await makeUser('owner@example.com');
    const editor = await makeUser('editor@example.com');
    const viewer = await makeUser('viewer@example.com');
    const docId = await makeDoc(owner);

    const addEd = await addMember(owner, docId, editor.id, 'editor');
    expect(addEd.statusCode).toBe(201);

    const addVw = await addMember(owner, docId, viewer.id, 'viewer');
    expect(addVw.statusCode).toBe(201);
    const members = addVw.json() as MemberDto[];
    expect(members).toHaveLength(3);
    expect(members.find((m) => m.userId === editor.id)?.role).toBe('editor');
    expect(members.find((m) => m.userId === viewer.id)?.role).toBe('viewer');
  });

  it('shared members can then see the document (list + get)', async () => {
    const owner = await makeUser('owner@example.com');
    const editor = await makeUser('editor@example.com');
    const docId = await makeDoc(owner);
    await addMember(owner, docId, editor.id, 'editor');

    const get = await app.inject({
      method: 'GET',
      url: `/api/documents/${docId}`,
      headers: auth(editor),
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as DocumentDto).role).toBe('editor');

    const list = await app.inject({ method: 'GET', url: '/api/documents', headers: auth(editor) });
    expect((list.json() as DocumentDto[]).map((d) => d.id)).toContain(docId);
  });

  it('rejects a duplicate membership with 409', async () => {
    const owner = await makeUser('owner@example.com');
    const editor = await makeUser('editor@example.com');
    const docId = await makeDoc(owner);
    expect((await addMember(owner, docId, editor.id, 'editor')).statusCode).toBe(201);
    const dup = await addMember(owner, docId, editor.id, 'viewer');
    expect(dup.statusCode).toBe(409);
  });

  it('rejects adding the owner again with 409', async () => {
    const owner = await makeUser('owner@example.com');
    const docId = await makeDoc(owner);
    const res = await addMember(owner, docId, owner.id, 'editor');
    expect(res.statusCode).toBe(409);
  });

  // --- change role ---------------------------------------------------------

  it('owner changes a member role', async () => {
    const owner = await makeUser('owner@example.com');
    const member = await makeUser('m@example.com');
    const docId = await makeDoc(owner);
    await addMember(owner, docId, member.id, 'editor');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/documents/${docId}/members/${member.id}`,
      headers: auth(owner),
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as MemberDto[]).find((m) => m.userId === member.id)?.role).toBe('viewer');
  });

  // --- remove --------------------------------------------------------------

  it('owner removes a member, revoking their REST access', async () => {
    const owner = await makeUser('owner@example.com');
    const member = await makeUser('m@example.com');
    const docId = await makeDoc(owner);
    await addMember(owner, docId, member.id, 'editor');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/documents/${docId}/members/${member.id}`,
      headers: auth(owner),
    });
    expect(del.statusCode).toBe(200);

    // Removed user immediately loses REST access (404-on-forbidden).
    const get = await app.inject({
      method: 'GET',
      url: `/api/documents/${docId}`,
      headers: auth(member),
    });
    expect(get.statusCode).toBe(404);
  });

  // --- authorization -------------------------------------------------------

  it('editor cannot manage sharing (403)', async () => {
    const owner = await makeUser('owner@example.com');
    const editor = await makeUser('editor@example.com');
    const outsider = await makeUser('out@example.com');
    const docId = await makeDoc(owner);
    await addMember(owner, docId, editor.id, 'editor');

    const add = await addMember(editor, docId, outsider.id, 'viewer');
    expect(add.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/documents/${docId}/members/${owner.id}`,
      headers: auth(editor),
    });
    expect(del.statusCode).toBe(403);
  });

  it('viewer cannot manage sharing (403) but can list members', async () => {
    const owner = await makeUser('owner@example.com');
    const viewer = await makeUser('viewer@example.com');
    const outsider = await makeUser('out@example.com');
    const docId = await makeDoc(owner);
    await addMember(owner, docId, viewer.id, 'viewer');

    expect((await listMembers(viewer, docId)).statusCode).toBe(200);
    expect((await addMember(viewer, docId, outsider.id, 'viewer')).statusCode).toBe(403);
  });

  it('non-member cannot see or manage membership (404 — existence hidden)', async () => {
    const owner = await makeUser('owner@example.com');
    const outsider = await makeUser('out@example.com');
    const docId = await makeDoc(owner);

    expect((await listMembers(outsider, docId)).statusCode).toBe(404);
    // A non-member trying to add themselves is a 404, never a self-grant.
    expect((await addMember(outsider, docId, outsider.id, 'editor')).statusCode).toBe(404);

    // The grant must NOT have happened.
    const check = await app.inject({
      method: 'GET',
      url: `/api/documents/${docId}`,
      headers: auth(outsider),
    });
    expect(check.statusCode).toBe(404);
  });

  it('rejects unauthenticated membership access with 401', async () => {
    const owner = await makeUser('owner@example.com');
    const docId = await makeDoc(owner);
    const res = await app.inject({ method: 'GET', url: `/api/documents/${docId}/members` });
    expect(res.statusCode).toBe(401);
  });

  // --- owner invariant -----------------------------------------------------

  it('owner cannot change their own role or be removed', async () => {
    const owner = await makeUser('owner@example.com');
    const docId = await makeDoc(owner);

    const change = await app.inject({
      method: 'PATCH',
      url: `/api/documents/${docId}/members/${owner.id}`,
      headers: auth(owner),
      payload: { role: 'editor' },
    });
    expect(change.statusCode).toBe(403);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/documents/${docId}/members/${owner.id}`,
      headers: auth(owner),
    });
    expect(remove.statusCode).toBe(403);

    // Owner membership is intact.
    const members = (await listMembers(owner, docId)).json() as MemberDto[];
    expect(members.find((m) => m.userId === owner.id)?.role).toBe('owner');
  });

  // --- IDOR / cross-document -----------------------------------------------

  it('rejects cross-document IDOR: owner of A cannot manage B', async () => {
    const alice = await makeUser('alice@example.com');
    const bob = await makeUser('bob@example.com');
    const target = await makeUser('target@example.com');
    await makeDoc(alice, 'A');
    const docB = await makeDoc(bob, 'B');

    // Alice is not a member of Bob's doc → 404, and no membership is created.
    const res = await addMember(alice, docB, target.id, 'editor');
    expect(res.statusCode).toBe(404);

    const membersB = (await listMembers(bob, docB)).json() as MemberDto[];
    expect(membersB.map((m) => m.userId)).not.toContain(target.id);
  });

  // --- input validation ----------------------------------------------------

  it('rejects an invalid role with 400', async () => {
    const owner = await makeUser('owner@example.com');
    const member = await makeUser('m@example.com');
    const docId = await makeDoc(owner);
    // 'owner' is not an assignable role.
    const asOwner = await addMember(owner, docId, member.id, 'owner');
    expect(asOwner.statusCode).toBe(400);
    const bogus = await addMember(owner, docId, member.id, 'superuser');
    expect(bogus.statusCode).toBe(400);
  });

  it('rejects an invalid (non-UUID) document or user id with 400', async () => {
    const owner = await makeUser('owner@example.com');
    const docId = await makeDoc(owner);

    const badDoc = await app.inject({
      method: 'GET',
      url: '/api/documents/not-a-uuid/members',
      headers: auth(owner),
    });
    expect(badDoc.statusCode).toBe(400);

    const badUser = await addMember(owner, docId, 'not-a-uuid', 'editor');
    expect(badUser.statusCode).toBe(400);
  });

  it('returns 404 when adding a non-existent (well-formed) user id', async () => {
    const owner = await makeUser('owner@example.com');
    const docId = await makeDoc(owner);
    const res = await addMember(owner, docId, NIL_UUID, 'editor');
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 changing/removing a user who is not a member', async () => {
    const owner = await makeUser('owner@example.com');
    const stranger = await makeUser('stranger@example.com');
    const docId = await makeDoc(owner);

    const change = await app.inject({
      method: 'PATCH',
      url: `/api/documents/${docId}/members/${stranger.id}`,
      headers: auth(owner),
      payload: { role: 'viewer' },
    });
    expect(change.statusCode).toBe(404);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/documents/${docId}/members/${stranger.id}`,
      headers: auth(owner),
    });
    expect(remove.statusCode).toBe(404);
  });

  // --- user search ---------------------------------------------------------

  describe('user search', () => {
    it('finds users by email/name and excludes the caller + secrets', async () => {
      const owner = await makeUser('owner@example.com');
      await makeUser('findme@example.com');

      const res = await app.inject({
        method: 'GET',
        url: '/api/users/search?q=findme',
        headers: auth(owner),
      });
      expect(res.statusCode).toBe(200);
      const results = res.json() as Array<{ id: string; email: string }>;
      expect(results.some((r) => r.email === 'findme@example.com')).toBe(true);
      expect(JSON.stringify(results)).not.toContain('password');

      // Searching for the caller's own email returns nobody (self excluded).
      const self = await app.inject({
        method: 'GET',
        url: '/api/users/search?q=owner@example.com',
        headers: auth(owner),
      });
      expect((self.json() as unknown[]).length).toBe(0);
    });

    it('rejects a too-short query with 400', async () => {
      const owner = await makeUser('owner@example.com');
      const res = await app.inject({
        method: 'GET',
        url: '/api/users/search?q=a',
        headers: auth(owner),
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/users/search?q=someone' });
      expect(res.statusCode).toBe(401);
    });
  });
});
