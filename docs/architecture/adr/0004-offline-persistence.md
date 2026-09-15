# ADR-0004 — Offline Persistence: IndexedDB via `y-indexeddb`

**Status:** Accepted · **Directly serves the most-scrutinized requirement.**

## Context

Users must edit offline, have changes persist locally, and merge (not overwrite) on
reconnect. The spec explicitly warns against a "save the latest HTML in localStorage"
offline mode and asks us to justify the storage choice.

## Decision

Persist the client-side `Y.Doc` in **IndexedDB** using the **`y-indexeddb`** provider,
which stores the CRDT's **binary updates** (plus periodic compacted state), not rendered
content.

## Alternatives considered

- **localStorage** — rejected: synchronous (blocks the UI on the typing path), ~5 MB
  string-only cap (CRDT updates are binary), and only stores the latest value per key,
  which structurally pushes you toward "overwrite the doc on reconnect" — the exact
  data-losing anti-pattern the spec forbids.
- **OPFS / File System Access API** — powerful but lower-level, less browser support, and
  no ready Yjs provider; unnecessary complexity for this need.
- **In-memory only** — no durability across reloads/crashes; fails the offline requirement.
- **Custom IndexedDB layer** — reinvents `y-indexeddb`, which already handles update
  storage + compaction correctly.

## Why IndexedDB + y-indexeddb

- **Asynchronous** — never blocks typing.
- **Large, binary-capable** — stores real documents and long offline sessions; keeps
  updates as bytes, no base64 bloat.
- **Stores updates, so merge stays lossless** — on reconnect the client contributes a
  _diff_ to the state-vector handshake and merges with the server; it does not push a whole
  document that would clobber concurrent edits. This is the crux of genuine offline support
  (see [../offline-sync.md](../offline-sync.md)).
- **Offline-first load** — the provider can render last-known content from IndexedDB before
  the socket even connects.
- **Compaction** keeps the local store bounded over time.

## Trade-offs

- IndexedDB can be unavailable (private mode / blocked): we degrade to in-memory for the
  session and warn, rather than fail.
- Per-origin storage: fine here; documents are keyed by id in one origin.

## Consequences

- The offline lifecycle, edge cases (two tabs, reload-while-offline, IDB unavailable), and
  the conflict matrix in [../offline-sync.md](../offline-sync.md) all rely on this provider.
- Offline document _creation_ is out of MVP scope (needs a server-issued id first); flagged
  explicitly rather than silently assumed.

## Status note (implemented in Phase 2)

`y-indexeddb` is **implemented** as of Phase 2: each open document's `Y.Doc` is persisted
locally in IndexedDB (`features/collaboration/useCollaboration.ts`) alongside the Hocuspocus
provider. The temporary Phase 1 `localStorage` ProseMirror-JSON cache has been **removed** — the
writing code is gone and any leftover `scribe:doc-draft:*` keys are purged on startup
(`features/collaboration/legacyCleanup.ts`), so there is exactly one client-side content store
(the CRDT in IndexedDB).

Scope reminder: having `y-indexeddb` in place is the _foundation_ for offline, not the whole
story. The full offline/reconnect/merge behavior this ADR enables is exercised and hardened in
Phase 3 (see [../offline-sync.md](../offline-sync.md)).

## Status note (Phase 3 — offline hardened)

The offline lifecycle this ADR enables is now implemented and tested end to end (offline
edit, reload, reconnect, divergent/overlapping merges, flapping, long offline,
server-restart-while-offline). Two decisions were made under this ADR during Phase 3:

- **Metadata (not content) is cached in `localStorage`** so a locally-known document can
  open after an offline reload (`features/documents/metadataCache.ts`). This is a small
  `{id, title, role, timestamps}` row only; document **content** remains exclusively in the
  Yjs CRDT (IndexedDB + Postgres), so the "no latest-HTML-in-localStorage" rejection above
  still holds in full. The fallback triggers only on a network failure, never on an
  authoritative `ApiError`, so a revoked grant is not masked by stale cache.
- **Reloading while _still_ offline** additionally needs an app-shell (service-worker/PWA)
  cache to re-serve the HTML/JS bundle. That is **out of MVP scope** and remains unbuilt;
  the CRDT content durability owned by this ADR is unaffected (it is in IndexedDB) and is
  restored on the next load once the network returns.

Offline document _creation_ remains out of MVP (unchanged): a brand-new document needs a
server-issued id + membership row before it can be edited offline.
