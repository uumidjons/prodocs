# Phase Report — Media as a Document Object + Tab/Indent

Status: **COMPLETE.** Media now behaves like a serious document-editor object (clipboard
paste, drag-drop, copy/paste within Scribe, layout modes, alignment, resize) and Tab/
Shift-Tab are intentional editor commands. Everything collaborates through Yjs, persists
across reload, and is honored by export — with binary media never entering the CRDT.
Verified in real Chromium.

---

## A. Media clipboard / paste / positioning / resize

### What was built

- **Paste image** (`mediaPaste.ts`, a ProseMirror plugin via `MediaPaste` extension wired
  in `extensions.ts` when a `documentId` is present). `handlePaste` takes allow-listed
  image `File`s from the ClipboardEvent `DataTransfer`, uploads through the EXISTING
  authenticated `uploadMedia`, then inserts the `media` node (mediaId reference only) at the
  caret after the server confirms. Works with the cursor inside a paragraph and preserves
  surrounding text.
- **Drag-drop image** (`handleDrop` in the same plugin) — same upload→insert path, inserted
  at the drop coordinates (`posAtCoords`).
- **Copy within Scribe** — the `media` node's attributes now round-trip through the clipboard
  HTML (`parseHTML`/`renderHTML` in `media.ts`). Copying a Scribe image and pasting it back
  reconstructs the SAME node (same `mediaId`/layout/size) with NO re-upload; only the
  reference travels, never the binary.
- **Layout & alignment** — new `media` node attributes `layout` (`block`|`wrap-left`|
  `wrap-right`) and `align` (`left`|`center`|`right`), driven from a control bar in the node
  view (shown only when the node is selected in an editable editor). Changes are ProseMirror
  attribute transactions → converge via Yjs → persist across reload.
- **Resize** — a corner handle (node view) drags a live DOM preview and COMMITS the final
  `width`/`height` as ONE attribute transaction on release (no per-move transactions → no
  collaboration noise). Width clamped to `[48px, page content width]` (so an image can never
  exceed the page boundary); aspect ratio preserved from the natural image dimensions.
- **Paste-error UX** — a small toast bus (`editorNotify.ts` + `EditorToasts.tsx`, mounted in
  `DocumentEditor`) surfaces upload/offline failures without inserting a broken node.

### Security (defensive, unchanged server authority)

- Only real image `File`s of the app's allow-list (PNG/JPEG/WebP) from the `DataTransfer`
  are accepted; the server's magic-byte sniff + size cap remain authoritative.
- The plugin NEVER reads `<img src="…">` from pasted HTML, and `media.parseHTML` only matches
  `img[data-media-id]` — so pasted web HTML can never create an externally loaded/unsafe
  remote media URL (no SSRF/XSS surface). Useful text of such a paste is kept by ProseMirror's
  normal handler (the foreign `<img>` is dropped).
- No Blob/base64/data-URL ever enters Yjs or ProseMirror JSON (asserted in E2E).
- Offline: paste/drop shows "offline" and inserts nothing. Failed upload → toast, no orphan.

### Positioning model (explicit, documented)

Supported, deterministic, collaborative modes: `block` (standalone, align left/center/right
— word-processor "break text") and `wrap-left`/`wrap-right` (float; following blocks wrap).
**True in-paragraph "inline" placement is intentionally NOT implemented** — a ProseMirror
node is block XOR inline, and inline media would fight the top-level A4 pagination; the wrap
modes cover the practical need. This boundary is documented in
`docs/architecture/media-and-comments.md`, not a half-built feature.

### Export

`exportModel.ts` now carries media `align` (wrap collapses to its float side) and text
`indent`. PDF (`pdf.ts`) sizes the image from the stored `width` (px→pt, clamped to the
content column) and places it by `align`; DOCX (`docx.ts`) uses `ALIGN[block.align]` and the
scaled width. Export uses the document's semantic state (never the DOM/viewport) and stays
light/theme-independent.

## B. Tab / Shift-Tab

- New shared `Indent` extension (`indent.ts`, in `buildBaseExtensions()`): paragraph/heading
  gain an `indent` LEVEL attribute (0..10), rendered as a left margin. Tab increases,
  Shift-Tab decreases — a real document attribute that persists in Yjs, collaborates, and
  exports (PDF column offset / DOCX paragraph indent). Not a literal tab character.
