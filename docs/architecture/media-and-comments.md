# Media attachments & inline comments

This document describes two features that deliberately use _different_ persistence
models, and why. It complements [ADR 0012 (media)](adr/0012-media-storage.md) and
[ADR 0013 (comments)](adr/0013-inline-comments.md).

The guiding rule: **Yjs is for collaborative document structure/state. Binary files are
not.** Comments _are_ collaborative state, so they live in Yjs; image _binaries_ do not,
so they live in object storage and are referenced from the document by id.

## Media architecture

```
Editor ──(ProseMirror/Yjs)──> media node { mediaId, mime, width, height, alt }
                                     │  mediaId (uuid)  ← the ONLY thing in the CRDT
                                     ▼
                              media metadata row  (Postgres: media table)
                                     │  storage_key (uuid)
                                     ▼
                              object storage  (MediaStorage → LocalMediaStorage on disk)
```

- **Source of truth.** The document reference (`mediaId`, render hints) is Yjs/CRDT
  state. The metadata row (owner, storage key, mime, size, dims) is Postgres. The bytes
  are in object storage. Each layer owns exactly one thing; there is no duplication and
  no base64 in the CRDT.
- **Upload (server is the authority).** `POST /api/documents/:id/media` (multipart,
  **editor/owner only**): authorize → size-cap → **sniff MIME from content** (PNG/JPEG/
  WebP only; the client's declared type is ignored) → generate a **UUID storage key**
  (never a filename/path) → store bytes → insert metadata → return `{ mediaId, … }`. The
  editor inserts the media node **only after** this succeeds, so a broken reference is
  never created.
- **Serving (authenticated, never public).** `GET /api/documents/:id/media/:mediaId`
  (**membership required**) streams the bytes with the stored `Content-Type`,
  `Content-Disposition: inline`, and `X-Content-Type-Options: nosniff`. The client media
  node view fetches this with the authenticated api client (Bearer + refresh) and renders
  an **object URL**. There are no public/signed URLs, so a non-member — or a forged /
  cross-document `mediaId` — gets **404** and cannot retrieve private media by guessing.
- **Collaboration.** The binary upload is _not_ a CRDT op; the media node _is_. Insert/
  delete/move of the node are ordinary Yjs transactions, so they converge, undo/redo, and
  survive offline like any block. One edge case is handled explicitly: when the media node
  is the document's **only** block, deleting it and backfilling the required empty
  paragraph in a _single_ transaction replaces the fragment's sole child wholesale, which
  y-prosemirror's structural full-replace path does not translate into a Yjs deletion (the
  node would resurrect on collaborators). Both deletion paths (the node view's Remove
  button and the Backspace/Delete keymap) therefore append the backfill paragraph in a
  **separate** transaction first, so the media removal is an incremental "remove one of two
  children" — the path y-prosemirror maps to a real, converging Yjs delete.
- **Offline (honest).** A new upload needs the network; while offline the Insert-Media
  action is blocked with a clear message — we never fabricate an upload. Existing media
  renders when its authenticated fetch succeeds (online / HTTP-cached); otherwise a
  placeholder is shown. No IndexedDB upload queue in the MVP.
- **Deletion / orphans (no race-sensitive deletes).** Deleting a media node removes only
  the CRDT reference; the binary/metadata are not deleted synchronously (a concurrent or
  undo branch may still reference the id). Permanently deleting a document cascades its
  `media` rows (FK `ON DELETE CASCADE`); on-disk binaries are swept by a **future,
  separate GC** of unreferenced storage keys (documented, not implemented in the MVP).
- **Export.** Export fetches only the current document's authorized media via the same
  endpoint (never arbitrary URLs). PDF embeds PNG/JPEG (`pdf-lib`); DOCX embeds PNG/JPEG
  (`ImageRun`). WebP and any unavailable image become a clear placeholder. Text-only
  export is unaffected.
- **Security constraints.** Authenticated upload; owner/editor to write, viewer cannot;
  content-sniffed allow-list; independent size cap; safe generated keys; storage paths
  verified to stay within the media root; fixed `Content-Disposition`; `nosniff`; no HTML/
  SVG/executables. See [security.md](security.md).

### Clipboard / drag-drop image insert

- **Paste / drop → upload → node.** A pasted or dropped IMAGE goes through the SAME
  authenticated upload path as the toolbar button (`MediaPaste` ProseMirror plugin +
  `uploadMedia`). Only real `File` items of the allow-list types (PNG/JPEG/WebP) taken from
  the `DataTransfer` are accepted; the upload happens FIRST and the media node (a `mediaId`
  reference only) is inserted after the server confirms. No Blob/base64/data-URL ever enters
  Yjs or ProseMirror state. A failed/offline upload shows a toast and inserts nothing (no
  orphan reference).
- **No remote-URL media (defensive).** The plugin never reads `<img src="…">` out of pasted
  HTML, and the `media` node's `parseHTML` only matches `img[data-media-id]`. So pasting web
  HTML can never create an externally loaded / unsafe remote media URL; the useful text of
  such a paste is kept by ProseMirror's normal handler (the foreign `<img>` is dropped).
