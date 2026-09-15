import type { DocumentDto } from '@scribe/shared';

/**
 * A tiny local cache of document *metadata* (title, role, timestamps) — NOT
 * document content.
 *
 * Why this exists: the collaborative body is the Y.Doc persisted in IndexedDB
 * (ADR-0004), so it already survives offline reloads. But opening a document also
 * needs its metadata (title + the user's role, which gates viewer read-only), and
 * that normally comes from a REST `GET /documents/:id`. If the browser reloads
 * while offline, that request fails and the document could not open at all — the
 * editor would never mount even though the CRDT is sitting in IndexedDB. Caching
 * the metadata lets a *previously-seen* document open offline.
 *
 * This is explicitly NOT the "save the latest HTML/JSON in localStorage" offline
 * anti-pattern the spec forbids: no document content is stored here, only the
 * small metadata row. Content still lives solely in the Yjs CRDT (IndexedDB
 * locally, Postgres on the server) and still merges via the state-vector
 * handshake on reconnect. localStorage is used only because this metadata is
 * small, string-shaped, and read once synchronously on open.
 *
 * Offline document *creation* remains out of MVP (ADR-0004): this cache only ever
 * serves documents the server already issued an id + membership for and that the
 * user has opened at least once online.
 */
const META_PREFIX = 'scribe:doc-meta:v1:';

export function cacheDocumentMeta(doc: DocumentDto): void {
  try {
    window.localStorage.setItem(META_PREFIX + doc.id, JSON.stringify(doc));
  } catch {
    // Private mode / storage disabled — offline metadata durability is simply off.
  }
}

export function readCachedDocumentMeta(id: string): DocumentDto | null {
  try {
    const raw = window.localStorage.getItem(META_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DocumentDto>;
    // Validate the shape defensively — a corrupt entry must not open a broken view.
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.title === 'string' &&
      typeof parsed.role === 'string'
    ) {
      return parsed as DocumentDto;
    }
    return null;
  } catch {
    return null;
  }
}
