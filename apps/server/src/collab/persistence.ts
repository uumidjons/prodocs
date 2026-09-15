import { getSchema } from '@tiptap/core';
import { COLLAB_FIELD, EMPTY_DOCUMENT_CONTENT, buildBaseExtensions } from '@scribe/shared';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import type { Document } from '@hocuspocus/server';
import { logSecurityEvent } from '../observability/events.js';
import {
  appendUpdate,
  loadSnapshot,
  loadUpdatesAfter,
  maxUpdateSeq,
  saveSnapshot,
} from '../modules/persistence/repo.js';

/**
 * Postgres persistence for collaborative documents, wired into Hocuspocus's
 * lifecycle hooks (ADR-0005 / persistence.md). Content lives ONLY as binary Yjs
 * state — never HTML or ProseMirror JSON on the server.
 *
 *   onLoadDocument  → snapshot + tail replay reconstructs the Y.Doc (seed if new)
 *   onChange        → append each incoming update to the log (crash-safe)
 *   onStoreDocument → compact: write a fresh snapshot and truncate folded updates
 *                     (runs debounced during editing and once on last disconnect)
 *
 * This is the "smallest correct" hybrid: no update loss, reconstructable, bounded
 * storage. A scheduled background compactor is intentionally deferred — snapshots
 * happen on the debounce and on unload, which bounds the log in practice; a
 * time-based compactor is a Phase 4 refinement (documented, not silently skipped).
 */

// ProseMirror schema derived from the SHARED base extensions, so the seeded
// Y.XmlFragment maps exactly onto what the browser editor expects.
const schema = getSchema(buildBaseExtensions());

/**
 * Build the seed Y state for a brand-new BLANK document: an empty ProseMirror doc
 * (one empty paragraph). Documents created from a template are NOT seeded here —
 * their content is copied into their snapshot at creation time (templateCopy.ts), so
 * this path only runs for genuinely blank documents.
 */
function encodeSeedState(): Uint8Array {
  const seededDoc = prosemirrorJSONToYDoc(schema, EMPTY_DOCUMENT_CONTENT, COLLAB_FIELD);
  return Y.encodeStateAsUpdate(seededDoc);
}

export async function onLoadDocument({
  documentName,
  document,
}: {
  documentName: string;
  document: Document;
}): Promise<Document> {
  const snapshot = await loadSnapshot(documentName);
  let existed = false;

  if (snapshot) {
    Y.applyUpdate(document, snapshot.state);
    existed = true;
  }

  const tail = await loadUpdatesAfter(documentName, snapshot?.throughSeq ?? 0);
  for (const update of tail) {
    Y.applyUpdate(document, update);
    existed = true;
  }

  // Brand-new document (no snapshot, no updates): seed it once, server-side, and
  // persist the seed immediately so it survives even if no one edits. A persist
  // failure here shouldn't block loading — the seed is still applied in memory.
  if (!existed) {
    Y.applyUpdate(document, encodeSeedState());
    try {
      await saveSnapshot(documentName, Y.encodeStateAsUpdate(document), 0);
    } catch (err) {
      if (!isDocumentGone(err)) {
        logSecurityEvent('persistence.failure', {
          op: 'seed',
          documentName,
          message: errMessage(err),
        });
      }
    }
  }

  return document;
}

/** Postgres foreign-key violation — the document row no longer exists (deleted). */
function isDocumentGone(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

export async function onChange({
  documentName,
  update,
}: {
  documentName: string;
  update: Uint8Array;
}): Promise<void> {
  // Append synchronously in the change path — this is the durability guarantee.
  // Never reject: a persistence failure must not tear down the live connection
  // (the client's IndexedDB + reconnect handshake re-offers the update).
  try {
    await appendUpdate(documentName, update);
  } catch (err) {
    if (!isDocumentGone(err)) {
      logSecurityEvent('persistence.failure', {
        op: 'append',
        documentName,
        message: errMessage(err),
      });
    }
  }
}

export async function onStoreDocument({
  documentName,
  document,
}: {
  documentName: string;
  document: Document;
}): Promise<void> {
  // Capture the max seq BEFORE encoding so updates that arrive during/after
  // encoding are not deleted (they'll be replayed over this snapshot next load).
  try {
    const throughSeq = await maxUpdateSeq(documentName);
    const state = Y.encodeStateAsUpdate(document);
    await saveSnapshot(documentName, state, throughSeq);
  } catch (err) {
    // A document deleted mid-session (or between debounce and flush) is expected;
    // anything else is logged but must not crash the (often detached) store path.
    if (!isDocumentGone(err)) {
      logSecurityEvent('persistence.failure', {
        op: 'snapshot',
        documentName,
        message: errMessage(err),
      });
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
