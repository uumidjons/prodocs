import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { createDocument } from '../../src/modules/documents/repo.js';
import { createUser } from '../../src/modules/users/repo.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';

/**
 * PHASE 3 — the offline conflict matrix, proven against the REAL architecture:
 * actual Fastify+Hocuspocus over a real WebSocket, real independent Y.Docs +
 * providers, and a real Postgres. Nothing here is mocked, and no test calls a merge
 * function — offline edits are made on a locally-editable Y.Doc while the provider
 * is genuinely disconnected, and convergence is produced solely by the Yjs
 * state-vector handshake on reconnect.
 *
 * These encode Scenarios B–F from docs/architecture/offline-sync.md and the
 * §32 "no last-write-wins" / §7-9 divergent/overlapping cases. The assertion is
 * always a CRDT convergence PROPERTY (equal state vectors ⇒ identical document),
 * never a hand-picked winning string.
 *
 * (Browser-level IndexedDB + real ProseMirror rendering + true network offline are
 * covered by the Playwright suite in apps/web/e2e; here "offline" is a genuinely
 * closed socket, which is what the reconnect handshake actually reacts to.)
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
  console.warn('[integration] Postgres not reachable — skipping offline-matrix tests.');
  await pool.end().catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a predicate until true or timeout. */
async function waitUntil(fn: () => boolean, timeout = 8000, interval = 25): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(interval);
  }
  return fn();
}

const text = (d: Y.Doc) => d.getText('t').toString();
const sv = (d: Y.Doc) => Buffer.from(Y.encodeStateVector(d));

/** State-vector equality ⇒ both replicas have applied the identical update set ⇒
 *  (by CRDT convergence) identical documents. This is the convergence property. */
function converged(...docs: Y.Doc[]): boolean {
  const first = sv(docs[0]!);
  return docs.every((d) => first.equals(sv(d)));
}

/**
 * Reusable convergence gate with real diagnostics on failure (§40). Waits until
 * every doc has an identical Yjs state vector, then also asserts identical rendered
 * text as a human-meaningful cross-check.
 */
async function waitUntilConverged(docs: Y.Doc[], timeout = 8000): Promise<void> {
  const ok = await waitUntil(() => converged(...docs), timeout);
  if (!ok) {
    const dump = docs
      .map((d, i) => `  doc[${i}] sv=${sv(d).toString('hex')} text=${JSON.stringify(text(d))}`)
      .join('\n');
    throw new Error(`Documents did not converge within ${timeout}ms:\n${dump}`);
  }
  const t0 = text(docs[0]!);
  for (const d of docs) expect(text(d)).toBe(t0);
}

