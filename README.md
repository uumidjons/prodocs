# ProDocs

**ProDocs is a web-based collaborative document editor** — a place where several people
can open the same document and write in it together, in real time, from different browsers
or computers. It is inspired by the _idea_ of Google Docs (shared, live-editing documents)
but has its own visual identity ("Editorial Precision", see [`UI/DESIGN.md`](UI/DESIGN.md))
and its own architecture.

### What it does, in one sentence

You write in a rich-text document; anyone you share it with sees your changes appear almost
instantly; and if your internet drops, you can keep writing — your work is saved locally and
merges back in cleanly when you reconnect, **without overwriting anyone else's edits**.

![ProDocs editor: an A4 document with headings, a bullet list, and a task checklist, above the formatting toolbar, with a "Synced to cloud" status and Share/Export controls](docs/screenshots/editor.jpg)

This project was built to satisfy a specific technical assignment (a "Google Docs–style"
full-stack editor). The three things the assignment cares about most are **real-time
collaboration**, **offline editing with correct merging**, and an **original, coherent
design** — so those are the three things this README explains most carefully.

---

## Table of contents

- [Assignment requirements at a glance](#assignment-requirements-at-a-glance)
- [Features: core vs. additional](#features-core-vs-additional)
- [How real-time collaboration works](#how-real-time-collaboration-works)
- [How offline editing works](#how-offline-editing-works-the-important-part)
- [Architecture](#architecture)
- [Technology choices (and why)](#technology-choices-and-why)
- [Data & collaboration model](#data--collaboration-model)
- [Permissions & security](#permissions--security)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Submission demo script (for the video)](#submission-demo-script-for-the-video)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)



---



## Assignment requirements at a glance

Every claim below is backed by code and tests in this repository (see the linked files and the
[Testing](#testing) section).

| Requirement (from the assignment)                       | How ProDocs implements it                                                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic rich-text editor** (bold, italic, headings, lists) | Tiptap/ProseMirror editor with bold, italic, H1–H3, and bullet/numbered lists — plus more (see below).                                            |
| **Real-time collaboration** (2+ users, live, no reload) | Yjs + Hocuspocus over a WebSocket. Multiple users on the same document see each other's edits appear live, with no page reload.                       |
| **Offline editing** (edit offline, sync & merge later)  | Each browser keeps a local copy of the document in IndexedDB. You keep editing while offline; on reconnect, Yjs merges local and remote edits.       |
| **No data loss / no overwriting others' edits**         | Merging uses CRDT semantics (explained below), never "whole-document replacement" or "last write wins." Verified by an explicit no-last-write-wins test. |
| **Participant list / cursors** (who's here, name/color) | Live presence stack in the header; each collaborator shows a colored remote cursor and text selection tagged with their name.                        |
| **Document persistence** (any database)                 | PostgreSQL stores the document's change history and periodic snapshots (as binary Yjs data — never HTML).                                            |
| **Original, coherent design**                           | A custom "Editorial Precision" design system: one palette, one icon style, deliberate spacing/typography, and an A4 document surface.                 |
| **README + startup + architecture + why-sync**          | This document, plus the architecture set in [`docs/architecture/`](docs/architecture/README.md).                                                     |
| **3–5 min demo video**                                  | To be recorded; script in [Submission demo script](#submission-demo-script-for-the-video).                                                           |

---

## Features: core vs. additional

The assignment values **design and architectural consistency over feature count**, so the
mandatory requirements come first. Everything under "Additional" is real and in the
repository, but it is _beyond_ the required MVP — included as product polish, not to inflate
the list.

![ProDocs workspace: a sidebar with Documents, Recent, Templates, Shared with me, and Trash, and a main area grouping documents into "Owned by me" and "Shared with me"](docs/screenshots/workspace.jpg)

### Core assignment features

- **Rich-text editing** — bold, italic, headings (H1–H3), bullet lists, and numbered lists.
- **Real-time multi-user editing** — live, no reload, across separate browsers/profiles.
- **Offline editing + conflict-free merge** — keep writing offline; reconnect merges cleanly.
- **Presence** — see who is in the document (name + color) and their live cursor/selection.
- **Persistence** — documents survive reloads and server restarts (PostgreSQL-backed).

### Additional features (beyond the MVP)

These exist in the codebase but are **not** required by the assignment:

- **More formatting** — underline, strikethrough, inline `code`, blockquote, task checklists
  (with checked state), text alignment, Tab/Shift-Tab indentation, and safe hyperlinks
  (dangerous URL schemes are rejected).
- **Document sharing & roles** — an owner can add registered users as **Editor** or
  **Viewer**, change roles, and remove members (viewers get a read-only editor).
- **A4 pagination & manual page breaks** — the document is laid out as A4 pages;
  Ctrl/Cmd+Enter inserts a real page break.
- **Templates** and **workspace navigation** — a template gallery, plus Recent, Shared-with-me,
  and Trash (soft-delete) views.
- **Export to PDF and Word (.docx)** — generated entirely in the browser from the current
  document, preserving formatting and page breaks; works offline.
- **Images** — upload, paste, or drag-drop images; resize and position them. The image
  _binary_ is stored server-side and referenced by id — it is never put inside the collaborative
  document data.
- **Inline comments** — anchored to the text, collaborative, and offline-capable.
- **Light/dark theme** and a persistent profile menu.
- **Security hardening** — refresh-token rotation with reuse detection, request/WebSocket size
  caps, and rate limiting.

---

## How real-time collaboration works

![Two people in the same ProDocs document: the header shows both participants' avatars, and a collaborator's live text selection is tagged with their name ("Maya Rivera") in their own color](docs/screenshots/collaboration.jpg)

### In plain language

Imagine two people typing in the same document at the same time. The naive approach — "save
the whole document, and whoever saved last wins" — would constantly erase people's work.
ProDocs never does that.

Instead, ProDocs uses **Yjs**, a collaboration library based on **CRDTs**
(Conflict-free Replicated Data Types). In simple terms: instead of sending the _whole
document_ back and forth, each editor sends tiny, self-describing _change operations_ ("insert
this character here", "make this word bold"). Yjs is designed so that these changes can be
applied in any order on any copy of the document and everyone still ends up with the **same
result** — and, crucially, two people's changes **combine** instead of one replacing the other.

Those change operations travel between users over a **WebSocket** (a always-open, two-way
connection between the browser and the server, unlike normal web requests that open, respond,
and close). The server piece that relays and stores them is **Hocuspocus**, a ready-made
collaboration server for Yjs.

So the flow for a single keystroke is:

```
You type
  → the Tiptap/ProseMirror editor in your browser
    → your local Yjs document records the change
      → sent over the WebSocket to the Hocuspocus server
        → relayed to every other collaborator's Yjs document
          → their editor re-renders with your change — no reload
```

The same thing happens in reverse for everyone else's edits, continuously, in both directions.

### For developers

- The editor is **Tiptap** (a wrapper over **ProseMirror**). The document schema
  (`packages/shared/src/editor.ts`, `buildBaseExtensions()`) is defined **once** in the shared
  package so the browser editor and the server use byte-identical node/mark definitions.
- `@tiptap/extension-collaboration` binds the editor to a `Y.Doc`
  (`apps/web/src/features/editor/extensions.ts`). Local edit history is delegated to Yjs's
  per-user `UndoManager` (StarterKit history is disabled) so undo/redo is collaboration-aware.
- Transport is `@hocuspocus/provider` on the client (`useCollaboration.ts`) talking to a
  Hocuspocus server that is **attached to the same Fastify process** as the HTTP API
  (`apps/server/src/collab/`). It is a **modular monolith**: one process, one port, HTTP and
  WebSocket sharing the backend — no separate collaboration service and no Redis.
- Presence uses Yjs **awareness** (`@tiptap/extension-collaboration-cursor`). The awareness
  payload is identity-only (stable id, display name, collaboration color) — no email or tokens
  are broadcast. Remote carets/selections are rendered by
  `apps/web/src/features/editor/collabCursor.ts`.

There is **no polling, no last-write-wins, and no whole-document replacement** anywhere in the
sync path.

---

## How offline editing works (the important part)

The assignment specifically flags the offline scenario as the part most projects do only
superficially, and says it will get "particularly close attention." So here is exactly how it
works and what it does — and does not — guarantee.

### In plain language

1. **Your document lives on your own device, too.** As you edit, ProDocs continuously saves a
   copy of the document in your browser's local storage (a browser database called
   **IndexedDB**). This happens whether or not you are online.
2. **You can keep editing with no internet.** If your connection drops, the editor does **not**
   lock or go read-only. You keep typing exactly as before; your changes are saved locally.
   The status indicator honestly switches to "Offline — saved locally."
3. **Meanwhile, other people can keep editing online.** Their changes are saved on the server.
4. **When you reconnect, the two sides reconcile.** Your browser and the server compare what
   each of them has and exchange only the **missing** changes (this comparison is called a
   _state-vector handshake_ — essentially "here's what I already have; send me the rest").
5. **The changes merge — they don't overwrite.** Because everything is expressed as Yjs CRDT
   operations, your offline edits and the other people's online edits are **combined**. Nobody's
   paragraph is thrown away because someone else saved more recently.

### For developers

- Local persistence is `y-indexeddb` (`IndexeddbPersistence` in
  `apps/web/src/features/collaboration/useCollaboration.ts`), created **independently of the
  WebSocket**. It loads the last-known content before the socket connects (offline-first load)
  and persists every update, so offline edits survive a reload once the network is back.
- On reconnect, the Hocuspocus provider performs the Yjs sync-step (state-vector) handshake and
  applies only the delta in each direction. There is **no `setContent` / no document
  replacement** — doing so would clobber concurrent edits and is deliberately avoided.
- The server rebuilds document state from PostgreSQL after a restart (snapshot + update-log
  replay), then the same handshake reconciles it with each client.
- The sync **status is derived truthfully** (`connectionState.ts`): it distinguishes _offline_
  (the browser reports no network — a reconnect can't succeed yet) from _reconnecting_ (network
  is up but the socket is momentarily down). Editability is a **role** fact, never a transport
  fact — being offline never makes the editor read-only.

### An honest scope note

- **Offline document _creation_ is intentionally not supported** — a brand-new document needs
  a server-issued id and a membership row first. This is flagged in the UI, not silently faked.
- Reloading the page while **still offline** would additionally require a service-worker
  app-shell cache, which is out of MVP scope. Offline _edits_ survive a reload once the network
  returns; the offline app _shell_ is listed under [Known limitations](#known-limitations).
- We do **not** claim mathematically "guaranteed zero data loss" beyond what CRDT semantics and
  the test suite demonstrate. What we _do_ claim — and test — is: concurrent and offline edits
  **merge** rather than overwrite, with an explicit no-last-write-wins assertion (see
  [Testing](#testing)).

---

## Architecture

### The big picture (plain language)

```
        Your browser                         Another user's browser
  ┌───────────────────────┐              ┌───────────────────────┐
  │  React UI             │              │  React UI             │
  │  Tiptap / ProseMirror │   (editor)   │  Tiptap / ProseMirror │
  │  Yjs document         │◄──────────┐  │  Yjs document         │
  │  IndexedDB (local     │           │  │  IndexedDB (local     │
  │   offline copy)       │           │  │   offline copy)       │
  └──────────┬────────────┘           │  └──────────┬────────────┘
             │  WebSocket             │             │  WebSocket
             ▼                        │             ▼
        ┌──────────────────────────────────────────────────┐
        │  Backend — one Node.js / Fastify process          │
        │   • HTTP API (auth, documents, sharing, media)    │
        │   • Hocuspocus collaboration server (WebSocket)   │
        └───────────────────────────┬──────────────────────┘
                                     ▼
                              ┌──────────────┐
                              │  PostgreSQL  │  document change-log
                              │              │  + snapshots + metadata
                              └──────────────┘
                              (uploaded image files → disk/volume)
```

- **The browser** runs the UI, the editor, the live Yjs copy of the document, and a local
  offline copy in IndexedDB.
- **The backend** is a single process that serves both the normal API (logging in, listing
  documents, sharing, image upload) **and** the real-time collaboration WebSocket. Keeping them
  together means access rules are enforced the same way for both.
- **PostgreSQL** is the long-term home of every document — stored as its change history plus
  periodic compact snapshots, so a document can always be rebuilt exactly.
- **Uploaded images** are stored as files (in a disk volume), referenced from documents by id.

### For developers

- **Monorepo** (pnpm workspaces): `apps/web` (React + Vite), `apps/server` (Fastify),
  `packages/shared` (TypeScript contracts, the editor/CRDT schema, roles, Zod validation,
  export model). Strict TypeScript throughout.
- **Backend**: Fastify with validated config, structured secret-redacting logging, `/health`
  (liveness) and `/ready` (readiness), a consistent error envelope, and rate limiting. The
  Hocuspocus server is attached to the same HTTP server (`apps/server/src/collab/attach.ts`).
- **Persistence model** (`apps/server/src/collab/persistence.ts`,
  `apps/server/src/modules/persistence/repo.ts`): `onLoadDocument` rebuilds a `Y.Doc` from the
  latest snapshot + the tail of the update log (seeding a blank doc once if new); `onChange`
  appends each binary update (the durability write); `onStoreDocument` compacts — writes a fresh
  snapshot and truncates the folded updates in one transaction. **Content is only ever binary
  Yjs state on the server — never HTML or ProseMirror JSON.**
- The full architecture set (system overview, realtime, offline sync, persistence, security,
  data model, ADRs) is in [`docs/architecture/`](docs/architecture/README.md) and is the
  source of truth for design rationale.

---

## Technology choices (and why)

The assignment explicitly asks _why_ these sync/offline tools were chosen. Short version:
almost every choice is "use a proven, correct library for the hard part, and keep our own code
small and honest."

| Technology                | Why it was chosen                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yjs (CRDT)**            | The assignment says to use an existing CRDT/OT library and _not_ to write one from scratch. Yjs is mature, fast, and battle-tested; its CRDT model is what makes concurrent and offline edits **merge** instead of overwriting. |
| **Tiptap / ProseMirror** | A robust rich-text model with a well-defined schema, and first-class Yjs integration (`y-prosemirror`). ProseMirror guarantees the document is always structurally valid.                     |
| **Hocuspocus**            | The reference Yjs collaboration server: it handles the WebSocket sync protocol, awareness, and lifecycle hooks for persistence, so we don't hand-roll the wire protocol. It embeds directly in our Fastify process. |
| **y-indexeddb**           | The standard way to persist a `Y.Doc` in the browser. This is what makes **offline editing** and offline durability work, and it plugs into the same Yjs update stream as the network transport. |
| **PostgreSQL**            | The assignment allows any database. A relational DB fits users/documents/memberships cleanly, and storing the Yjs change-log + snapshots as `bytea` gives durable, reconstructable documents.  |
| **React + Vite**          | Mainstream, fast component model and dev server; large ecosystem; pairs naturally with Tiptap's React bindings.                                                                              |
| **Node.js + Fastify**    | Lets the HTTP API and the (Node-based) Hocuspocus server share **one** process and language with the frontend. Fastify is fast, schema-friendly, and has mature auth/cors/rate-limit plugins. |
| **Not a custom OT/CRDT**  | Writing a correct OT/CRDT algorithm from scratch is exactly what the assignment says is unnecessary and not a plus. Using Yjs is the intended, responsible choice.                            |

More detail and the trade-offs are recorded as ADRs under
[`docs/architecture/adr/`](docs/architecture/adr/README.md).

---

## Data & collaboration model

- **The Yjs document is the single source of truth for content.** All rich text, formatting,
  page breaks, task-checkbox state, comment anchors, and image _references_ live inside the
  `Y.Doc`. React/Zustand state and `localStorage` are never used to hold document content.
- **Updates & persistence.** Every edit is a binary Yjs update. The server keeps an append-only
  update log plus periodic snapshots (compaction folds the log into a snapshot). This is stored
  in PostgreSQL as binary data.
- **Presence/awareness** is ephemeral (it lives only while you're connected) and is separate
  from document content — it carries just identity + cursor position, and disappears when you
  disconnect.
- **Comments** are stored as a Yjs `comment` mark plus a comments `Y.Map` in the same `Y.Doc`,
  so anchors move with the text, collaborate, and work offline. Comments are excluded from
  export.
- **Images**: the uploaded **binary is stored server-side** (a disk volume) with a content-
  sniffed type check and a random UUID key; the document only stores a `media` node with that
  id. **Binary image data is never placed inside Yjs or PostgreSQL's document tables.**

---

## Permissions & security

![ProDocs "Share document" dialog: a search box to add people by name or email, a role selector, and a "People with access" list showing an Owner, an Editor, and a Viewer](docs/screenshots/sharing.jpg)

- **Authentication**: email + password hashed with **Argon2id**. Sessions use a short-lived
  JWT access token (held in memory in the browser) plus an **httpOnly refresh cookie**
  (register / login / refresh / logout / current-user). Refresh tokens are rotated, with reuse
  detection and session revocation.
- **Authorization**: each document has `owner` / `editor` / `viewer` roles in a `memberships`
  table, which is the **single source of truth** for access. Forbidden access returns **404**
  (not 403) so document ids can't be enumerated by guessing.
- **The WebSocket reuses the same auth primitives as the HTTP API**
  (`apps/server/src/collab/auth.ts`): the socket authenticates with the access token and its
  membership is checked before any document loads. REST and WebSocket therefore can't enforce
  access differently.
- **Live permission changes are handled safely.** When an owner changes or revokes someone's
  role, that user's live socket is dropped with a dedicated close code; the client then
  **rebuilds its session against a fresh `Y.Doc`, purges that document's local IndexedDB copy,
  and re-syncs only the authoritative server state** — closing the path by which stale or
  now-unauthorized local edits could otherwise "resurrect." Viewers' local caches are likewise
  purged on load, since a viewer can never legitimately hold local-only edits. (Editors keep
  full offline durability.)
- **Upload validation**: images are content-sniffed (not trusted by extension), size-capped,
  and stored under safe UUID keys.
- **Abuse limits**: per-IP and per-user rate limiting, an HTTP body size cap, and a WebSocket
  frame size cap.

Why this matters for a collaborative editor specifically: offline-capable clients hold their
own copy of the document, so the security-critical question isn't just "can you connect" but
"can a client's _local_ state re-introduce edits it's no longer allowed to make" — which is
exactly the resurrection path the permission-change handling above closes.

See [`docs/architecture/security.md`](docs/architecture/security.md) for the full model and the
development-vs-production notes at the end of this README.

---

## Running locally

### Prerequisites

- **Docker** + **Docker Compose v2** — the only hard requirement to run the whole stack.
- _(Optional)_ **Node.js ≥ 20** and **pnpm ≥ 9** — only if you want to run lint/typecheck/tests
  directly on your host. You do **not** need to install PostgreSQL; Compose provides it.

### 1. Configure environment

```bash
cp .env.example .env
```

The defaults are safe for local development. If host port **5432** is already taken, set
`POSTGRES_PORT` in `.env` to something free (e.g. `5433`). **Never commit `.env`** or reuse the
example secrets in production.

### 2. Start the stack

```bash
docker compose up --build
```

This starts three services — `db` (PostgreSQL), `server` (Fastify + collaboration WebSocket),
and `web` (Vite dev server). The backend waits for the database, runs migrations
automatically, then serves the API. Then open:

- **App (frontend):** http://localhost:5173
- **Backend liveness:** http://localhost:4000/health
- **Backend readiness:** http://localhost:4000/ready

The Vite dev server proxies both `/api` (HTTP) and `/collab` (the collaboration WebSocket) to
the backend, so the browser talks same-origin.

### 3. Try collaboration

1. Sign up as user **A** in a normal window.
2. Open a **separate browser profile or an incognito window** (a plain second tab shares the
   session cookie, so it would be the _same_ user) and sign up as user **B**.
3. As A, open a document and click **Share**; add B as **Editor**. B sees it under
   **Shared with me**.
4. Open the document in both windows and type — changes appear live in both, with remote
   cursors.

### Common commands

| Task                                    | Command                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| Start (build if needed)                 | `docker compose up --build`                                        |
| Start in background                     | `docker compose up -d --build`                                     |
| Stop (keep data)                        | `docker compose down`                                              |
| View logs (all / one service)           | `docker compose logs -f` / `docker compose logs -f server`         |
| **Reset the database (destroys data)**  | `docker compose down -v && docker compose up -d`                   |
| Run migrations manually                 | `docker compose exec server pnpm --filter @scribe/server migrate`  |
| Open a psql shell                       | `docker compose exec db psql -U scribe -d scribe`                  |

> **Data safety:** normal `docker compose up`/rebuilds keep your data (it lives in the `db_data`
> named volume). Only `docker compose down -v` destroys the database volume.

**Server-restart durability check:** edit a document, wait for the status pill to read
_Synced_, then `docker compose restart server` and reload — the content is rebuilt from
PostgreSQL. (Use `restart`, **not** `down -v`.)

### Developer tooling (host, after `pnpm install`)

| Task                  | Command                            |
| --------------------- | ---------------------------------- |
| Install               | `pnpm install`                     |
| Type-check everything | `pnpm typecheck`                   |
| Lint / fix            | `pnpm lint` / `pnpm lint:fix`      |
| Format                | `pnpm format`                      |
| Run all unit tests    | `pnpm test`                        |
| Build all packages    | `pnpm build`                       |

### Environment variables

`.env.example` is the authoritative, commented list. The ones you're most likely to touch:

| Variable                             | Purpose                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `POSTGRES_USER/PASSWORD/DB/PORT`     | Database credentials and host port (defaults: `scribe` / `5432`). |
| `PORT`                               | Backend port (default `4000`).                                    |
| `WEB_PORT`                           | Frontend dev-server port (default `5173`).                        |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Auth signing secrets — **change in production**.            |
| `COOKIE_SECURE`                      | Set `true` in production (HTTPS).                                  |
| `CORS_ORIGINS`                       | Allowed browser origin(s); also the WebSocket origin allow-list in production. |
| `MEDIA_DIR` / `MEDIA_MAX_BYTES`      | Where uploaded images live, and the per-upload size cap.          |

---

## Testing

The project has unit, server-integration, real-collaboration, and browser end-to-end tests.
Be aware which ones need a running database or a running stack.

### Unit tests (no database needed)

```bash
pnpm test
```

Covers shared logic (roles, link-safety policy, editor/export models), UI primitives, editor
behavior, connection-state derivation, and the export renderers.

### Server integration, collaboration & offline tests (need PostgreSQL)

These hit a **real Postgres** and **self-skip if none is reachable**. They use a **separate
`scribe_test` database** — never your development `scribe` database.

```bash
docker compose up -d db          # start just the database
pnpm --filter @scribe/server test
```

This runs, over the **actual** Hocuspocus transport (not mocks), with byte-level state-vector
convergence assertions:

- `test/integration/collab.test.ts` — two-client sync, concurrent-edit convergence, viewer
  read-only, auth/authorization, idempotent persistence, server-restart recovery.
- `test/integration/offline.test.ts` — the offline conflict matrix: offline-then-reconnect
  merge, both-offline divergence, overlapping offline edits, connection flapping, long offline
  sessions, server-restart-while-offline, and an **explicit no-last-write-wins guard**.
- Plus `api`, `auth-security`, `auth-concurrency`, `permissions`, `sharing`, `ws-security`,
  `rate-limit`, `http-hardening`, `persistence`, `media`, `trash-recent`, `templates`.

> **Safety guard:** the test bootstrap creates `scribe_test` automatically and **refuses to
> run** if `DATABASE_URL` points at a database whose name isn't clearly a test database
> (override deliberately with `ALLOW_NONTEST_DB=1`). Do **not** point `DATABASE_URL` at your dev
> `scribe` database when testing. Default test DSN:
> `postgres://scribe:scribe_dev_password@localhost:5433/scribe_test`.

### Browser end-to-end tests (Playwright — need a running stack)

Real browsers, real IndexedDB, real network-offline via `context.setOffline`, and two
independent browser contexts for two distinct users.

```bash
# one-time: install the browser
pnpm --filter @scribe/web exec playwright install chromium

# start the stack (docker compose up), then run the suite pointed at the SAME database
DATABASE_URL='postgres://scribe:scribe_dev_password@localhost:5433/scribe' \
  pnpm --filter @scribe/web test:e2e
```

The E2E specs cover live collaboration, offline editing that stays editable + reconnect
convergence, offline-edit-survives-reload, both-offline divergence with no last-write-wins,
ephemeral presence, sharing, permission revocation, formatting, export, media/comments,
navigation, and branding.

### Honest test caveats

- The E2E suite **registers throwaway users against the running stack**, so its seed helper must
  point at the same database the running server uses. It only ever _adds_ rows (never
  truncates), so it can't wipe data — but to keep dev data pristine, run E2E against a disposable
  database (e.g. `POSTGRES_DB=scribe_e2e` with a matching `DATABASE_URL`).
- The **dev server's registration endpoint is rate-limited**. A full Playwright run that
  registers many users quickly can hit that limit; run the stack with `NODE_ENV=test` (which the
  test setup uses) so the suite's registrations aren't throttled.
- There is a **known, pre-existing task-list checkbox E2E assertion** that can be flaky/failing
  and is unrelated to the collaboration/offline core; it is called out here rather than hidden.
- **This README does not claim the entire E2E suite is green in every environment.** Typecheck
  passes cleanly across all packages (`pnpm typecheck`); the unit and server-integration suites
  are the most reproducible. E2E results depend on the running stack and the caveats above.

See [`docs/architecture/testing-strategy.md`](docs/architecture/testing-strategy.md) for the
full testing philosophy.

---

## Submission demo script (for the video)

A 3–5 minute screen recording that shows the two things the assignment cares about most.
Suggested flow:

1. **Open the same document as two users.** Two browser profiles/incognito windows, signed in
   as A and B; A shares the document with B as Editor.
2. **Show presence.** Point out both names/colors in the header and each other's live cursor.
3. **Live typing.** A types a sentence; B sees it appear **without reloading**. Then B types and
   A sees it.
4. **Concurrent edits.** Both type in different paragraphs at the same time — both edits land,
   nothing is lost.
5. **Go offline (the key part).** In A's DevTools → Network, switch to **Offline**. Show the
   status change to "Offline — saved locally," then **keep editing** in A (add a clearly
   distinct paragraph). Meanwhile, have B (still online) edit a different part.
6. **Reconnect.** Turn A's network back on. Within a moment, both windows **converge**: A's
   offline edits and B's online edits are **both present on both sides**.
7. **Explain briefly why it merges.** One line: "Changes are merged with Yjs CRDTs — edits are
   combined, not overwritten; there's no last-write-wins."

Optional extras if time allows: export to PDF, a comment, or an image paste.

---

## Project structure

```
apps/
  web/       # React + Vite frontend
    src/
      app/            # shell (header, sidebar, routing)
      ui/             # design-system primitives (Editorial Precision)
      api/            # HTTP client + token handling
      stores/         # Zustand stores (UI/auth state — never document content)
      features/
        editor/       # Tiptap editor, toolbar, pagination, media node views
        collaboration/# Yjs + Hocuspocus + y-indexeddb lifecycle, presence
        documents/    # lists, trash, recent, metadata cache
        sharing/      # Share dialog + membership UI
        comments/     # inline comments UI
        export/       # PDF + DOCX generation
        templates/    # template gallery
        auth/         # sign in / sign up
    e2e/              # Playwright specs
  server/    # Fastify backend
    src/
      collab/         # Hocuspocus attach, WS auth, persistence hooks
      modules/        # auth, users, documents, memberships, media, persistence
      db/             # pool + SQL migrations
      http/, config/, observability/
    test/             # unit + integration (real Postgres)
packages/
  shared/    # @scribe/shared — editor/CRDT schema, DTOs, roles, Zod, export model
docs/architecture/   # architecture docs + ADRs (source of truth)
UI/                  # design reference: DESIGN.md, screen.png
docker-compose.yml   # dev stack: web + server + postgres
.env.example         # environment template (copy to .env)
```

> Note on naming: the product is **ProDocs** (all user-facing surfaces). Internal package ids
> (`@scribe/*`) and some storage keys keep the original `scribe` name to avoid a churny,
> risk-only rename of internal identifiers.

---

## Known limitations

Stated plainly, and separated from the requirements they don't affect:

- **No hosted live demo** — run locally (this is by design for a take-home).
- **The demo video is not yet recorded** — the script is above.
- **Single-instance backend.** Rate limiting and the collaboration server are in-process. A
  horizontally-scaled deployment would need a shared store (e.g. Redis) — intentionally out of
  MVP scope.
- **Offline app-shell reload.** Offline _edits_ survive a reload once the network returns, but
  reloading the page while _still_ offline needs a service-worker app-shell cache (not built).
- **Offline document _creation_** is not supported (a new document needs a server-issued id +
  membership first); flagged in the UI, not faked.
- **No background compaction sweep / orphaned-media GC / version history / ownership transfer /
  email-link invitations** — these are noted as future work, not present.
- **Test-environment caveats** — see the honest notes under [Testing](#testing) (E2E needs a
  running stack + seed DB; dev-server registration rate limit; a known task-list checkbox E2E
  assertion).

None of these affect the mandatory MVP: rich-text editing, real-time collaboration, offline
editing with conflict-free merge, presence, and persistence are all implemented and tested.

---

## Security notes (development vs. production)

- The `.env.example` secrets are **development-only**; the server refuses to start in
  `NODE_ENV=production` with default JWT secrets.
- In production set `COOKIE_SECURE=true` (HTTPS), strong unique `JWT_*` secrets, and a
  restrictive `CORS_ORIGINS`.
- **WebSocket origin:** the `/collab` upgrade checks the request `Origin` against
  `CORS_ORIGINS` in production (any origin allowed in development for convenience). Run all WS
  traffic over `wss://` behind a TLS-terminating reverse proxy. The socket authenticates with
  the short-lived access token only; the refresh token is never sent to the WebSocket layer.

See [`docs/architecture/security.md`](docs/architecture/security.md) for the complete model.
