import * as Y from 'yjs';
import {
  hasPersistedState,
  loadSnapshot,
  loadUpdatesAfter,
  saveSnapshot,
} from '../persistence/repo.js';

/**
 * Server-side "create from template" content copy (task §4/§5).
 *
 * Copies the SOURCE document's collaborative content into a brand-new, independent
 * TARGET document by:
 *   1. reconstructing the source Y.Doc from its persisted state (snapshot + tail
 *      replay) — the exact same reconstruction the collab load path uses, so the
 *      copy reflects the last durably-persisted content;
 *   2. re-encoding that state and writing it as the target's INITIAL snapshot.
 *
 * What this deliberately does NOT do (task §5):
 *   - It never links the target to the source's live Y.Doc — the target gets its
 *     own encoded state, its own room, its own IndexedDB, its own persistence rows.
 *   - It copies only durable document CONTENT. Awareness/presence, cursors and
 *     selections are ephemeral and are never persisted, so there is nothing to copy.
 *   - Memberships are handled by the caller (the creator becomes owner); this
 *     function touches only the persistence tables.
 *
 * Because the target already has a snapshot after this runs, the collab load path
 * sees it as an existing document and will NOT overwrite it with the default seed.
 *
 * Returns true when content was copied, false when the source had no persisted
 * state yet (e.g. it was created but never opened) — in that case the target is
 * left empty and the normal first-open seeding applies.
 */
export async function copyDocumentContent(
  sourceDocumentId: string,
  targetDocumentId: string,
): Promise<boolean> {
  if (!(await hasPersistedState(sourceDocumentId))) return false;

  const doc = new Y.Doc();
  try {
    const snapshot = await loadSnapshot(sourceDocumentId);
    if (snapshot) Y.applyUpdate(doc, snapshot.state);
    const tail = await loadUpdatesAfter(sourceDocumentId, snapshot?.throughSeq ?? 0);
    for (const update of tail) Y.applyUpdate(doc, update);

    // Persist as the target's initial snapshot (through_seq = 0: no update log yet).
    await saveSnapshot(targetDocumentId, Y.encodeStateAsUpdate(doc), 0);
    return true;
  } finally {
    doc.destroy();
  }
}
