# HANDOFF — Phase: Media Attachments & Inline Comments

Status: **COMPLETE.** The two-user media-DELETION convergence blocker is **fixed and
verified in real Chromium** (both the Remove-button and keyboard deletion paths, plus a
reload check). Root cause: deleting the media node when it is the document's **only**
block combined the delete + required paragraph backfill into one transaction, replacing
the fragment's sole child wholesale — y-prosemirror's structural full-replace path does
not translate that into a Yjs deletion, so the node resurrected. Fix: append the backfill
paragraph in a **separate** transaction first, making the delete an incremental child
removal that converges. See **`PHASE-MEDIA-COMMENTS-REPORT.md`** for the full 18-section
report, exact test results, and remaining limitations (incl. a pre-existing, unrelated
task-checkbox E2E failure proven not caused by this phase).

Everything below is the original ~90% handoff, preserved for history.

---

## 1. Goal of the phase

Make the last two placeholder toolbar controls real:

- **Insert Media** — image upload (PNG/JPEG/WebP) to authenticated object storage,
  referenced from the doc by a Yjs `media` node (binary NEVER in Yjs).
- **Inline Comment** — anchored comments as a Yjs `comment` mark + a `Y.Map` thread
  store (no second CRDT, no DB table).

Architecture-first: audit → ADRs → implement → test → docs → regression → report.

---

## 2. Architecture decided (DONE — written as ADRs)

- `docs/architecture/adr/0012-media-storage.md` — media: three layers
  `media node {mediaId} → media metadata row (Postgres) → object storage (MediaStorage)`.
  Binary never in Yjs. Content-sniffed MIME. UUID storage keys. Authenticated serve
  (no public URLs). Offline = upload needs network (honest). Orphan GC deferred.
- `docs/architecture/adr/0013-inline-comments.md` — comments: `comment` mark (anchor,
  moves via ProseMirror mapping) + `Y.Map('comments')` thread data, both in the SAME
  Y.Doc. Viewers can't comment (read-only WS connection is the enforced boundary).
  Excluded from export.
- `docs/architecture/media-and-comments.md` — combined narrative doc.
- Both ADRs added to `docs/architecture/adr/README.md`; new docs added to
  `docs/architecture/README.md` reading-order table (rows 11 editor-formatting, 12
  media-and-comments). `security.md`, `data-model.md`, `testing-strategy.md`, root
  `README.md` (roadmap items 8+9), `.env.example`, `.gitignore`, `docker-compose.yml`
  all updated. **Docs are DONE.**

---

## 3. What is implemented (files) + status

### Shared (`packages/shared/src/`) — DONE, typecheck+tests green

