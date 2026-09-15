import { pool } from '../../db/pool.js';

/**
 * Data access for the collaborative-document persistence tables (doc_update /
 * doc_snapshot). Pure DB I/O over binary Yjs data — no CRDT logic here; the
 * collab layer decides when to append vs. compact. See persistence.md.
 */

export interface Snapshot {
  state: Uint8Array;
  throughSeq: number;
}

/** Latest compacted snapshot for a document, or null if it has never been stored. */
export async function loadSnapshot(documentId: string): Promise<Snapshot | null> {
  const { rows } = await pool.query<{ state: Buffer; through_seq: string }>(
    'SELECT state, through_seq FROM doc_snapshot WHERE document_id = $1',
    [documentId],
  );
  const row = rows[0];
  if (!row) return null;
  return { state: new Uint8Array(row.state), throughSeq: Number(row.through_seq) };
}

/** Binary updates newer than `afterSeq`, in order — the tail to replay over the snapshot. */
export async function loadUpdatesAfter(
  documentId: string,
  afterSeq: number,
): Promise<Uint8Array[]> {
  const { rows } = await pool.query<{ update: Buffer }>(
    'SELECT update FROM doc_update WHERE document_id = $1 AND seq > $2 ORDER BY seq ASC',
    [documentId, afterSeq],
  );
  return rows.map((r) => new Uint8Array(r.update));
}

/** Appends one binary Yjs update to the log (the crash-safe write path). */
export async function appendUpdate(documentId: string, update: Uint8Array): Promise<void> {
  await pool.query('INSERT INTO doc_update (document_id, update) VALUES ($1, $2)', [
    documentId,
    Buffer.from(update),
  ]);
}

/** True when a document has no persisted CRDT state at all (candidate for seeding). */
export async function hasPersistedState(documentId: string): Promise<boolean> {
  const snap = await pool.query('SELECT 1 FROM doc_snapshot WHERE document_id = $1', [documentId]);
  if ((snap.rowCount ?? 0) > 0) return true;
  const upd = await pool.query('SELECT 1 FROM doc_update WHERE document_id = $1 LIMIT 1', [
    documentId,
  ]);
  return (upd.rowCount ?? 0) > 0;
}

/**
 * Compaction: fold the current full state into a single snapshot and truncate the
 * updates it covers — in ONE transaction, so a crash leaves either the old
 * (snapshot + full log) or the new (snapshot only) state, never a gap.
 *
 * `throughSeq` must be the max `seq` observed at encode time; only updates with
 * `seq <= throughSeq` are deleted, so updates that arrived during encoding survive.
 */
export async function saveSnapshot(
  documentId: string,
  state: Uint8Array,
  throughSeq: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO doc_snapshot (document_id, state, through_seq, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (document_id)
       DO UPDATE SET state = EXCLUDED.state, through_seq = EXCLUDED.through_seq, created_at = now()`,
      [documentId, Buffer.from(state), throughSeq],
    );
    await client.query('DELETE FROM doc_update WHERE document_id = $1 AND seq <= $2', [
      documentId,
      throughSeq,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Current maximum update seq for a document (0 when the log is empty). */
export async function maxUpdateSeq(documentId: string): Promise<number> {
  const { rows } = await pool.query<{ max: string | null }>(
    'SELECT MAX(seq) AS max FROM doc_update WHERE document_id = $1',
    [documentId],
  );
  return rows[0]?.max ? Number(rows[0].max) : 0;
}
