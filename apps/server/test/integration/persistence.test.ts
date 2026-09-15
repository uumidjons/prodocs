import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';
import { createDocument } from '../../src/modules/documents/repo.js';
import { createUser } from '../../src/modules/users/repo.js';
import {
  appendUpdate,
  loadSnapshot,
  loadUpdatesAfter,
  maxUpdateSeq,
  saveSnapshot,
} from '../../src/modules/persistence/repo.js';

/**
 * Phase 4 — persistence durability at the repo layer: compaction folds the update
 * log into a snapshot and truncates the folded tail in ONE transaction, updates that
 * arrive after the fold point survive, reconstruction (snapshot + tail replay)
 * reproduces the exact Y.Doc (byte-level state vector), and a failed compaction rolls
 * back leaving no partial state. Live end-to-end restart recovery is in collab.test.ts.
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
  console.warn('[integration] Postgres not reachable — skipping persistence tests.');
  await pool.end().catch(() => {});
}

const sv = (d: Y.Doc) => Buffer.from(Y.encodeStateVector(d));

suite('Persistence durability & compaction', () => {
  let userId: string;
  let seq = 0;

  beforeAll(async () => {
    await runMigrations();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    seq += 1;
    const u = await createUser({
      email: `p${seq}@example.com`,
      displayName: 'P',
      passwordHash: 'x'.repeat(20),
    });
    userId = u.id;
  });

  /** Emit incremental updates from a Y.Doc, capturing each one. */
  function record(doc: Y.Doc, mutate: () => void): Uint8Array {
    let captured: Uint8Array | null = null;
    const handler = (u: Uint8Array) => {
      captured = u;
    };
    doc.on('update', handler);
    mutate();
    doc.off('update', handler);
    if (!captured) throw new Error('no update produced');
    return captured;
  }

  it('compaction folds the log into a snapshot, truncates it, and reconstructs exactly', async () => {
    const doc = await createDocument(userId, 'Doc');
    const src = new Y.Doc();

    // Three incremental edits → three appended updates.
    for (const text of ['Hello', ' brave', ' world']) {
      const u = record(src, () => src.getText('t').insert(src.getText('t').length, text));
      await appendUpdate(doc.id, u);
    }
    expect((await loadUpdatesAfter(doc.id, 0)).length).toBe(3);

    // Compact: snapshot the full state through the current max seq.
    const throughSeq = await maxUpdateSeq(doc.id);
    await saveSnapshot(doc.id, Y.encodeStateAsUpdate(src), throughSeq);

    // The folded tail is gone; a snapshot at throughSeq exists.
    expect((await loadUpdatesAfter(doc.id, 0)).length).toBe(0);
    const snap = await loadSnapshot(doc.id);
    expect(snap?.throughSeq).toBe(throughSeq);

    // Reconstruction from the snapshot reproduces the exact document (state vector).
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, snap!.state);
    expect(rebuilt.getText('t').toString()).toBe('Hello brave world');
    expect(sv(rebuilt).equals(sv(src))).toBe(true);
  });

  it('keeps updates that arrive after the snapshot fold point', async () => {
    const doc = await createDocument(userId, 'Doc');
    const src = new Y.Doc();

    const u1 = record(src, () => src.getText('t').insert(0, 'AAA'));
    await appendUpdate(doc.id, u1);
    const foldSeq = await maxUpdateSeq(doc.id);
    const snapState = Y.encodeStateAsUpdate(src);

    // A later edit appended AFTER we captured the fold point/state.
    const u2 = record(src, () => src.getText('t').insert(src.getText('t').length, 'BBB'));
    await appendUpdate(doc.id, u2);

    // Compact only through foldSeq — u2 must survive as the tail.
    await saveSnapshot(doc.id, snapState, foldSeq);
    const tail = await loadUpdatesAfter(doc.id, (await loadSnapshot(doc.id))!.throughSeq);
    expect(tail.length).toBe(1);

    // Cold load = snapshot + tail replay reproduces the full document.
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, (await loadSnapshot(doc.id))!.state);
    for (const u of tail) Y.applyUpdate(rebuilt, u);
    expect(rebuilt.getText('t').toString()).toBe('AAABBB');
    expect(sv(rebuilt).equals(sv(src))).toBe(true);
  });

  it('rolls back a failed compaction, leaving no partial state', async () => {
    const doc = await createDocument(userId, 'Doc');
    const src = new Y.Doc();
    src.getText('t').insert(0, 'keep me');
    await appendUpdate(doc.id, Y.encodeStateAsUpdate(src));
    const before = (await loadUpdatesAfter(doc.id, 0)).length;
    expect(before).toBe(1);

    // A snapshot for a NON-EXISTENT document violates the FK on INSERT; the whole
    // transaction (insert + delete) must roll back — no snapshot row is created and
    // the real document's log is untouched.
    const fakeDocId = '00000000-0000-0000-0000-000000000000';
    await expect(saveSnapshot(fakeDocId, Y.encodeStateAsUpdate(src), 999)).rejects.toBeTruthy();

    expect(await loadSnapshot(fakeDocId)).toBeNull();
    expect((await loadUpdatesAfter(doc.id, 0)).length).toBe(before); // real log intact
  });
});
