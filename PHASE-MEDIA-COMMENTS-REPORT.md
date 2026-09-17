# Phase Report — Media Attachments & Inline Comments

Status: **COMPLETE.** The two-user media-deletion convergence blocker is fixed and
verified in real Chromium (both deletion paths, plus reload). All architecture, server
media, comments, export, docs, and unit/integration tests remain green. This report
follows the 18 required sections.

---

## 1. Architecture decisions

Unchanged from the phase design (not redesigned):

- **Media** — three layers: `media` node `{mediaId, mime, width, height, alt}` →
  `media` metadata row (Postgres) → object storage (`MediaStorage`). Binary **never** in
  Yjs/ProseMirror JSON. ADR `docs/architecture/adr/0012-media-storage.md`.
- **Comments** — a `comment` mark (anchor, moves via ProseMirror mapping) plus a
  `Y.Map('comments')` thread store, both in the **same** Y.Doc. No second CRDT, no
  comments DB table. ADR `docs/architecture/adr/0013-inline-comments.md`.
- Combined narrative: `docs/architecture/media-and-comments.md`.

The fix in this continuation did **not** alter any architectural decision. It changed
only *how* a single client structures the delete transaction so that y-prosemirror
translates it into a converging Yjs deletion.

## 2. Root causes

**The blocker — two-user media deletion did not converge.** Browser diagnostics (the
scratch two-user test logging `A_DOM / A_DOC_MEDIA / B_DOM / B_DOC_MEDIA`, plus a
per-transaction logger) proved the failure precisely:

1. After the uploader clicked Remove, its **local** transaction correctly produced
   `media:0` (`docBefore = [media]`, `docAfter = [paragraph]`).
2. ~1–2 s later a **remote (y-sync) transaction** re-inserted the media on the same
   client (`media:1, remote:true`). The node **resurrected**.

The trigger was isolated with a control experiment: when the media node was **not** the
document's only block (a sibling paragraph existed), deletion converged perfectly on
both clients (`A/B_DOM = 0`, `A/B_DOC_MEDIA = false`). The bug occurred **only** when the
media node was the document's **sole** block.

Mechanism: deleting the sole block leaves a schema-invalid empty doc, so the code
backfilled an empty paragraph. Doing the delete **and** the backfill in one transaction
replaces the fragment's only child wholesale. y-prosemirror's **structural
full-replace** path (a documented limitation, see the Phase-13 collab audit) does not
translate that whole-fragment replacement into a Yjs deletion — so the shared Yjs type
still held the media, which then re-synced back to the deleter (and never left the
collaborator).

This was **not** a node-view/DOM lifecycle problem, **not** a dual-`@tiptap/pm` problem,
and **not** a stale-`getPos` problem — the evidence ruled each out (the doc JSON, i.e.
the Yjs projection, itself diverged and re-converged to the wrong state).

## 3. Media storage

Unchanged and intact. `LocalMediaStorage` (sharded by hash, UUID keys,
path-traversal-safe), `MEDIA_DIR` (docker named volume `server_media` at
`/app/var/media`), `MEDIA_MAX_BYTES` = 5 MiB. Binary is written to object storage; only
`{mediaId}` + metadata reach the document/CRDT.

## 4. Media security

Unchanged and intact, verified by the `Media security` E2E and 11 server integration
tests: authenticated upload (owner/editor only; viewer 403), content-sniffed MIME
(magic bytes, not the browser-declared type), size cap (413), unsupported type (415),
document-scoped serve (member only; forged / cross-document `mediaId` → 404), no public
URLs (object-URL from an authenticated Bearer fetch).

## 5. Media node / schema

Unchanged `media` node (shared schema): block-level `atom`, `selectable`, `draggable`,
attrs `mediaId/mime/width/height/alt`, `renderHTML` emits `<img data-media-id>` with **no
`src`**. The client node view (`apps/web/.../mediaNodeView.ts`) performs the
authenticated fetch and sets an object URL. Deletion affordances preserved: the explicit
Remove button **and** the node's Backspace/Delete keymap.

