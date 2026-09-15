# ADR-0001 — Rich-Text Editor: Tiptap / ProseMirror

**Status:** Accepted

## Context

We need a rich-text editor supporting bold, italic, headings, and bullet/numbered lists,
that (a) integrates cleanly with the chosen CRDT (Yjs, [ADR-0002](0002-crdt-technology.md))
including **remote cursors**, (b) has a **strict, structured document model** (not an HTML
string) so sync stays incremental and XSS surface stays small, and (c) is **headless**
enough to build the original "Editorial Precision" UI (`UI/DESIGN.md`) rather than ship a
vendor's default chrome.

## Decision

Use **Tiptap**, the headless wrapper over **ProseMirror**.

## Alternatives considered

- **Lexical (Meta)** — fast and modern, growing Yjs support, but the CRDT binding is less
  mature/proven than `y-prosemirror`, and the collaborative-cursor story is weaker today.
- **Slate** — very flexible React-native model, but the Yjs binding has historically been
  the least stable of the options for production collaboration; more foot-guns for merge.
- **Quill** — simple and popular, uses a Delta model; Yjs bindings exist but it is less
  flexible for a bespoke UI and strict schema, and cursor support is weaker.
- **Raw ProseMirror** — maximum control but much more boilerplate than Tiptap for the same
  result.

## Why Tiptap/ProseMirror

- **`y-prosemirror` is the reference Yjs editor binding** — bidirectional, lossless mapping
  between the ProseMirror doc and `Y.XmlFragment`, plus a maintained collaborative-cursor
  plugin. This is the single strongest reason: the hardest integration is already solved.
- **Strict schema** = documents are structured trees with an allow-list of nodes/marks, not
  arbitrary HTML. Enables incremental CRDT sync and shrinks XSS surface
  (see [../security.md](../security.md)).
- **Headless** — Tiptap ships behavior, not styling, so the floating toolbar, typography,
  and presence chrome are built to the design system exactly.
- Mature, TypeScript-first, large ecosystem for the MVP marks (bold/italic/heading/lists).

## Trade-offs

- ProseMirror has a learning curve (schema, plugins, transactions).
- Headless means we build the UI ourselves — intended, since the assignment demands an
  original design.

## Consequences

- The editor is Layer 1 in [../system-overview.md](../system-overview.md); it talks to Yjs
  only through `y-prosemirror` and knows nothing about transport.
- The schema is defined once and shared/consistent with any server-side rendering; unknown
  nodes/marks are stripped on paste.