- Tab is consumed inside a text block (even at max indent) so the caret never escapes
  mid-edit; the handler DEFERS inside `listItem`/`taskItem`, so list Tab = sink / Shift-Tab =
  lift and task-checked state are preserved.
- Viewers/read-only: handlers return `false` → Tab stays normal navigation, no editing gained.
- Not focused: it's a ProseMirror keymap (only runs when the editor is focused), so Tab
  through toolbar/menus/buttons/comments panel is unchanged — no global trap.

## Files changed

Shared: `media.ts` (layout/align attrs + clipboard round-trip parse/render), `indent.ts`
(NEW), `editor.ts` (+Indent), `index.ts` (+indent export), `exportModel.ts` (text `indent`,
media `align`), `exportModel.test.ts` + `editor.test.ts` (expectations).
Web: `mediaNodeView.ts` (controls + resize + layout attrs), `mediaPaste.ts` (NEW),
`editorNotify.ts` (NEW), `EditorToasts.tsx` (NEW), `extensions.ts` (+MediaPaste, documentId),
`useDocumentEditor.ts` (pass documentId), `DocumentEditor.tsx` (mount toasts),
`pageGeometry.ts` (`PAGE_CONTENT_WIDTH`), `export/pdf.ts` + `export/docx.ts` (indent + media
align/width), `index.css` (layout/wrap/controls/resize/toast styles).
E2E: `media-editor.spec.ts` (NEW), `tab-indent.spec.ts` (NEW).
Docs: `media-and-comments.md`, `editor-formatting.md`.

## Exact test results

- Unit/integration: **shared 56**, **web 167**, **server 137** — all green. `typecheck`,
  `lint`, `build`, `prettier --check` (changed files) — green.
- Playwright (real Chromium), NEW:
  - `media-editor.spec.ts` — **6/6**: paste PNG (text preserved, no base64 in doc); drop
    image; paste JPEG + WebP; copy-a-Scribe-image reuses mediaId with NO re-upload; layout
    (wrap-left) + resize (width ≥ 48) persist across reload; two-user layout (wrap-right)
    converges.
  - `tab-indent.spec.ts` — **3/3**: paragraph Tab→indent 1/2, Shift-Tab→1, persists on
    reload; list Tab sinks/Shift-Tab lifts (structure intact); viewer Tab does not modify.
- Playwright REGRESSION (green): `media-comments.spec.ts` 5/5, `export.spec.ts` 5/5,
  `page-break-editing.spec.ts` 4/4, `formatting.spec.ts` 5/5.

## Browser verification (collaboration)

Two real Chromium contexts: A pastes an image → B receives it; A sets `wrap-right` → B sees
the same `data-layout`; A resizes → committed `width` lands in the doc and survives reload.
Delete convergence (prior phase) still green.

## Database safety

No reset/truncate. Final: `users=631, documents=419, media=media` (grew additively from
580/384 via ephemeral E2E users). Migration set unchanged (no new migration this phase; the
new schema attributes are ProseMirror node attributes with defaults — no DB change, no
document migration; old docs load with `indent:0`, `layout:'block'`, `align:'center'`).

## Known limitations (honest)

- **Inline (in-paragraph) media**: not supported by design (block schema + A4 pagination);
  wrap-left/right + block-align are the deterministic substitute.
- **Cross-document copy/paste**: pasting a copied image into a DIFFERENT document references a
  `mediaId` that document doesn't own → 404 placeholder (no cross-doc re-upload in this phase).
- **Wrap + pagination**: a floated image is deterministic document state, but the A4
  pagination measures top-level block heights; a very large wrapped image near a page boundary
  can produce imperfect page-fill (presentation only — never corrupts the document/CRDT).
- **Export of wrap layouts**: collapses to left/right alignment (the page-flow exporters don't
  reflow text around a float) — documented and deterministic.
- **Real headless clipboard**: OS-clipboard Ctrl+C/V is unreliable in headless Chromium, so
  the copy/paste E2E dispatches the exact clipboard HTML a Scribe copy produces (faithful to
  the `parseHTML`/`renderHTML` round-trip that powers the feature).
