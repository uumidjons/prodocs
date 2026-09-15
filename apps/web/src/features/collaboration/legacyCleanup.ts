/**
 * One-time removal of the Phase 1 localStorage document-content bridge.
 *
 * Phase 1 cached document content as ProseMirror JSON under `scribe:doc-draft:v1:*`
 * keys. Phase 2 makes the Y.Doc (with y-indexeddb locally and Postgres on the
 * server) the single source of truth, so those keys are obsolete. The writing code
 * is gone; this purges any keys left in a returning user's browser so there is no
 * dormant second copy of document content. Safe to run on every startup.
 */
const LEGACY_DRAFT_PREFIX = 'scribe:doc-draft:';

export function removeLegacyDraftStorage(): void {
  try {
    const stale = Object.keys(window.localStorage).filter((k) => k.startsWith(LEGACY_DRAFT_PREFIX));
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Private mode / storage disabled — nothing to clean up.
  }
}