- **Copy within Scribe.** The `media` node's attributes round-trip through the clipboard
  HTML (`parseHTML`/`renderHTML`), so copying a Scribe image and pasting it back reconstructs
  the SAME node (same `mediaId` + layout + size) WITHOUT re-uploading — only the reference
  travels, never the binary. (Pasting into a _different_ document references a `mediaId` that
  document does not own → 404 placeholder; cross-document copy is a documented limitation.)

### Layout, alignment & resize (document-semantic, collaborative)

The `media` node is a block-level atom. Its layout is expressed as node ATTRIBUTES, so every
layout change is document state that converges across collaborators and survives reload —
never client-only DOM:

- `layout` ∈ `block` | `wrap-left` | `wrap-right`; `align` ∈ `left` | `center` | `right`
  (applies to `block`). `block` = a standalone image (word-processor "break text") aligned
  left/center/right; `wrap-left`/`wrap-right` float the image so following blocks flow around
  it.
- **Inline (in-paragraph) placement is intentionally NOT offered.** A ProseMirror node is
  either block or inline (not both), and true inline media would fight the top-level A4
  pagination. `wrap-left`/`wrap-right` cover the practical "flow text around the image" need
  deterministically. This is a deliberate, documented boundary, not a half-built feature.
- **Resize.** The node view shows a corner handle when the image is selected (editable only).
  Dragging previews in local DOM and COMMITS the final `width`/`height` as ONE attribute
  transaction on release (no per-move transactions → no collaboration noise). Width is clamped
  to `[48px, page content width]` so an image can never exceed the page/content boundary, and
  aspect ratio is preserved. Transient drag state never enters Yjs.
- **Export uses the document state, not the DOM.** PDF/DOCX size the image from the stored
  `width` (clamped to the content column) and place it by the node's `align`; wrap layouts
  collapse to their float side (left/right) — the closest deterministic representation, since
  the page-flow exporters don't reflow text around a floated image. Export never depends on the
  browser viewport, and remains light/theme-independent.

## Comment architecture

```
Editor selection ──> comment MARK { commentId }         (ProseMirror mark, in the Yjs XML fragment)
                          │  commentId
                          ▼
                     comments Y.Map: commentId -> { id, authorId, authorName, text,
                                                    createdAt, resolved, resolvedBy }
```

- **Source of truth.** Everything is in the **one Y.Doc**. The **anchor** is a `comment`
  mark (it moves with the text via ProseMirror mapping — no absolute offsets are stored),
  and the **thread data** is a `Y.Map` (`comments`) in the same doc. Both are CRDT state,
  so they converge, work offline, and persist through the existing collaboration
  persistence. There is no comments table and no second sync engine.
- **The mark carries no text.** It only tints a range, so it never changes the document's
  textual content and is **excluded from export**.
- **MVP scope.** Select → add → view → resolve → reopen → delete → author shown →
  highlighted anchor → navigate (side panel). No threaded replies, reactions, mentions,
  or notifications.
- **Permissions.** **Viewers cannot comment**: a viewer's collaboration connection is
  read-only, so any comment mark/map write is a Yjs update over a read-only connection and
  is rejected server-side — the same boundary that makes the document read-only. Editors/
  owners may create/resolve/reopen/delete. Because Hocuspocus does not validate individual
  field writes, an editor can technically mutate any comment (author is recorded and shown;
  the enforced boundary is "editor-or-owner may mutate the document, and therefore
  comments"). This is the documented MVP policy.
- **Offline.** Full offline support (it is Yjs): create/resolve/reopen/delete offline,
  merge on reconnect.
- **Export.** Comments are never rendered into PDF/DOCX (the mark carries no text and the
  export model ignores it; the comments map is never read by export).
- **Known limitations.** Overlapping comments on the exact same range share one visible
  anchor attribute; per-comment author-only deletion is a UI affordance, not a
  server-enforced rule; a fully deleted range drops its mark (the orphaned map entry is
  pruned best-effort by the client).

## Why the split is correct

Putting binaries in Yjs would bloat the CRDT and couple storage to the editor; putting
comments in a side database would reintroduce absolute-offset drift and a two-source
reconciliation problem. Each feature uses the model that matches its data: **references +
object storage** for large immutable binaries, **one CRDT** for collaborative annotations.

## Testing

- **Server (integration + unit):** upload authorization by role, content-sniffed MIME
  validation, size limits, safe storage keys + path-traversal rejection, metadata
  persistence, membership-scoped serving, forged/cross-document id → 404 (see
  `test/integration/media.test.ts`, `src/modules/media/*.test.ts`).
- **Shared/web (unit):** media node & comment mark schema round-trips; export maps media
  to a reference and excludes comments; comment anchor apply/resolve/delete and
  **survival under text edits** via ProseMirror mapping; convergence across two Y.Docs
  (`comments.test.tsx`); PDF/DOCX image embed + placeholder.
- **E2E (real Chromium):** insert image → renders → delete → two users converge;
  unauthorized upload/serve blocked; comment create/resolve/survives-edit/collaborate;
  viewer read-only; export excludes comments.
