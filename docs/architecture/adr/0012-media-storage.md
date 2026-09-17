# ADR 0012 — Media attachments: storage, schema, and serving

**Status:** Accepted

## Context

"Insert Media" must let editors add images to a document. Binary files have a
different lifecycle from collaborative text: they are large, immutable once uploaded,
and must not travel through the CRDT. The existing system has **no object-storage
abstraction**, document content lives **only** in Yjs (binary updates in Postgres +
IndexedDB), and access is gated by the `memberships` table (enforced identically over
REST and the collaboration WebSocket).

## Decision

### Three-part model (the reference the phase asks for)

```
Editor ──(ProseMirror/Yjs)──> media node { mediaId, mime, width, height, alt }
                                     │  mediaId (uuid)
                                     ▼
                              media metadata row  (Postgres: media table)
                                     │  storage_key (uuid)
                                     ▼
                              object storage  (MediaStorage → LocalMediaStorage on disk)
```

- **The binary never enters Yjs or ProseMirror JSON.** No base64. The document holds
  only a stable `mediaId` (plus render hints).
- **Metadata** lives in a new additive `media` table (migration 006): `id`,
  `document_id`, `uploaded_by`, `storage_key`, `mime_type`, `byte_size`,
  `original_filename`, `width`, `height`, `created_at`, `deleted_at`. UUID PKs +
  `TIMESTAMPTZ` + `ON DELETE CASCADE` match existing conventions.
- **Binary** lives behind a small `MediaStorage` interface (`put`/`get`/`delete`), with
  a filesystem `LocalMediaStorage` implementation rooted at `config.media.dir`
  (`MEDIA_DIR`, default `<cwd>/var/media`, a docker named volume in compose). The
  interface keeps storage decoupled from the editor and swappable for S3/MinIO later
  without touching callers. **No provider-specific SDK** is introduced for the MVP.

### Supported types (constrained scope)

**PNG, JPEG, WebP only.** The server sniffs the **actual bytes** (magic numbers) and
ignores the client-declared MIME. HTML, SVG, and executables are rejected (SVG is
excluded specifically because it can carry script — out of MVP scope). Max size:
`MEDIA_MAX_BYTES` (default 5 MiB).

### Upload flow (server is the authority)

`POST /api/documents/:id/media` (multipart, **editor/owner only**):

1. `authenticate` (Bearer) → `requireEditor(documentId)` (membership + role; viewer →
   403, non-member → 404, matching REST access-enumeration rules).
2. Read the file under a hard byte cap; **sniff MIME from content** (reject on
   mismatch/unsupported); read intrinsic width/height where cheap.
3. Generate a **UUID `storage_key`** (never the user filename, never a path) and write
   the bytes via `MediaStorage.put`.
4. Insert the metadata row; return `{ mediaId, mime, width, height, byteSize }`.
5. **Only then** does the client insert the media node → Yjs syncs the reference. No
   optimistic/broken node is ever created.

### Serving (authenticated, never public)

`GET /api/documents/:id/media/:mediaId` (Bearer, **membership required**): streams the
bytes with the stored `Content-Type`, `Content-Disposition: inline`,
`X-Content-Type-Options: nosniff`, and a private cache. A non-member — or a forged
`mediaId`, or a `mediaId` from another document — gets **404**. There are no public URLs
and no signed URLs. The client media node view fetches this endpoint with the existing
authenticated api client (Bearer + transparent refresh), converts the response to an
**object URL**, and sets `<img src>`. This reuses the one auth path and keeps private
media private.

### Collaboration vs. upload

The **binary upload is not a CRDT operation**; the **media node is**. Insertion,
deletion, and movement of the media node are ordinary Yjs transactions and therefore
converge, undo/redo, and survive offline like any block. Two clients inserting/deleting
media converge because only the small node reference is collaborative.

### Offline (honest policy)

A brand-new upload **requires the network** (it is an HTTP POST). While offline the
Insert-Media action is disabled with a clear message; we **never** create a node
referencing a binary that was not uploaded. Already-inserted media renders when its
authenticated fetch succeeds (online, or from the browser HTTP cache); offline it shows
a placeholder. No fake offline-upload success. No IndexedDB upload queue in the MVP.

### Deletion / orphans (no race-sensitive deletes)

Deleting a media node just removes the CRDT reference; the binary and metadata are **not
deleted synchronously**, because a concurrent/undo CRDT branch may still reference the
same `mediaId`. Permanently deleting a document cascades its `media` rows (FK
`ON DELETE CASCADE`); the on-disk binaries are left for a **future, separate GC sweep**
of unreferenced storage keys (documented, not implemented in the MVP). This deliberately
trades a little disk for correctness under concurrency.

### Export

Export runs in the browser and fetches only the **current document's** authorized media
via the same endpoint (never arbitrary URLs). PDF embeds PNG/JPEG (`pdf-lib`); WebP is
not embeddable by pdf-lib and renders as a labeled placeholder box. DOCX embeds PNG/JPEG
via `ImageRun`. If a binary is unavailable (e.g. offline), export uses a clear
placeholder and never fails the whole export. Text-only export is unaffected.

## Alternatives considered

- **Base64 in Yjs / ProseMirror** — rejected outright (bloats the CRDT, breaks the
  binary/collaborative-state separation the phase mandates).
- **Large blobs in Postgres `bytea`** — rejected; binaries belong in object storage,
  and the existing architecture does not require DB blobs.
- **Public or signed URLs** — rejected for the MVP; authenticated blob fetch reuses the
  existing auth and keeps private-document media private with no new infra.
- **A cloud provider (S3/MinIO) now** — deferred behind the `MediaStorage` interface.

## Consequences / limitations

- Media is not available offline unless the browser cached it; documented.
- Orphaned binaries accumulate until a future GC; bounded by the size cap and rare in
  practice.
- WebP does not embed in PDF (placeholder); PNG/JPEG do.
