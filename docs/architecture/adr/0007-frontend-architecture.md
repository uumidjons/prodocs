# ADR-0007 — Frontend: React + TypeScript + Vite, Zustand for local state

**Status:** Accepted

## Context

The frontend must host the Tiptap editor, wire up the Yjs providers, render presence and
remote cursors, reproduce the "Editorial Precision" design system faithfully, and manage a
small amount of _non-document_ UI state (sync status, current doc, auth, panel toggles).
Crucially, **the document itself is not React state — it lives in the `Y.Doc`.** We must
not accidentally rebuild a global store that duplicates the CRDT.

## Decision

**React + TypeScript** built with **Vite**, styling via **Tailwind** configured from the
`UI/DESIGN.md` tokens, and **Zustand** for the little bit of local UI/sync state. **No
Redux/MobX.**

## Alternatives considered

- **Vue / Svelte** — capable, but React has the deepest Tiptap + Yjs ecosystem and examples;
  fewer unknowns on the hardest integrations.
- **Redux (Toolkit)** — rejected: the primary "state" (document content, presence) already
  lives in Yjs and Awareness with their own subscription model. Putting a global reducer
  store on top would duplicate the source of truth and invite drift. Redux's ceremony buys
  nothing here.
- **MobX / Jotai / Recoil** — unnecessary; the residual UI state is tiny.
- **Next.js** — SSR/routing framework we don't need for an authenticated SPA editor; Vite
  is lighter and faster for this.

## Why React + Vite + Zustand

- **React + Tiptap + `y-prosemirror`** is the best-trodden path for collaborative editors.
- **Vite** — fast dev/HMR, simple build to static assets served by the proxy.
- **Zustand** — minimal, hook-based store for exactly the non-CRDT state (sync state
  machine, active document id, auth user, panel open/closed). It stays _out_ of the
  document data path.
- **State ownership is explicit:** content → `Y.Doc`; presence → Awareness; everything else
  small → Zustand; server truth → REST via a typed client. Four clear owners, no overlap.

## Trade-offs

- React re-render discipline needed around the editor; handled by keeping the editor
  uncontrolled (ProseMirror owns its DOM) and subscribing narrowly to Yjs/awareness.
- Tailwind utility classes need discipline to stay systematic — mitigated by encoding the
  design tokens (colors, type scale, spacing, radii from `UI/DESIGN.md`) into the Tailwind
  config so components consume tokens, not ad-hoc values.

## Consequences

- Frontend is organized feature-first with an isolated `sync/` module
  (see [../project-structure.md](../project-structure.md)).
- The design system is implemented as a token-driven component layer in `apps/web/ui`.
- The sync **state machine** ([../connection-states.md](../connection-states.md)) lives in
  a Zustand store fed by provider events.
