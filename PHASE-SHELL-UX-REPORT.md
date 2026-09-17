# Phase Report — Shell UX (profile, dark mode, light export, creation name)

Status: **COMPLETE.** Four product-level UX issues fixed with the smallest
architecture-consistent changes; verified in real Chromium.

## 1. Persistent personal profile button

The profile control already lived in the persistent `Header` (rendered by `AppShell`,
which wraps the `d/:id` document route too), and `PresenceStack` already excludes the
current user. The gap was purely arrangement/clarity. Change: in `app/Header.tsx` the
current user's profile is now the **rightmost** element, separated from collaborators/
document actions by a divider, with `aria-label="Your account — <name>"`, `role="menu"`/
`menuitem`, and `data-testid="profile-button"`. Other collaborators remain in
`PresenceStack`; the two are never merged. Present for owner/editor/viewer, in the list
and inside any document.

## 2. Complete dark mode

The theme system (semantic CSS-variable tokens swapped by `:root[data-theme]`) was sound;
two surfaces opted out. Fixes in `index.css` only (no second theme system):
- `.surface-frost` (the floating editor toolbar) gets a dark variant so it is an elevated
  dark surface instead of a white bar.
- `.scribe-page-sheet` previously **forced** light document tokens in every theme. It now
  has a dark-mode override giving the A4 page its OWN intentional dark token scope
  (`--color-sheet: 27 34 48` — a page lifted above the slate-900 workspace, readable light
  ink, lifted indigo for links/markers/quote rule, dark code chip/borders). Because the
  prose reads these tokens, every document element (headings, text, links, code,
  blockquote, task lists, media controls, comments, page-break UI) themes together.
- `.scribe-sheet` gets a hairline border in dark mode (the soft shadow is invisible there)
  so the page edge stays legible; and the text-selection wash is strengthened for dark.
Everything else (header, sidebar, dialogs, comments panel, popovers, inputs, document
list) already used tokens and now themes automatically. A4 geometry/margins/pagination are
untouched.

## 3. Export is always light

The PDF/DOCX exporters were already theme-independent **by construction**: they render from
the export model (`editor.getJSON()`) using explicit light document colors and never read
the DOM, `getComputedStyle`, `data-theme`, or `matchMedia` (verified by grep). No change to
the export engine. Added proof: a unit test (`export/pdf.test.ts`) rendering the same doc
under `data-theme=light` vs `dark` and asserting identical output, and an E2E exporting PDF
+ DOCX from a dark UI and asserting a real `%PDF-` / `PK` (ZIP) file.

## 4. Document creation with an editable name

The create API already accepted an optional `title` (`documentTitleSchema` = trim, 1–200,
Unicode-safe) defaulting server-side to "Untitled document" — a single source of truth. No
schema/API change needed. `NewDocumentDialog` now has a **Name** input defaulting to
"Untitled document", auto-focused and pre-selected on open (type to replace, no manual
select-all). The creation request carries the title; a blank/whitespace/unchanged-default
name is sent as `undefined` so the server applies its default (and templates keep their own
title). Enter creates once (busy guard), Escape cancels, click-outside closes. The chosen
title flows to the header title, browser tab title, and the document list — the existing
in-header title editing is preserved.

## Files changed

`apps/web/src/app/Header.tsx` (profile reorder/labelling), `apps/web/src/index.css`
(dark-mode toolbar + document surface + sheet border + selection),
`apps/web/src/features/documents/NewDocumentDialog.tsx` (name input + title in create),
`apps/web/src/features/export/pdf.test.ts` (theme-independence test). New:
`apps/web/e2e/ux-shell.spec.ts`. No server, schema, Yjs, media, or comment changes.

## Tests run

- Unit/component: web **168** pass (incl. new theme-independence test + existing Header
  dropdown tests). `typecheck`, `lint`, `build`, `prettier --check` (changed files): green.
- E2E (real Chromium), NEW `ux-shell.spec.ts` — **7/7**: profile visible for owner /
  editor / viewer; current user separate from the collaborator stack; dark mode themes
  header + toolbar + document page + ink (and reverts to white on light); export-from-dark
  yields real light PDF + DOCX; creation dialog defaults to "Untitled document", replaces
  naturally, custom title flows to header/browser-title/list, Enter creates once, whitespace
  falls back, Unicode preserved, Escape cancels.
- E2E regression (header-adjacent): `collaboration-presence.spec.ts` 4/4,
  `sharing.spec.ts` 2/2 green.

## Database safety

No reset/truncate. `users=654, documents=434, media` table present — additive growth from
ephemeral E2E users only.

## Notes / limitations

- Dark-mode document surface is a new visual; A4 geometry, margins, pagination, and page
  breaks are unchanged. Export ignores it entirely.
- Theme is a per-browser preference (`localStorage`), never document content.
