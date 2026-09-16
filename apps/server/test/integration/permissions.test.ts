import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { createDocument, getDocumentForUser } from '../../src/modules/documents/repo.js';
import { createUser } from '../../src/modules/users/repo.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import * as memberships from '../../src/modules/memberships/service.js';

/**
 * Live permission-change propagation over a REAL Fastify + Hocuspocus server, real
 * providers, and real Postgres. Proves that changing a membership role (or removing
 * a member) via the authoritative service takes effect on an ALREADY-OPEN socket:
 * the server force-drops the affected connection, which reconnects and re-runs
 * onAuthenticate against the new role — with no authorization gap and no document
 * replacement (content resyncs via the normal Yjs handshake).
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
  console.warn('[integration] Postgres not reachable — skipping permission tests.');
  await pool.end().catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn: () => boolean, timeout = 12000, interval = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(interval);
  }
  return fn();
}

suite('Live permission changes (WebSocket re-authorization)', () => {
  let app: FastifyInstance;
  let url: string;
  const clients: Array<{ provider: HocuspocusProvider }> = [];

  async function start(): Promise<void> {
    app = await buildApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/collab`;
  }

  beforeAll(async () => {
    await runMigrations();
    await start();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.provider.destroy();
    await sleep(300);
  });

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
    state: { syncCount: number; authFailed: boolean };
  }

  function open(documentId: string, token: string): Client {
    const ydoc = new Y.Doc();
    const state = { syncCount: 0, authFailed: false };
    const provider = new HocuspocusProvider({
      url,
      name: documentId,
      document: ydoc,
      token,
      WebSocketPolyfill: WebSocket,
      onSynced: () => {
        state.syncCount += 1;
      },
      onAuthenticationFailed: () => {
        state.authFailed = true;
      },
    });
    clients.push({ provider });
    return { provider, ydoc, state };
  }

  it('viewer → editor: an open connection can write after the change (no gap)', async () => {
    const owner = await makeUser('owner');
    const collab = await makeUser('viewer');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, collab.id, 'viewer');

    const A = open(doc.id, owner.token);
    const V = open(doc.id, collab.token);
    expect(await waitUntil(() => A.state.syncCount >= 1)).toBe(true);
    expect(await waitUntil(() => V.state.syncCount >= 1)).toBe(true);

    // Promote the live viewer to editor via the authoritative service.
    await memberships.changeRole(owner.id, doc.id, collab.id, 'editor');

    // The socket is force-dropped and reconnects (a second successful sync).
    expect(await waitUntil(() => V.state.syncCount >= 2)).toBe(true);

    // The former viewer's edits are now accepted by the server and propagate.
    V.ydoc.getText('t').insert(0, 'NOW-EDITOR');
    expect(await waitUntil(() => A.ydoc.getText('t').toString().includes('NOW-EDITOR'))).toBe(true);
  });

  it('editor → viewer: writes are rejected server-side after the change', async () => {
    const owner = await makeUser('owner');
    const collab = await makeUser('editor');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, collab.id, 'editor');

    const A = open(doc.id, owner.token);
    const E = open(doc.id, collab.token);
    expect(await waitUntil(() => A.state.syncCount >= 1)).toBe(true);
    expect(await waitUntil(() => E.state.syncCount >= 1)).toBe(true);

    // A write while still an editor propagates.
    E.ydoc.getText('t').insert(0, 'as-editor ');
    expect(await waitUntil(() => A.ydoc.getText('t').toString().includes('as-editor'))).toBe(true);

    // Demote to viewer; the socket reconnects read-only.
    await memberships.changeRole(owner.id, doc.id, collab.id, 'viewer');
    expect(await waitUntil(() => E.state.syncCount >= 2)).toBe(true);

    // A write after the demotion is rejected by the server (never reaches the owner).
    E.ydoc.getText('t').insert(0, 'VIEWER-HACK ');
    await sleep(1000);
    expect(A.ydoc.getText('t').toString()).not.toContain('VIEWER-HACK');
  });

  it('removing a member revokes an already-open connection (auth fails on reconnect)', async () => {
    const owner = await makeUser('owner');
    const collab = await makeUser('editor');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, collab.id, 'editor');

    const E = open(doc.id, collab.token);
    expect(await waitUntil(() => E.state.syncCount >= 1)).toBe(true);

    await memberships.remove(owner.id, doc.id, collab.id);

    // The forced reconnect is rejected by onAuthenticate (no membership).
    expect(await waitUntil(() => E.state.authFailed)).toBe(true);
    // REST access is denied too (authoritative), which the client uses to confirm revocation.
    expect(await getDocumentForUser(doc.id, collab.id)).toBeNull();
  });

  it('does not disturb other collaborators when one member’s role changes', async () => {
    const owner = await makeUser('owner');
    const keep = await makeUser('editor-keep');
    const change = await makeUser('viewer-change');
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, keep.id, 'editor');
    await addMembership(doc.id, change.id, 'viewer');

    const K = open(doc.id, keep.token);
    const C = open(doc.id, change.token);
    expect(await waitUntil(() => K.state.syncCount >= 1)).toBe(true);
    expect(await waitUntil(() => C.state.syncCount >= 1)).toBe(true);

    await memberships.changeRole(owner.id, doc.id, change.id, 'editor');

    // The changed user reconnects…
    expect(await waitUntil(() => C.state.syncCount >= 2)).toBe(true);
    // …while the untouched collaborator's connection stays up (no extra sync).
    await sleep(500);
    expect(K.state.syncCount).toBe(1);
    expect(K.state.authFailed).toBe(false);
  });
});
