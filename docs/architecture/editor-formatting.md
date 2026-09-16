# Editor formatting & schema

This document describes the editor's document schema and the semantics of each
formatting feature: how it is stored, how it collaborates, how it persists/works
offline, how it is gated by permissions, and how it is exported. It complements
[ADR 0001 (editor)](adr/0001-rich-text-editor.md) and
[ADR 0011 (link safety & schema additions)](adr/0011-link-safety-policy.md).

## The shared schema is the source of truth

The schema is defined **once** in `packages/shared/src/editor.ts`
(`buildBaseExtensions`) and consumed by:

- the **client** editor: `[...buildBaseExtensions(), Pagination, Collaboration, CollaborationCursor]`;
- the **server** seeding/template path: `getSchema(buildBaseExtensions())` →
  `prosemirrorJSONToYDoc(schema, json, COLLAB_FIELD)`.

Defining it once guarantees the client and server never drift, which is required
because a node/mark/attribute mismatch would corrupt the Yjs ⇄ ProseMirror mapping.
The **Yjs document remains the single source of truth**: every formatting operation is
an ordinary ProseMirror transaction applied to the collaborative document — there is no
`setContent`, no JSON syncing, no manual DOM state, and no React state for document
formatting.

## Supported nodes & marks

| Feature              | Kind         | Provided by                                  | Notes                       |
| -------------------- | ------------ | -------------------------------------------- | --------------------------- |
| Paragraph, H1–H3     | block nodes  | StarterKit                                   | `textAlign` attr            |
| Bold, Italic         | inline marks | StarterKit                                   |                             |
| Underline            | inline mark  | `@tiptap/extension-underline`                | renders `<u>`               |
| **Strikethrough**    | inline mark  | StarterKit (`strike`)                        | renders `<s>`               |
| **Inline code**      | inline mark  | StarterKit (`code`)                          | `excludes: '_'` (exclusive) |
| Bullet/Numbered list | block nodes  | StarterKit                                   |                             |
| **Task checklist**   | block nodes  | `@tiptap/extension-task-list` + `-task-item` | item `checked` attr         |
| **Blockquote**       | block node   | StarterKit (`blockquote`)                    | contains paragraphs         |
| **Link**             | inline mark  | `@tiptap/extension-link`                     | safe-URL allow-list         |
| Page break           | block atom   | Scribe `PageBreak` (shared)                  | non-selectable, structural  |

**Strike, inline code, and blockquote already shipped inside StarterKit**, so they have
always been part of the shared schema; this phase only wired the toolbar and exporters
to them (no schema change, no migration). **TaskList/TaskItem and Link are additive
schema members** — documents created before they existed contain none of them and load
unchanged.

## Feature semantics

### Strikethrough / Inline code

Ordinary inline marks. Toggled from the toolbar (`toggleStrike` / `toggleCode`), they
reflect active state, apply to a selection or to text typed after toggling, sync through
Yjs, work offline, persist across reload, and participate in Yjs-aware undo/redo. Inline
code uses Tiptap's default `excludes: '_'`, so it is **exclusive** — applying it clears
other inline marks on the run. This is intentional (a code span is monospaced literal
text), not a bug.

### Task checklist — checked state is document data

`TaskList`/`TaskItem` render a real checklist. **The `checked` value is a ProseMirror
node attribute**, so it is document/CRDT state:

- Toggling a checkbox dispatches a normal transaction that sets the `checked`
  attribute; the change flows Tiptap → Yjs → provider → server exactly like any edit.
- It therefore **converges** across collaborators (A checking task 1 and B editing task
  2 both survive and merge), **persists** across reload, **works offline** (stored in
  `y-indexeddb`, merged on reconnect), and **undoes/redoes** via the Yjs UndoManager.
- It is **never** stored in React/Zustand/localStorage.
- **Read-only viewers cannot modify it:** the task-item node view reverts a checkbox
  change when `!editor.isEditable`, and the server authorization remains the real
  boundary.

`Enter` inside a task item creates the next item; `Backspace`/`Tab`/`Shift-Tab` behave
like a normal nestable list.

### Blockquote

A real ProseMirror block node (never a CSS wrapper around a paragraph). Toggled with
`toggleBlockquote`; it contains normal paragraph content, is styled with a left rule,
and collaborates/persists/undoes like any block. It composes with the page-break /
pagination layer (a blockquote is just another top-level block that the paginator
measures).

