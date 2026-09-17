# Phase — Tab-Backspace · Live-permission integrity · ProDocs rebrand

Three independent objectives. All complete and proven in real Chromium.

## 1. Tab indentation — Backspace outdent

**Change:** `packages/shared/src/indent.ts`

- Added a `Backspace` keyboard shortcut to the shared `Indent` extension: when the
  caret is a collapsed selection at the **very start** (`parentOffset === 0`) of a
  paragraph/heading that carries `indent > 0` and is **not inside a list**, it
  `outdent()`s one level and consumes the key. Every other case returns `false`, so
  ProseMirror's default Backspace (char delete, block join, input-rule undo, …) runs
  unchanged.
- Raised the extension `priority` to `1000` so the handler is offered **before**
  StarterKit's default `joinBackward` (otherwise Backspace at a block start would join
  with the previous block before the indent could be peeled). Tab/Shift-Tab still
  defer to lists, so list sink/lift is untouched.

Indent remains a real document attribute (Yjs-synced, persists, exports, undo/redo via
the collaborative history) — nothing here is CSS-only.

**Tests:** `apps/web/e2e/tab-indent.spec.ts` (7 tests, all pass) — Tab/Shift-Tab,
per-press Backspace outdent (2→1→0), text preserved, mid-text delete unaffected,
indent-0 join is normal, list Tab preserved, viewer Tab inert, undo/redo, two-user
replication.

## 2. Live permission revocation / re-grant — no stale-state resurrection

**Root cause:** Yjs is additive — local updates never disappear via sync, they union.
A client that acquired local CRDT edits it was not authorized to make (a keystroke that
slipped through during a live editor→viewer transition, persisted to y-indexeddb) kept
them in its local Y.Doc/IndexedDB. On re-grant to editor the writable socket pushed
those still-pending updates to the server → they **resurrected** for everyone. A reload
as viewer re-loaded them from IndexedDB.

**Fix (client only; architecture-consistent — no LWW, no setContent, no whole-doc
replacement, Yjs stays source of truth, server stays authoritative):**

- `packages/shared/src/collab.ts`: shared `PERMISSION_CHANGED_CLOSE_CODE` (4210); server
  `controller.ts` now references it (single source of truth). The server already
  force-drops a member's socket with this code on any role change/removal.
- `apps/web/src/features/collaboration/useCollaboration.ts`:
  - On a `4210` socket close (the authoritative "your permission changed" signal), the
    hook **tears the session down and rebuilds it against a fresh Y.Doc after purging
    this document's local IndexedDB store**, so the rebuilt session can only contain the
    authoritative state it resyncs from the server. Scoped to the one document by store
    name — other documents' offline data is never touched.
  - It **also purges on any load that initializes as a VIEWER** (a viewer can never have
    legitimate local-only edits), closing the IndexedDB reload/reconnect path. Editors
    keep full offline durability (they never purge on ordinary mount/reconnect).
  - IndexedDB delete is awaited before recreating persistence (no in-flight-handle race).
- `apps/web/src/features/documents/DocumentView.tsx`: passes the authoritative role into
  `useCollaboration` and gates collab init on metadata being loaded, so an editor is
  never briefly treated as a viewer and wrongly purged.

The editor is recreated on the fresh Y.Doc (`useDocumentEditor` keyed on `ydoc`), so the
unauthorized ProseMirror state is discarded, not merged.

**Trade-off (documented):** a viewer's offline read cache is not reused (it re-fetches
from the server). Acceptable, scoped cost of the security invariant.

**Tests:** `apps/web/e2e/permission-revocation.spec.ts` (2 tests, real two-context) —
live editor→viewer→editor with an injected unauthorized edit that never reaches the
owner and never resurrects after re-grant; new legit edit after re-grant replicates;
reload leaves only authoritative content; demote→reload keeps viewer read-only with no
ghost. **Verified the tests fail without the fix** (temporarily neutralized both purge
paths → both tests red; restored → green).

Dev-only test probe hooks added to `collabDiagnostics.ts` (`injectLocalEdit`,
`caretToBlockStart`) — guarded by `import.meta.env.DEV`, never in production, not product
code paths. (Native Home/ArrowLeft don't reliably move a ProseMirror caret in headless
Chromium after a Playwright page query, hence the deterministic caret hook.)

Existing server live-permission integration tests (`test/integration/permissions.test.ts`)
still pass — the server-side read-only enforcement was already correct; this phase fixed
the **client** stale-state retention.

## 3. Rebrand Scribe → ProDocs (user-facing only)

Changed user-facing surfaces to **ProDocs**: app tab title (`AppShell.tsx` `APP_TITLE`),
header wordmark (`Header.tsx`), auth screen wordmark + copy (`AuthPage.tsx`), settings copy
(`SettingsPage.tsx`), exported-file metadata (`export/pdf.ts`, `export/docx.ts`), and the
system-templates seed name (`templates.ts`, not user-visible; no migration). `index.html`
`<title>` was already ProDocs. Updated title assertions in `AppShell.test.tsx`,
`navigation.spec.ts`, `ux-shell.spec.ts`.

**Intentionally preserved internal identifiers** (not user-facing): `@scribe/*` packages,
`__scribeConvergence`/`ScribeConvergenceProbe`, `scribe-theme` localStorage key,
`scribe-doc-*` IndexedDB names, `scribe-prose`/`scribe-page-*` CSS classes, the `scribe`
Postgres DB, Docker service names, and code comments referencing the "Scribe" design docs.
No user-facing `Scribe` string remains (verified by grep + a Chromium branding test).

**Tests:** `apps/web/e2e/branding.spec.ts` (2 tests) — login wordmark, no visible Scribe,
shell wordmark, browser titles.

## Verification run

- `pnpm -r typecheck` ✓ · `pnpm -r lint` ✓ · shared/web/server `build` ✓
- web unit: 168 pass · server: 137 pass (incl. live-permission WS integration)
- e2e (real Chromium, running docker stack, dev DB 5433): tab-indent 7 ✓,
  permission-revocation 2 ✓, branding 2 ✓, sharing 2 ✓, navigation ✓, ux-shell title ✓
- Note: dev-mode server rate-limits heavy multi-user E2E runs (429 on register); run the
  full suite with `NODE_ENV=test` server per the running-tests memory. Focused specs pass.

No DB reset/migration. No unrelated refactors.