**Change in this phase (the fix):** both deletion paths now, when the media node is the
document's only block, append the backfill paragraph in a **separate** transaction before
deleting the media, converting the operation from a full-fragment replace into an
incremental child removal that y-prosemirror maps to a real Yjs delete. The empty-doc
backfill behavior itself is preserved (never regressed).

## 6. Offline media behavior

Unchanged and honest: a **new upload** requires the network (Insert-Media is blocked
offline with a clear message — no fabricated upload, no IndexedDB queue in the MVP).
Existing media renders when its authenticated fetch succeeds (online / HTTP-cached),
else a placeholder. Media **node** insert/delete/move are ordinary Yjs ops, so they
survive offline and converge on reconnect like any block.

## 7. Comment architecture

Unchanged: `comment` mark (`commentId` + `resolved`) anchors the range; `Y.Map('comments')`
holds thread data (author, text, timestamps, resolved). Both live in the **one** Y.Doc —
no second CRDT, no DB table, no JSON/`setContent` synchronization.

## 8. Comment anchor strategy

Unchanged: the anchor is the ProseMirror/Yjs-native mark. It moves with edits through
ProseMirror position mapping (verified by the "survives an edit" E2E and the
anchor-survives-edits unit test). No offset arithmetic, no external anchor store.

## 9. Comment permissions

Unchanged: viewers cannot create or edit comments — enforced by the **read-only WS
connection** (the server boundary), with the UI (disabled controls) as a convenience.
Verified by the `Comments viewer: read-only` E2E.

## 10. Collaboration behavior

Yjs remains the sole source of truth (no LWW, no polling, no Redis, no second model,
Hocuspocus unchanged). Media node and comment mark/thread all collaborate through the
same Y.Doc. The fix keeps every deletion an ordinary, converging Yjs transaction. The
sole-block edge case is now documented in `media-and-comments.md` (Collaboration bullet).

## 11. Export behavior

Unchanged: PDF (`pdf-lib`) and DOCX (`docx`) embed PNG/JPEG via the authenticated,
document-scoped media fetch (never arbitrary URLs); WebP / unavailable images become a
clear placeholder. Comments are **excluded** from export (the `comment` mark is ignored
by `runsOf`). Verified by shared `exportModel` tests, web `pdf`/`docx` unit tests, and
the export E2E suite (5/5).

## 12. Files changed (this continuation)

- `apps/web/src/features/editor/mediaNodeView.ts` — `remove()` now appends the backfill
  paragraph in a separate transaction when media is the sole block, then deletes; all
  temporary diagnostics removed.
- `packages/shared/src/media.ts` — the Backspace/Delete keymap (`deleteIfSelected`)
  applies the same separate-transaction backfill for the sole-block case before
  `deleteSelection`, so keyboard deletion also converges.
- `docs/architecture/media-and-comments.md` — documented the sole-block deletion nuance
  in the Collaboration bullet.
- `apps/web/e2e/media-comments.spec.ts` — the two-user media test now has the **uploader**
  delete the sole-block media via Remove, asserts convergence on both clients, and adds a
  **reload** assertion (deletion survives synchronization + reload on both clients).
- `apps/web/e2e/scratch-media.spec.ts` — **deleted** (diagnostic; its regression value was
  promoted into `media-comments.spec.ts`).
- `apps/web/src/features/editor/useDocumentEditor.ts` — touched only by a temporary
  diagnostic logger that was fully reverted (no net change).

## 13. Database migration

`db/migrations/006_media.sql` (additive `media` table) — unchanged, already applied to
dev `scribe` and `scribe_test`. No new migration in this continuation.

## 14. Documentation updated

`docs/architecture/media-and-comments.md` (sole-block deletion nuance). ADRs 0012/0013
and the rest of the docs remain accurate and unchanged.

## 15. Exact test results

Deterministic (host-run):

- `@scribe/shared` unit: **56 passed** (5 files).
- `@scribe/web` unit: **167 passed** (22 files).
- `@scribe/server` unit+integration: **137 passed** (21 files).
- `pnpm typecheck`: **green** (shared, web, server).
- `pnpm lint`: **green** (`eslint .`, no output).
- `pnpm build`: **green** (shared tsc, web vite build, server tsc).
- `prettier --check` on changed files + edited doc: **green**.