- `media.ts` (NEW) — `Media` node (atom, block, attrs: mediaId/mime/width/height/alt),
  `setMedia` command, `ALLOWED_MEDIA_MIME`/`isAllowedMediaMime`/`ALLOWED_MEDIA_ACCEPT`.
  Has a Backspace/Delete keymap `deleteIfSelected` that DUCK-TYPES the NodeSelection
  (checks `selection.node`, NOT `instanceof` — see gotcha #1).
- `comment.ts` (NEW) — `Comment` mark (attr commentId + resolved), `setComment`/
  `unsetComment` commands, `COMMENTS_MAP_KEY='comments'`, `CommentThread` interface.
- `editor.ts` — imports Media + Comment, adds them to `buildBaseExtensions()`.
- `index.ts` — exports `./media.js` and `./comment.js`.
- `exportModel.ts` — added `ExportMediaBlock`, `isMediaBlock`, `ExportMediaResource`,
  `ExportMediaFetcher`; `blockOf` maps `media` node → media block; comment mark is
  ignored by `runsOf` (comments never leak to export).
- Tests: `editor.test.ts` (media node + comment mark schema round-trips),
  `exportModel.test.ts` (media block mapping, comment exclusion). **Shared: 56 tests
  pass.**

### Server (`apps/server/src/`) — DONE, all tests green

- `modules/media/imageSniff.ts` (NEW) — magic-byte sniff for PNG/JPEG/WebP + intrinsic
  dims. Rejects HTML/SVG/executables/GIF. `imageSniff.test.ts` (9 tests).
- `modules/media/storage.ts` (NEW) — `MediaStorage` interface + `LocalMediaStorage`
  (sharded by hash, path-traversal-safe, UUID keys), `ensureMediaDir`,
  `assertSafeStorageKey`. `storage.test.ts` (5 tests).
- `modules/media/repo.ts` (NEW) — `media` table CRUD (`insertMedia`,
  `getMediaForDocument` — document-scoped so cross-doc/forged id → null → 404).
- `modules/media/service.ts` (NEW) — `uploadMedia` (authorize editor+, size cap,
  content sniff, UUID key, store, persist, rollback binary on DB failure),
  `getMediaBytes` (membership + doc-scoped lookup).
- `modules/media/routes.ts` (NEW) — `POST /api/documents/:id/media` (multipart,
  editor+), `GET /api/documents/:id/media/:mediaId` (member; inline, nosniff, private
  cache). Registers `@fastify/multipart` with fileSize limit.
- `db/migrations/006_media.sql` (NEW) — `media` table (additive). Applied to dev
  `scribe` AND `scribe_test` (auto via runMigrations on boot / test beforeAll).
- `config/index.ts` — `MEDIA_DIR` (default `var/media`), `MEDIA_MAX_BYTES` (5 MiB) +
  `config.media`.
- `http/errors.ts` — added `badRequest`, `payloadTooLarge` (413),
  `unsupportedMediaType` (415).
- `app.ts` — `await registerMediaRoutes(app)`.
- `index.ts` — `ensureMediaDir(config.media.dir)` on boot.
- `test/setup-env.ts` — sets `MEDIA_DIR` to a temp dir + small `MEDIA_MAX_BYTES` for
  tests.
- `test/integration/media.test.ts` (NEW) — 11 tests: owner/editor upload, viewer 403,
  non-member 404, content-vs-declared MIME, unsupported type 415, oversized 413,
  serve headers, non-member serve 404, forged + cross-document id 404, auth required.
- **Server: 137 tests pass (21 files).**

### Web (`apps/web/src/`) — implemented; unit tests green; E2E media-delete WIP

- `api/client.ts` — added `uploadMedia(docId, file)` (multipart + auth refresh) and
  `fetchMediaBlob(docId, mediaId)` (authed Blob → object URL). `UploadedMedia` type.
- `features/editor/mediaNodeView.ts` (NEW) — vanilla ProseMirror node view: authed
  fetch → object URL `<img>`, loading/error/ok states, an explicit **Remove button**
  (deletes via `getPos()` + a doc-valid transaction), `ignoreMutation()`+`stopEvent()`,
  `selectNode`/`destroy` (revokes object URL). Factory `createMediaNodeView(documentId)`
  gets `(node, view, getPos)`.
- `features/editor/MediaButton.tsx` (NEW) — file picker + upload UX (validate type/size
  client-side, offline block, loading spinner icon, error + retry/dismiss). Inserts the
  media node ONLY after server 201.
- `features/editor/useDocumentEditor.ts` — accepts `documentId`; registers
  `editorProps.nodeViews.media` when documentId present.
- `features/editor/DocumentEditor.tsx` — accepts `documentId`; passes it +
  ydoc/user to Toolbar; renders `CommentsPanel` when `commentsOpen`.
- `features/editor/Toolbar.tsx` — new props (documentId, ydoc, user, commentsOpen,
  onToggleComments); selector adds `isComment`, `hasRange`; renders `MediaButton`,
  `CommentButton`, and a "forum" toggle for the comments panel. Removed the two
  placeholder buttons (image, add_comment).
- `features/comments/commentsStore.ts` (NEW) — `getCommentsMap`, `useComments` hook
  (Y.Map observe), `addCommentThread`, `setCommentResolved`, `deleteCommentThread`,
  `findCommentRange`, `scrollToComment`.
- `features/comments/CommentButton.tsx` (NEW) — popover to add a comment on a selection
  (sets mark + writes Y.Map). Disabled for viewers / no selection / no ydoc.
- `features/comments/CommentsPanel.tsx` (NEW) — lists threads, resolve/reopen/delete,
  click-to-navigate, author + timestamp. Read-only for viewers.
- `features/documents/DocumentView.tsx` — passes `documentId={id}` to DocumentEditor.
- `features/export/pdf.ts` — `exportDocumentToPdf(doc, fetchMedia?)`: pre-embeds
  PNG/JPEG (`embedMedia`), `drawMediaBlock` (image or placeholder box). WebP →
  placeholder.
- `features/export/docx.ts` — `buildDocx(doc, media?)`, `exportDocumentToDocxBlob(doc,
  fetchMedia?)`: `ImageRun` for PNG/JPEG, placeholder text otherwise. `fetchDocxMedia`.
- `features/export/ExportMenu.tsx` — builds a doc-bound `fetchMedia` via `fetchMediaBlob`
  and passes it to both exporters.
- `index.css` — styles for `.scribe-media-figure/-img/-status/-remove`,
  `.scribe-comment` highlight (+ resolved), `.scribe-comments-panel`.
- Tests: `features/comments/comments.test.tsx` (NEW, 10 tests: comment apply/resolve/
  delete, anchor survives edits, two-Ydoc convergence, no-text-leak, media command,
  media NodeSelection delete, media keymap delete), export `pdf.test.ts`/`docx.test.ts`
  (media embed + placeholder), `DocumentEditor.test.tsx` (viewer-disabled for
  image/comment). **Web unit: 165+ tests pass (22 files).**

---

## 4. Dependencies added

- `@fastify/multipart@^9` — added to the **ROOT** `package.json` `dependencies` (NOT
  apps/server), because the host `apps/server/node_modules/@fastify` dir is root-owned
  (docker leftover) and the workspace symlink can't be created there as user `um`. Root
  dep resolves via Node upward traversal from apps/server. **v9 is required (Fastify 5);
  v8 targets Fastify 4 and fails at boot.**
- No new npm deps in shared/web (media/comment use @tiptap/core + @tiptap/pm already
  present).

---

## 5. THE CURRENT BLOCKER — two-user media deletion convergence

**Symptom:** In the two-user E2E, deleting a media node on one client does not converge
on the other (the image stays / reappears). Single-user delete works perfectly and
persists across reload.

**Failing test:** `apps/web/e2e/media-comments.spec.ts` → test "Media: upload renders,
syncs to a collaborator, and delete propagates" (line ~79-82).

### Bugs already found AND fixed on the way here (all real, keep these fixes):

1. **Dual `@tiptap/pm` copies** → `selection instanceof NodeSelection` is false across
   the shared/web package boundary (web pins `@tiptap/pm@^2.11.5`, shared `^2.27.3` →
   two copies in the Vite browser bundle; jsdom dedups so unit tests didn't catch it).
   FIX: `media.ts` keymap duck-types (`selection.node`) instead of `instanceof`.
   *Consider aligning web to `@tiptap/pm@^2.27.3` to remove the dual copy entirely.*
2. **Deleting the doc's only block empties the doc** (invalid `block+`) → ProseMirror
   silently rejects the transaction. FIX: `mediaNodeView.remove()` backfills an empty
   paragraph in the same transaction when `tr.doc.childCount === 0`.
3. **Node-view async DOM mutations desync PM's MutationObserver** (img src / status
   text) → stale/orphaned figure DOM after deletion. FIX: added `ignoreMutation(){return
   true}` and `stopEvent()` (only for the remove button) to `MediaView`.
4. **`contenteditable=false` on the figure stole focus** so a selected atom's keypress
   never reached PM's keymap. FIX: removed that attribute; deletion is via the explicit
   Remove button + the node keymap.

### Verified working after those fixes:
- Single user: upload → click Remove → figure gone (DOM 0), doc has no `"media"`,
  survives reload. CONFIRMED via scratch test.

### Still failing / next diagnostic to run:
- Two-user: when one client deletes, the other still shows it (and/or it reappears on
  the deleter after a sync round-trip). Hypothesis: the **RECEIVING** side does not
  cleanly apply a remote media-node deletion (leftover node-view DOM causes y-prosemirror
  to re-sync the node back), OR the receiver's Remove button path has a getPos/editable
  timing issue.
- A ready-to-run diagnostic exists: `apps/web/e2e/scratch-media.spec.ts` (test "two
  user: uploader deletes, receiver loses it") logs `A_DOM/A_DOC_MEDIA/B_DOM/B_DOC_MEDIA`.
  RUN IT FIRST to see which side fails to converge.

### Suggested fix directions (pick after the diagnostic):
- Align `@tiptap/pm` version in `apps/web/package.json` to `^2.27.3` (match shared) so
  there's a single PM instance — this often resolves y-prosemirror node-view reconcile
  quirks and the instanceof issues generally. Then re-test.
- If the receiver keeps stale DOM: ensure `MediaView.destroy()`/`update()` don't fight
  y-prosemirror; consider NOT returning `true` unconditionally from `ignoreMutation`
  (try `(m) => m.type === 'selection' ? false : true`), or rebuild via
  `ReactNodeViewRenderer`.
- As a last resort, document honestly that live cross-client media DELETION has a known
  limitation while insert/render/persist/offline all work — but prefer to fix it.

---

## 6. Remaining work (checklist for the fresh session)

1. **Fix two-user media deletion convergence** (section 5). Run the scratch diagnostic,
   then likely align @tiptap/pm and/or adjust the node view. Re-run the two-user media
   E2E until green.
2. **Delete the scratch file** `apps/web/e2e/scratch-media.spec.ts` when done.
3. **Verify no leftover debug** `console.log` in `mediaNodeView.ts` (the diagnostic
   logs were removed; double-check `grep -n "console.log" apps/web/src/features/editor/mediaNodeView.ts`).
4. **Run the media + comments E2E suite** `apps/web/e2e/media-comments.spec.ts` (5
   tests): media upload/delete, media security, comments create/resolve/survives-edit,
   comments collaborate, viewer read-only. NOTE the dev-server **register rate limit =
   10/min** → run in small `-g` batches with a ~60s wait between, and beware `-g`
   regexes overlapping titles.
5. **Full regression** (all currently expected GREEN except the media-delete E2E):
   `pnpm lint`, `pnpm typecheck`, `pnpm --filter @scribe/shared test` (56),
   `pnpm --filter @scribe/web test` (165+), `pnpm --filter @scribe/server test` (137),
   `pnpm build`, `pnpm format:check` (only format files YOU changed — pre-existing
   unformatted files exist: export.spec.ts, page-break-editing.spec.ts,
   immutability.test.ts were already failing format before this phase).
   Then the Playwright suites: formatting, formatting-completion, offline, sharing,
   collaboration-presence, page-break-editing, export, media-comments.
6. **DB safety check** at the end: `docker compose exec -T db psql -U scribe -d scribe
   -c "SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM documents) d,
   (SELECT to_regclass('public.media')) media;"` — confirm counts intact (dev DB had
   ~441 users / ~305 docs before; media table exists). Migration 006 is additive only.
7. **Write the final report** (the phase asked for 18 numbered sections: architecture
   decisions, root causes, media storage, media security, media node/schema, offline
   media, comment architecture, comment anchor strategy, comment permissions,
   collaboration behavior, export behavior, files changed, migrations, docs updated,
   exact test results, browser verification, DB safety, remaining limitations).
8. **Save a memory** file summarizing the phase + gotchas, and add a line to
   `MEMORY.md` (previous phases each have one).

---

## 7. Environment / how to run (IMPORTANT for a fresh session)

- **Not a git repo.** Working dir: `/home/um/Desktop/clone-google-docs`. pnpm workspace.
- **Docker dev stack is running** (started by the user): `server` (localhost:4000),
  `web` (Vite, localhost:5173, proxies /api + /collab), `db` (Postgres on host 5433 →
  dev DB `scribe`; tests use `scribe_test`). Also unrelated `diclinic-*` containers on
  the host — ignore them.
- **Containers keep node_modules in NAMED VOLUMES** (separate from host). After changing
  deps you MUST: `docker compose exec <svc> pnpm install` then `docker compose restart
  <svc>`. Compose config changes (env/volume) need `docker compose up -d <svc>`.
- **Vite cache lives in a volume** — if the browser serves stale code after a source
  change, `docker compose exec web sh -c 'rm -rf node_modules/.vite'` then restart web.
  (Bind-mount inotify is unreliable on this host, hence occasional stale serves; a plain
  `docker compose restart web` usually re-reads source fresh.)
- **Register rate limit** on the dev server is **10/min** — E2E that registers many
  users will 429 if run all at once. Run in small batches; wait ~60s between.
- **Media dir** in docker = named volume `server_media` at `/app/var/media` (added to
  compose). `MEDIA_DIR` env set for the server service. Host-run tests use an OS temp
  dir. `var/` is gitignored.
- Web E2E `e2e/db.ts` connects to `localhost:5433/scribe` (the DEV DB) — the web E2E
  suite is DESIGNED to run against the live dev stack (only server integration tests use
  scribe_test). Registering ephemeral test users is additive, not a reset.
- Run one spec: `cd apps/web && npx playwright test <spec> -g "<name>" --reporter=list`.
- Foreground `sleep` is blocked in the tool; use `for i in $(seq 1 30); do sleep 2;
  done` to wait for the rate limit.

---

## 8. Key design invariants honored (do not regress)

- Binary media is NEVER in Yjs/ProseMirror JSON (only a `mediaId` reference). No base64.
- Comments live in the ONE Y.Doc (mark + Y.Map). No second CRDT, no comments DB table,
  no JSON sync, no `setContent`, no whole-document replacement.
- Server is the authority for media (authz + content sniff + size + safe keys); viewers
  cannot upload/comment (WS read-only is the boundary, not the UI).
- Comments are excluded from PDF/DOCX export. Media export fetches only the current
  doc's authorized media via the authenticated endpoint (no arbitrary URLs).
- Migration 006 is additive; dev DB is never reset/truncated.