### Links

Inline `link` mark managed by a small **popover** (not a native `window.prompt`):

- Opens from the toolbar; pre-fills the current link's URL when the caret is inside one;
  supports **Apply / Cancel / Remove**; closes on **Escape**; does not disturb the
  editor selection (it uses `extendMarkRange('link')`).
- URLs pass the shared allow-list (`packages/shared/src/linkPolicy.ts`):
  **http/https/mailto/tel only**; a bare host is upgraded to `https://`; dangerous
  schemes (`javascript:`, `data:`, …) are rejected with an inline error. The allow-list
  is also enforced by the extension's `isAllowedUri`, covering pasted HTML.
- Links render with `rel="noopener noreferrer nofollow"` and do not auto-open on click
  in the editor.

See [ADR 0011](adr/0011-link-safety-policy.md) for the full policy and rationale.

## Export support

The pure shared transform `toExportDocument` (`packages/shared/src/exportModel.ts`)
normalizes the ProseMirror JSON; the PDF (`pdf-lib`) and DOCX (`docx`) renderers are
thin adapters over it. Export never mutates the Yjs doc.

| Feature        | PDF (`pdf-lib`)                               | DOCX (`docx`)                          |
| -------------- | --------------------------------------------- | -------------------------------------- |
| Strikethrough  | line through the run                          | real `strike` run formatting           |
| Inline code    | Courier (monospace) run                       | `Courier New` run                      |
| Task checklist | drawn checkbox square (✓ when checked) + text | `☐`/`☑` glyph prefix + text (indented) |
| Blockquote     | indented text with a left rule (italic)       | indented paragraph with a left border  |
| Link           | blue underlined text (visible text preserved) | **real clickable `ExternalHyperlink`** |

**PDF link limitation:** the PDF path draws text tokens and does not emit clickable
link annotations, so a link's visible text and target-as-text are preserved but the PDF
link is not clickable. DOCX links are fully clickable. Unsafe hrefs are dropped from
export (fail-closed), consistent with the editor policy.

## Testing

- **Unit (shared):** schema membership + round-trips (`editor.test.ts`), URL policy
  (`linkPolicy.test.ts`), export mapping incl. checked state and dropped unsafe hrefs
  (`exportModel.test.ts`).
- **Component (web, jsdom + Yjs):** toolbar toggles, popover apply/edit/remove/reject,
  checked-attribute persistence, read-only disabling (`DocumentEditor.test.tsx`); export
  renderers (`pdf.test.ts`, `docx.test.ts`).
- **E2E (real Chromium):** `formatting-completion.spec.ts` — each feature applies,
  persists across reload, collaborates, survives offline/reconnect, is read-only for
  viewers, and stays page-break compatible.

## Tab / Shift-Tab & indentation

Tab inside the editor is an EDITOR command, not a browser focus move — but only while
editing, so application keyboard navigation is never globally trapped.

- **Paragraph / heading text:** Tab increases and Shift-Tab decreases an `indent` LEVEL
  (0..10) — a real node attribute in the SHARED schema (like `textAlign`), rendered as a
  left margin. It persists in Yjs, collaborates deterministically, survives reload, and
  exports as a left indent (PDF: column offset; DOCX: paragraph `indent`). This is NOT a
  literal tab character. Tab is consumed inside a text block (even at max indent) so the
  caret never escapes the editor mid-edit.
- **Lists:** the handlers DEFER inside a `listItem`/`taskItem`, so Tab = sink (nest) and
  Shift-Tab = lift (outdent) via the list extensions are preserved and list structure —
  including task-checked state — is never destroyed.
- **Viewers / read-only:** the handlers return `false` when the editor is not editable, so
  Tab stays a normal navigation key and a viewer gains no editing behavior.
- **Not focused:** the handling is a ProseMirror keymap, which only runs when the editor is
  focused — Tab through the toolbar, menus, buttons, and the comments panel is unchanged.
- **Shared extension:** `Indent` (`packages/shared/src/indent.ts`), added to
  `buildBaseExtensions()` so the server's seeding schema agrees. Existing documents get the
  default `indent: 0` (no migration).