suite('Offline conflict matrix (WebSocket + Yjs + Postgres)', () => {
  let app: FastifyInstance;
  let url: string;
  let port = 0;
  const clients: HocuspocusProvider[] = [];

  // Listen on a fixed port so a restarted server keeps the SAME URL — an already-open
  // provider (e.g. an offline client) can then reconnect to it, which is the whole
  // point of the server-restart-while-offline scenario. Port 0 on first start picks a
  // free port; restarts reuse it.
  async function start(): Promise<void> {
    app = await buildApp();
    await app.listen({ host: '127.0.0.1', port });
    port = (app.server.address() as AddressInfo).port;
    url = `ws://127.0.0.1:${port}/collab`;
  }
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
    for (const p of clients.splice(0)) p.destroy();
    for (const s of sockets.splice(0)) s.destroy();
    await sleep(400); // let debounced snapshots settle before the next truncate
  });

  let userSeq = 0;
  async function makeUser() {
    userSeq += 1;
    const u = await createUser({
      email: `u${userSeq}@example.com`,
      displayName: `User ${userSeq}`,
      passwordHash: 'x'.repeat(20),
    });
    return { ...u, token: signAccessToken(u.id) };
  }
  async function addMembership(documentId: string, userId: string) {
    await pool.query('INSERT INTO memberships (document_id, user_id, role) VALUES ($1, $2, $3)', [
      documentId,
      userId,
      'editor',
    ]);
  }

  interface Client {
    provider: HocuspocusProvider;
    ydoc: Y.Doc;
  }
  let clientSeq = 0;
  const sockets: HocuspocusProviderWebsocket[] = [];
  function open(documentId: string, token: string): Client {
    const ydoc = new Y.Doc();
    // A dedicated websocket per client with fast, bounded reconnection so the
    // reconnect-heavy scenarios (esp. reconnecting to a *restarted* server) recover
    // in well under a second instead of waiting on the library's default multi-second
    // backoff / 30s message-reconnect timeout. This tunes only reconnect *timing* —
    // the sync protocol and merge semantics are entirely unchanged.
    const socket = new HocuspocusProviderWebsocket({
      url,
      WebSocketPolyfill: WebSocket as unknown as typeof WebSocket,
      minDelay: 100,
      delay: 300,
      factor: 1,
      initialDelay: 0,
      maxDelay: 500,
      messageReconnectTimeout: 4000,
    });
    sockets.push(socket);
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: documentId,
      document: ydoc,
      token,
    });
    // Publish a minimal awareness state, exactly as the real client does via
    // CollaborationCursor. Beyond being realistic, Hocuspocus's liveness ping relies
    // on awareness traffic; without it a reconnect only recovers after the ~30s
    // messageReconnectTimeout, which would make the reconnect-heavy scenarios crawl.
    clientSeq += 1;
    provider.setAwarenessField('user', { id: `client-${clientSeq}`, name: 'T', color: '#10B981' });
    clients.push(provider);
    return { provider, ydoc };
  }
  const waitSynced = (c: Client, timeout = 6000) =>
    waitUntil(() => c.provider.synced, timeout).then((ok) => {
      if (!ok) throw new Error('provider did not sync');
    });

  /** Owner doc + a second editor member, both opened & synced online. */
  async function twoOnlineClients(seed?: (owner: Client) => void) {
    const owner = await makeUser();
    const editor = await makeUser();
    const doc = await createDocument(owner.id, 'Doc');
    await addMembership(doc.id, editor.id);
    const A = open(doc.id, owner.token);
    const B = open(doc.id, editor.token);
    await waitSynced(A);
    await waitSynced(B);
    if (seed) {
      seed(A);
      await waitUntilConverged([A.ydoc, B.ydoc]);
    }
    return { doc, owner, editor, A, B };
  }

  // --- Scenario B: A offline edits, B online edits, A returns ---------------

  it('Scenario B: A offline + B online both edit → reconnect merges both (no loss)', async () => {
    const { A, B } = await twoOnlineClients((a) => a.ydoc.getText('t').insert(0, 'Hello'));

    A.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected);

    // A edits fully offline (local Y.Doc stays editable with no socket).
    A.ydoc.getText('t').insert(A.ydoc.getText('t').length, ' from A');
    expect(text(A.ydoc)).toBe('Hello from A');
    // Meanwhile B keeps editing online; A cannot possibly have received this yet.
    B.ydoc.getText('t').insert(0, 'Hi ');
    await waitUntil(() => text(B.ydoc) === 'Hi Hello');
    expect(text(A.ydoc)).toBe('Hello from A'); // proves A really was offline

    A.provider.connect();
    await waitUntilConverged([A.ydoc, B.ydoc]);

    // Both intentions preserved; deterministic interleaving; nobody overwritten.
    expect(text(A.ydoc)).toBe('Hi Hello from A');
  });

  // --- Scenario C / §7: divergent offline edits from the SAME base ----------

  it('Scenario C: both offline diverge from "Hello" → converge, both survive, order-independent', async () => {
    const { doc, owner, editor, A, B } = await twoOnlineClients((a) =>
      a.ydoc.getText('t').insert(0, 'Hello'),
    );
    void doc;
    void owner;
    void editor;

    A.provider.disconnect();
    B.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected && !B.provider.isConnected);

    A.ydoc.getText('t').insert(A.ydoc.getText('t').length, ' from A');
    B.ydoc.getText('t').insert(B.ydoc.getText('t').length, ' from B');
    expect(text(A.ydoc)).toBe('Hello from A');
    expect(text(B.ydoc)).toBe('Hello from B');

    // Reconnect A first, then B — the later reconnect must NOT win (no LWW).
    A.provider.connect();
    await sleep(150);
    B.provider.connect();

    await waitUntilConverged([A.ydoc, B.ydoc]);
    const merged = text(A.ydoc);
    expect(merged).toContain('from A');
    expect(merged).toContain('from B');
    // Not last-write-wins: B reconnected last but its text did not replace A's.
    expect(merged).not.toBe('Hello from B');
    expect(merged).not.toBe('Hello from A');
  });

  // --- §8: simultaneous offline edits to DIFFERENT regions ------------------

  it('§8: both offline edit different regions → both regions present after merge', async () => {
    // Base: "AAA|BBB" (a marker between two regions).
    const { A, B } = await twoOnlineClients((a) => a.ydoc.getText('t').insert(0, 'AAA|BBB'));

    A.provider.disconnect();
    B.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected && !B.provider.isConnected);

    A.ydoc.getText('t').insert(3, '<A>'); // edit region before the marker
    B.ydoc.getText('t').insert(text(B.ydoc).length, '<B>'); // edit region at the end

    A.provider.connect();
    B.provider.connect();
    await waitUntilConverged([A.ydoc, B.ydoc]);

    expect(text(A.ydoc)).toContain('<A>');
    expect(text(A.ydoc)).toContain('<B>');
  });

  // --- §9: overlapping / same-location offline edits ------------------------

  it('§9: overlapping offline edits at the same offset converge deterministically (both ops retained)', async () => {
    const { A, B } = await twoOnlineClients((a) => a.ydoc.getText('t').insert(0, 'Hello world'));

    A.provider.disconnect();
    B.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected && !B.provider.isConnected);

    // Both insert at the SAME offset 6 (start of "world").
    A.ydoc.getText('t').insert(6, 'brave ');
    B.ydoc.getText('t').insert(6, 'new ');

    A.provider.connect();
    B.provider.connect();
    await waitUntilConverged([A.ydoc, B.ydoc]);

    // Deterministic interleaving keeps BOTH concurrent inserts — neither clobbers
    // the other. We assert the property (both retained + convergence), not a
    // human-preferred sentence.
    const merged = text(A.ydoc);
    expect(merged).toContain('brave ');
    expect(merged).toContain('new ');
    expect(merged.startsWith('Hello ')).toBe(true);
    expect(merged.endsWith('world')).toBe(true);
  });

  // --- §10: connection flapping ---------------------------------------------

  it('§10: repeated flapping with edits each cycle → converge, no loss, no duplication', async () => {
    const { A, B } = await twoOnlineClients();

    for (let i = 0; i < 5; i++) {
      A.provider.disconnect();
      await waitUntil(() => !A.provider.isConnected);
      A.ydoc.getText('t').insert(A.ydoc.getText('t').length, `[a${i}]`);
      B.ydoc.getText('t').insert(B.ydoc.getText('t').length, `[b${i}]`);
      A.provider.connect();
      await waitUntilConverged([A.ydoc, B.ydoc]);
    }

    const merged = text(A.ydoc);
    for (let i = 0; i < 5; i++) {
      // Each marker appears exactly once — idempotent re-send, no doubling.
      expect(merged.split(`[a${i}]`).length - 1).toBe(1);
      expect(merged.split(`[b${i}]`).length - 1).toBe(1);
    }
    expect(converged(A.ydoc, B.ydoc)).toBe(true);
  });

  // --- §11: long offline session --------------------------------------------

  it('§11: long offline session (many edits both sides) → full convergence', async () => {
    const { A, B } = await twoOnlineClients();

    A.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected);

    for (let i = 0; i < 200; i++) A.ydoc.getText('t').insert(A.ydoc.getText('t').length, 'a');
    for (let i = 0; i < 200; i++) B.ydoc.getText('t').insert(0, 'b');

    A.provider.connect();
    await waitUntilConverged([A.ydoc, B.ydoc], 12000);

    const merged = text(A.ydoc);
    expect(merged.split('a').length - 1).toBe(200);
    expect(merged.split('b').length - 1).toBe(200);
  });

  // --- §12: server restart while a client is offline ------------------------

  it('§12: server restart while A offline → A offline edit + B/server edit both survive', async () => {
    const { doc, owner, editor, A, B } = await twoOnlineClients((a) =>
      a.ydoc.getText('t').insert(0, 'base'),
    );

    // A goes offline and edits locally.
    A.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected);
    A.ydoc.getText('t').insert(text(A.ydoc).length, '+A_offline');

    // Restart the server. B is currently connected; drop it first so the restart is
    // clean, then reconnect B to the fresh process and make a further edit.
    B.provider.disconnect();
    await waitUntil(() => !B.provider.isConnected);
    await stop();
    await start();

    const B2 = open(doc.id, editor.token);
    void owner;
    await waitSynced(B2);
    // Server rebuilt "base" from Postgres; B2 sees it and adds its own edit.
    await waitUntil(() => text(B2.ydoc).includes('base'));
    B2.ydoc.getText('t').insert(text(B2.ydoc).length, '+B_after_restart');

    // A reconnects to the restarted server: state-vector handshake trades the diff
    // both ways — A's offline edit up, the server's post-restart state down.
    A.provider.connect();
    await waitUntilConverged([A.ydoc, B2.ydoc], 12000);

    const merged = text(A.ydoc);
    expect(merged).toContain('+A_offline');
    expect(merged).toContain('+B_after_restart');
  });

  // --- §32: explicit no-last-write-wins guard -------------------------------

  it('§32: A edits one region, B edits another (offline) → neither snapshot overwrites the other', async () => {
    const { A, B } = await twoOnlineClients((a) => a.ydoc.getText('t').insert(0, 'A B C'));

    A.provider.disconnect();
    B.provider.disconnect();
    await waitUntil(() => !A.provider.isConnected && !B.provider.isConnected);

    A.ydoc.getText('t').insert(1, 'a'); // "Aa B C"
    B.ydoc.getText('t').insert(text(B.ydoc).length, 'c'); // "A B Cc"

    // Reconnect in the order that a naive "last snapshot wins" impl would get wrong.
    B.provider.connect();
    await sleep(150);
    A.provider.connect();
    await waitUntilConverged([A.ydoc, B.ydoc]);

    const merged = text(A.ydoc);
    expect(merged).toContain('Aa'); // A's edit survived despite reconnecting last
    expect(merged).toContain('Cc'); // B's edit survived
  });
});