Playwright (real Chromium, live dev stack):

- `media-comments.spec.ts`: **5/5** — media upload/render + sole-block two-user delete
  (with reload), media security, comments create/survive-edit/resolve, comments
  collaborate, viewer read-only.
- `page-break-editing.spec.ts`: **4/4**.
- `export.spec.ts`: **5/5**.
- `formatting.spec.ts`: **5/5**.
- `offline.spec.ts`: **5/5**.
- `sharing.spec.ts`: **2/2** (initially 429-throttled when co-run with presence; passed
  cleanly when rerun alone — the known 10/min register rate limit, not an app failure).
- `collaboration-presence.spec.ts`: **4/4**.
- `formatting-completion.spec.ts`: **5/8** — Strikethrough, Blockquote, Link,
  Collaboration, Page-break-compatibility pass. **3 fail**: the three tests that toggle a
  **task-list checkbox** (`Task checklist`, `Offline: A checks a task`, `Viewer sees the
  formatting`). See §18.

## 16. Browser verification

The blocker was diagnosed and fixed **in the browser first** (per the handoff):

- Two-user sole-block delete (uploader Remove button): before fix `A_DOM=1,
  A_DOC_MEDIA=true, B_DOM=1, B_DOC_MEDIA=true`; after fix `A_DOM=0, A_DOC_MEDIA=false,
  B_DOM=0, B_DOC_MEDIA=false`.
- Two-user sole-block delete via **keyboard** (select image, Backspace): after fix
  `KB_A_DOM=0, KB_B_DOM=0, KB_B_DOC_MEDIA=false`.
- The permanent `media-comments` delete test (uploader deletes sole-block media, both
  clients converge to zero, and stay zero after **reload** on both) passes in Chromium.

## 17. Database safety

No reset/truncate. Final check:
`SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM documents) d, (SELECT to_regclass('public.media')) media;`
→ `u=580, d=384, media=media`. The `media` table exists. Counts grew **additively** from
the pre-phase baseline (~441 users / ~305 docs) purely because this session's E2E suites
register ephemeral users and create documents additively; nothing was deleted.

## 18. Remaining limitations

- **Task-list checkbox E2E (pre-existing, unrelated to this phase).** 3 tests in
  `formatting-completion.spec.ts` that toggle a task checkbox fail: clicking the checkbox
  (via Playwright `.check()` **and** a real `.click()`) sets the native checkbox
  `checked` in the DOM but does **not** update the ProseMirror `checked` node attribute
  (`li[data-checked="true"]` never appears). This was proven **not** caused by the
  media/comments work: reverting the shared `media.ts` change and rerunning still fails
  identically, and the running web container resolves a **single** `@tiptap/pm@2.27.3`
  (no dual-copy artifact). It is a genuine task-list/TaskItem behavior in the current dev
  build, outside the media/comments phase scope, and left as-is (not masked). It should be
  triaged separately.
- **Media orphan GC** — deferred by design (documented in ADR 0012). Deleting a media node
  removes only the CRDT reference; document deletion cascades `media` rows, but on-disk
  binaries are swept by a future GC.
- **WebP export** — rendered as a placeholder in PDF/DOCX (pdf-lib/docx embed PNG/JPEG).
- **Offline upload** — a new upload requires the network (no offline upload queue in MVP).
- **`@tiptap/pm` manifest vs install** — `apps/web/package.json` still declares
  `^2.11.5`, but the container (and lockfile resolution) provides a single
  `@tiptap/pm@2.27.3`, so there is no dual copy at runtime. The media deletion keymap
  duck-types the `NodeSelection` (`.node`) regardless, so the fix is robust either way.
  Aligning the manifest to `^2.27.3` is cosmetic given the single installed copy and was
  intentionally **not** changed (avoids a needless lockfile churn; the handoff's dual-copy
  concern does not manifest in this environment).
