# ADR 0011 — Hyperlink safety policy & formatting schema additions

**Status:** Accepted

## Context

The editor-formatting completion phase makes five previously-inert toolbar controls
real: **strikethrough**, **inline code**, **task checklist**, **blockquote**, and
**links**. Four of these are ordinary formatting with no security surface, but a
**link `href` is user-controlled data that is rendered as a live DOM attribute** — the
classic vector for `javascript:`/`data:` URL XSS and for tab-nabbing via
`target="_blank"`.

Two decisions needed recording: (1) how link URLs are constrained, and (2) how the new
nodes/marks enter the **shared** ProseMirror/Yjs schema without breaking existing
documents or the client⇄server schema agreement.

## Decision

### 1. Link URL allow-list (fail-closed)

A single shared module — `packages/shared/src/linkPolicy.ts` — owns the policy so the
editor extension, the toolbar popover, and the exporters all agree:

- **Allowed schemes:** `http`, `https`, `mailto`, `tel`. Everything else is rejected.
- **Normalization:** a bare host typed without a scheme (`example.com`) is upgraded to
  `https://`. Arbitrary text (spaces, or no dot and no scheme) is **not** turned into a
  URL.
- **Fail-closed:** anything not confidently classified as safe is rejected. ASCII
  whitespace/control characters are stripped before classification, so a smuggled
  scheme (`java\tscript:…`) cannot slip through.
- **Enforced in depth:** the Tiptap `Link` extension is configured with
  `isAllowedUri: isSafeLinkUrl`, so the allow-list is applied to **both** programmatic
  `setLink` (toolbar) **and** URLs parsed from pasted HTML. The popover additionally
  validates input up front and shows an inline error rather than a browser dialog.
- **Rendering hardening:** links render with `rel="noopener noreferrer nofollow"` and do
  not auto-open on click inside the editor (`openOnClick: false`).

Editor content is never injected as raw HTML (`getJSON()` structured content only; no
`dangerouslySetInnerHTML`), so the schema allow-list plus this URL allow-list are the
complete link attack surface.

### 2. Schema additions live in the shared base

The five features join the schema in `packages/shared/src/editor.ts`
(`buildBaseExtensions`), which is the single source both the client editor and the
server seeding/template path (`getSchema(buildBaseExtensions())`) derive from:

- **Strike, Code, Blockquote** already ship inside `@tiptap/starter-kit`, so they have
  **always** been in the shared schema — this phase only wires the toolbar/exporters to
  them. No schema change, no document migration.
- **TaskList / TaskItem** (block nodes) and **Link** (inline mark) are new schema
  members added to the shared base. Because they are additive, documents created before
  this phase — which simply contain none of these nodes/marks — continue to load and
  map through Yjs unchanged.

The task-item **`checked` state is a ProseMirror node attribute**, hence document/CRDT
data — never React/Zustand/localStorage. It therefore syncs, persists, works offline,
and undoes through the existing Yjs pipeline like any other edit, and read-only viewers
cannot toggle it (the node view reverts the change when `!editor.isEditable`).

## Alternatives considered

- **Native `window.prompt` for links** — rejected: poor UX, no validation affordance,
  and it cannot detect/edit an existing link.
- **A full URL-parsing/validation framework** — rejected as over-engineering; a small
  scheme allow-list is sufficient and auditable.
- **Sanitizing links only at render time** — rejected: storing an unsafe href and
  hoping every render path sanitizes is fragile. We reject at the point of entry.
- **Client-only task-list/link extensions** — rejected: any schema divergence from the
  server's seeding schema would corrupt the Yjs ⇄ ProseMirror mapping.

## Trade-offs / Consequences

- `mailto:`/`tel:` are allowed for completeness; relative/anchor links are not (a
  cloud document editor has no meaningful relative target).
- Inline `code` uses Tiptap's default `excludes: '_'`, so it intentionally does **not**
  combine with other inline marks — applying code clears them. This is documented
  behavior, not a bug.
- PDF export renders links as blue underlined text (the pdf-lib text-drawing
  architecture does not emit clickable annotations); DOCX export produces **real**
  clickable `ExternalHyperlink`s. See `docs/architecture/editor-formatting.md`.
