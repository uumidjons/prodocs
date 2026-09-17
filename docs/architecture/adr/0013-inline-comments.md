# ADR 0013 — Inline comments: anchoring, storage, and authorization

**Status:** Accepted

## Context

Inline comments annotate a range of document text with a discussion note that can be
resolved. They must **not** become part of the document's text flow, must **survive
normal editing** (the anchor has to move as text before it changes), must collaborate
and work offline, and must be excluded from normal export. The system already has one
CRDT (Yjs) that is the single source of truth and is synchronized over an authenticated
WebSocket that marks viewer connections read-only.

## Decision

### Everything lives in the one Yjs document (no second sync engine, no DB table)

A comment has two parts, both in the **same `Y.Doc`**:

```
Editor selection ──> comment MARK { commentId }         (ProseMirror mark, in the Yjs XML fragment)
                          │  commentId
                          ▼
                     comments Y.Map: commentId -> { id, author{ id, name }, text,
                                                    createdAt, resolved, resolvedBy? }
```

1. **Anchor = a ProseMirror `comment` mark** (attr `commentId`) added to the selected
   range. Because it is an ordinary mark inside the collaborative document, **ProseMirror
   transaction mapping moves it automatically** as surrounding text is inserted/deleted —
   we never store raw absolute offsets. The mark only tints the text; it never adds or
   removes characters, so it does not affect the document's textual content or export.
2. **Thread data = a `Y.Map` named `comments`** in the same `Y.Doc`
   (`ydoc.getMap('comments')`). It holds the author identity, text, `createdAt`,
   `resolved` flag, and `resolvedBy`. Being CRDT state, it converges across
   collaborators and works offline with no extra machinery.

**Source of truth for every field is Yjs.** There is no separate comments database, so
there is no "editor says X / DB says Y" reconciliation problem. Comments are **not**
persisted in Postgres beyond the fact that the whole Y.Doc (including the comments map
and the marks) is already persisted as binary Yjs updates/snapshots by the existing
collaboration persistence.

### MVP scope

Select text → add comment → view → resolve → reopen → delete → author shown → anchored
highlight → navigate between comments (a side panel). **No** threaded replies, reactions,
mentions, notifications, or email — deliberately out of scope (§17).

### Permissions (enforced by the existing security boundary)

- **Viewer:** **cannot comment.** A viewer's collaboration connection is read-only, so
  any attempt to write the comment mark or the comments map is a Yjs update over a
  read-only connection and is **rejected server-side** — the same boundary that already
  makes the document read-only for viewers. The comment UI is also disabled for viewers,
  but the security boundary is the server, not the UI.
- **Editor / Owner:** may create, resolve, reopen, and delete comments.
- Because comments are Yjs state and Hocuspocus does not validate individual field
  writes, an editor can technically resolve/delete **any** comment (not only their own).
  The `author` is recorded and shown; the client may present delete only for the
  author/owner, but the enforced boundary is "editor-or-owner may mutate document
  (and therefore comments)". This is the honest, documented policy for the MVP.

### Offline

Full offline support, because comments are Yjs: create/resolve/reopen/delete offline,
then merge on reconnect. Nothing about a comment requires a server round trip.

### Export

Comments are **excluded** from PDF/DOCX. The exporter reads only the document nodes; the
`comment` mark is ignored by the export model (it carries no text), and the comments
`Y.Map` is never read by export. Normal export therefore never leaks comment text or
metadata.

## Alternatives considered

- **Comments as a Postgres table with absolute character offsets** — rejected: offsets
  break on the first concurrent edit, and it introduces a second source of truth needing
  reconciliation with the CRDT.
- **A separate Yjs document / second CRDT for comments** — rejected: a second sync
  engine is exactly what the phase forbids; one Y.Doc keeps anchor and data atomically
  consistent and offline-correct.
- **A community "official" comments extension** — none is a stable first-party Tiptap v2
  extension in this repo's toolchain; a small `comment` mark + `Y.Map` uses only the
  existing ecosystem primitives and ProseMirror's own mapping guarantees.

## Consequences / limitations

- Overlapping comments on the exact same range are not distinguished in the MVP (one
  `commentId` per mark range); creating a comment inside another's range replaces the
  visible anchor attribute on the overlap. Documented.
- Per-comment author-only deletion is a UI affordance, not a server-enforced rule (see
  Permissions). Hardening would require server-side validation of Yjs updates.
- If a commented range is fully deleted, the mark disappears with the text; the orphaned
  `Y.Map` entry is pruned by the client when no anchor remains (best-effort), and is
  harmless otherwise.
