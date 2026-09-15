import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { createDocument } from '../../src/modules/documents/repo.js';
import { createUser } from '../../src/modules/users/repo.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { appendUpdate, loadUpdatesAfter } from '../../src/modules/persistence/repo.js';

/**
 * Real collaboration integration tests: an actual Fastify+Hocuspocus server over a
 * real WebSocket, real Y.Docs/providers, and a real Postgres. These prove the CRDT
 * transport, authorization, persistence, restart recovery, and convergence — not
 * mocks. (The full offline conflict matrix is Phase 3.)
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
  console.warn('[integration] Postgres not reachable — skipping collaboration tests.');
  await pool.end().catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a sync predicate until true or timeout. */
async function waitUntil(fn: () => boolean, timeout = 5000, interval = 25): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(interval);
  }
  return fn();
}

/** Poll an async predicate until true or timeout. */
async function waitUntilAsync(
  fn: () => Promise<boolean>,
  timeout = 5000,
  interval = 50,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await sleep(interval);
  }
  return fn();
}

suite('Collaboration (WebSocket + Yjs + Postgres)', () => {
  let app: FastifyInstance;
  let url: string;
  const clients: Array<{ provider: HocuspocusProvider; ydoc: Y.Doc }> = [];

  async function start(): Promise<void> {
    app = await buildApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/collab`;
  }

  /** Close the server; the app's onClose hook terminates live WS clients first. */
  async function stop(): Promise<void> {
    await app.close();
  }

  beforeAll(async () => {
    await runMigrations();
    await start();
  });

  afterAll(async () => {
    await stop();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.provider.destroy();
    // Let any debounced snapshot writes settle before the next test truncates,
    // so persistence writes target a still-existing document row.
    await sleep(400);
  });

  // --- helpers -------------------------------------------------------------

  let userSeq = 0;
  async function makeUser(role = 'user') {
    userSeq += 1;
    const u = await createUser({
      email: `${role}${userSeq}@example.com`,
      displayName: `${role} ${userSeq}`,
      passwordHash: 'x'.repeat(20),
    });
    return { ...u, token: signAccessToken(u.id) };
  }

  async function addMembership(documentId: string, userId: string, role: 'editor' | 'viewer') {
    await pool.query('INSERT INTO memberships (document_id, user_id, role) VALUES ($1, $2, $3)', [
      documentId,
      userId,
      role,
    ]);
  }

  interface Client {
    provider: HocuspocusProvider;
    ydoc: Y.Doc;
    outcome: Promise<'synced' | 'authfailed'>;
  }

  function open(documentId: string, token: string): Client {
    const ydoc = new Y.Doc();
    let resolve!: (v: 'synced' | 'authfailed') => void;
    const outcome = new Promise<'synced' | 'authfailed'>((r) => (resolve = r));
    const provider = new HocuspocusProvider({
      url,
      name: documentId,
      document: ydoc,
      token,
      WebSocketPolyfill: WebSocket,
      onSynced: () => resolve('synced'),
      onAuthenticationFailed: () => resolve('authfailed'),
    });
    clients.push({ provider, ydoc });
    return { provider, ydoc, outcome };
  }

  /** 'synced' | 'authfailed' | 'timeout'. */
  function outcomeOf(client: Client, timeout = 5000): Promise<string> {
    return Promise.race([client.outcome, sleep(timeout).then(() => 'timeout')]);
  }

  async function hasUpdates(documentId: string): Promise<boolean> {
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM doc_update WHERE document_id = $1',
      [documentId],
    );
    return Number(rows[0]?.n ?? '0') > 0;
  }

  // --- authentication & authorization -------------------------------------

  it('rejects an unauthenticated connection', async () => {
    const owner = await makeUser('owner');
    const doc = await createDocument(owner.id, 'Doc');
    expect(await outcomeOf(open(doc.id, ''), 3500)).not.toBe('synced');
  });

  it('rejects an invalid access token', async () => {
    const owner = await makeUser('owner');
    const doc = await createDocument(owner.id, 'Doc');
    expect(await outcomeOf(open(doc.id, 'not-a-real-token'), 3500)).not.toBe('synced');
  });

  it('rejects a non-member (cannot access by guessing the document UUID)', async () => {
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');
    const doc = await createDocument(owner.id, 'Private');
    expect(await outcomeOf(open(doc.id, stranger.token), 3500)).not.toBe('synced');
  });

  it('allows an owner and an editor to connect', async () => {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, editor.id, 'editor');
    expect(await outcomeOf(open(doc.id, owner.token))).toBe('synced');
    expect(await outcomeOf(open(doc.id, editor.token))).toBe('synced');
  });

  // --- two-client real-time sync ------------------------------------------

  it('propagates edits A→B and B→A, then converges', async () => {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, editor.id, 'editor');

    const A = open(doc.id, owner.token);
    const B = open(doc.id, editor.token);
    expect(await outcomeOf(A)).toBe('synced');
    expect(await outcomeOf(B)).toBe('synced');

    A.ydoc.getText('t').insert(0, 'Hello from A');
    expect(await waitUntil(() => B.ydoc.getText('t').toString().includes('Hello from A'))).toBe(
      true,
    );

    B.ydoc.getText('t').insert(B.ydoc.getText('t').length, ' / Hello from B');
    expect(await waitUntil(() => A.ydoc.getText('t').toString().includes('Hello from B'))).toBe(
      true,
    );

    expect(A.ydoc.getText('t').toString()).toBe(B.ydoc.getText('t').toString());
    expect(Buffer.compare(Y.encodeStateVector(A.ydoc), Y.encodeStateVector(B.ydoc))).toBe(0);
  });

  it('converges on concurrent edits (Yjs merges; no last-write-wins)', async () => {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, editor.id, 'editor');

    const A = open(doc.id, owner.token);
    const B = open(doc.id, editor.token);
    expect(await outcomeOf(A)).toBe('synced');
    expect(await outcomeOf(B)).toBe('synced');

    A.ydoc.getText('t').insert(0, 'AAA');
    B.ydoc.getText('t').insert(0, 'BBB');

    expect(
      await waitUntil(() => {
        const a = A.ydoc.getText('t').toString();
        const b = B.ydoc.getText('t').toString();
        return a === b && a.includes('AAA') && a.includes('BBB');
      }),
    ).toBe(true);
    expect(Buffer.compare(Y.encodeStateVector(A.ydoc), Y.encodeStateVector(B.ydoc))).toBe(0);
  });

  // --- viewer read-only ----------------------------------------------------

  it('lets a viewer observe but rejects their edits (read-only)', async () => {
    const owner = await makeUser('owner');
    const viewer = await makeUser('viewer');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, viewer.id, 'viewer');

    const A = open(doc.id, owner.token);
    const V = open(doc.id, viewer.token);
    expect(await outcomeOf(A)).toBe('synced');
    expect(await outcomeOf(V)).toBe('synced');

    A.ydoc.getText('t').insert(0, 'owner text');
    expect(await waitUntil(() => V.ydoc.getText('t').toString().includes('owner text'))).toBe(true);

    V.ydoc.getText('t').insert(0, 'VIEWER-HACK ');
    await sleep(500);
    expect(A.ydoc.getText('t').toString()).not.toContain('VIEWER-HACK');
  });

  // --- persistence ---------------------------------------------------------

  it('reconstructs a document from Postgres after it is evicted from memory', async () => {
    const owner = await makeUser('owner');
    const doc = await createDocument(owner.id, 'Doc');

    const A = open(doc.id, owner.token);
    expect(await outcomeOf(A)).toBe('synced');
    A.ydoc.getText('t').insert(0, 'persist me');

    expect(await waitUntilAsync(() => hasUpdates(doc.id))).toBe(true);
    A.provider.destroy();
    await sleep(300);

    const C = open(doc.id, owner.token);
    expect(await outcomeOf(C)).toBe('synced');
    expect(await waitUntil(() => C.ydoc.getText('t').toString().includes('persist me'))).toBe(true);
  });

  it('replaying the same persisted update does not corrupt the document (idempotent)', async () => {
    const owner = await makeUser('owner');
    const doc = await createDocument(owner.id, 'Doc');

    const source = new Y.Doc();
    source.getText('t').insert(0, 'abc');
    const update = Y.encodeStateAsUpdate(source);

    await appendUpdate(doc.id, update);
    await appendUpdate(doc.id, update); // duplicate

    const reconstructed = new Y.Doc();
    for (const u of await loadUpdatesAfter(doc.id, 0)) Y.applyUpdate(reconstructed, u);
    expect(reconstructed.getText('t').toString()).toBe('abc'); // not "abcabc"
  });

  it('survives a full server restart (content reconstructed from Postgres)', async () => {
    const owner = await makeUser('owner');
    const doc = await createDocument(owner.id, 'Doc');

    const A = open(doc.id, owner.token);
    expect(await outcomeOf(A)).toBe('synced');
    A.ydoc.getText('t').insert(0, 'restart survive');
    expect(await waitUntilAsync(() => hasUpdates(doc.id))).toBe(true);
    A.provider.destroy();
    await sleep(200);

    // Restart the backend process's server (new HTTP server + Hocuspocus).
    await stop();
    await start();

    const C = open(doc.id, owner.token);
    expect(await outcomeOf(C)).toBe('synced');
    expect(await waitUntil(() => C.ydoc.getText('t').toString().includes('restart survive'))).toBe(
      true,
    );
  });

  // --- presence / awareness lifecycle -------------------------------------

  it('exposes real presence and removes it on disconnect', async () => {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, editor.id, 'editor');

    const A = open(doc.id, owner.token);
    const B = open(doc.id, editor.token);
    expect(await outcomeOf(A)).toBe('synced');
    expect(await outcomeOf(B)).toBe('synced');

    const hasOwner = () =>
      [...(B.provider.awareness?.getStates().values() ?? [])].some(
        (s) => (s as { user?: { id?: string } }).user?.id === owner.id,
      );

    A.provider.awareness?.setLocalStateField('user', {
      id: owner.id,
      name: 'Owner',
      color: '#10B981',
    });
    expect(await waitUntil(hasOwner)).toBe(true);

    A.provider.destroy();
    expect(await waitUntil(() => !hasOwner())).toBe(true);
  });
});
