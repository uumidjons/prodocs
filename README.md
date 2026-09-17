# ProDocs

A web-based **collaborative rich-text document editor** — inspired by the idea of Google
Docs, but with its own visual identity ("Editorial Precision", see [`UI/DESIGN.md`](UI/DESIGN.md))
and its own UX. It is built around the hard requirements: **real-time collaboration,
offline editing, and conflict-free merge**.

> **Current status: Phase 5 — Sharing & final product polish.**
> Builds on the Phase 4 hardened system and closes the last product gap: a real user-facing
> **Share flow** — the owner adds registered users, assigns Editor/Viewer, changes roles, and
> removes members — backed by a **server-side membership API** (list/add/change-role/remove)
> and a minimal user search, all authorized against the existing `memberships` table (the
> frontend never supplies a trusted role). The dashboard now separates documents you own from
> those shared with you. This adds **no** new infrastructure: no Redis, no new service, no CRDT
> change — Yjs remains the sole conflict-resolution mechanism, access tokens stay memory-only,
> refresh tokens stay `httpOnly`, and there is no LWW / custom merge / whole-document
> replacement. See the [sharing demo](#demonstrating-sharing-phase-5), the
> [collaboration demo](#demonstrating-real-time-collaboration), the
> [offline demo](#demonstrating-offline-editing--conflict-free-merge-phase-3),
> [`docs/architecture/security.md`](docs/architecture/security.md), and [Roadmap](#roadmap).

The architecture that drives all of this is documented in
[`docs/architecture/`](docs/architecture/README.md) and is the source of truth.

---

## What's implemented in Phase 0

- **pnpm monorepo** — `apps/web` (frontend), `apps/server` (backend), `packages/shared`
  (shared TypeScript contracts). Strict TypeScript everywhere.
- **Dockerized dev stack** — `web`, `server`, and `postgres` via Docker Compose; Postgres
  on a persistent named volume with a healthcheck; the backend waits for DB readiness and
  runs migrations on boot.
- **Backend (Fastify)** — validated config, structured logging (secrets redacted),
  `/health` (liveness) + `/ready` (readiness), consistent error envelope, rate limiting.
- **Authentication** — email + password with **Argon2id**, short-lived JWT access token
  (in memory on the client) + **httpOnly refresh cookie**, register / login / refresh /
  logout / current-user.
- **Authorization** — document `owner`/`editor`/`viewer` roles, membership checks on every
  document route, **404-on-forbidden** to prevent access enumeration.
- **Document metadata API** — create / list / get / rename / delete (metadata only; the
  collaborative _content_ will be Yjs in a later phase — it is **not** stored as HTML).
- **Frontend (React + Vite + Tailwind + Zustand)** — application shell (header, sidebar,
  routed document area), auth screens, document list, a document view with a live/persisted
  title and a **placeholder** where the editor canvas will mount. Design tokens from
  `UI/DESIGN.md` are encoded into Tailwind.
- **Tests** — unit (config, password hashing, JWT, roles, UI primitives) and integration
  (full HTTP API against a real Postgres, incl. auth flows and 404-on-forbidden).

**Not in Phase 0 (later phases):** Yjs, Hocuspocus, WebSocket document sync, `y-indexeddb`,
awareness/presence, remote cursors, CRDT persistence (update log / snapshots), offline
merge. See [`docs/architecture/`](docs/architecture/README.md).

## Technology stack

| Layer                  | Choice                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| Frontend               | React 18, TypeScript, Vite, Tailwind CSS, Zustand, React Router             |
| Backend                | Node.js 22, TypeScript, Fastify, `pg` (node-postgres)                       |
| Auth                   | Argon2id (`@node-rs/argon2`), JWT (`jsonwebtoken`), httpOnly refresh cookie |
| Shared                 | `@scribe/shared` — DTOs, role logic, Zod validation schemas                 |
| Database               | PostgreSQL 16                                                               |
| Tooling                | pnpm workspaces, ESLint, Prettier, Vitest, Docker Compose                   |
| Planned (later phases) | Yjs, Tiptap/ProseMirror, Hocuspocus, y-indexeddb                            |

## Repository structure

```
apps/
  web/       # React + Vite frontend (app shell, ui/ design system, api/, stores/, features/)
  server/    # Fastify backend (config/, db/ + migrations, http/, modules/{auth,users,documents,memberships})
packages/
  shared/    # @scribe/shared — DTOs, roles, Zod schemas (imported by both sides)
docs/architecture/   # architecture docs + ADRs (source of truth)
UI/          # visual source of truth: DESIGN.md, screen.png, code.html
docker-compose.yml   # dev stack: web + server + postgres
.env.example         # environment template (copy to .env)
```

See [`docs/architecture/project-structure.md`](docs/architecture/project-structure.md) for
the rationale (note: the Compose file lives at the repo root for one-command startup).

---

## Getting started

### Prerequisites

- **Docker** + **Docker Compose v2** (the only hard requirement to run the stack).
- Optionally **Node.js ≥ 20** and **pnpm ≥ 9** for host-side tooling (lint/typecheck/tests
  in your editor). You do **not** need to install PostgreSQL — Compose provides it.

### 1. Configure environment

```bash
cp .env.example .env
```

The defaults are safe for local development. If host port **5432** is already in use, set
`POSTGRES_PORT` to something free (e.g. `5433`). **Never commit `.env`** or use the default
secrets in production.

### 2. (Optional) install for local tooling

```bash
pnpm install
```

Only needed for running lint/typecheck/tests directly on the host. The Docker images
install their own dependencies, so this is not required just to run the app.

### 3. Start the stack

```bash
docker compose up --build
```

Then open:

- **Frontend:** http://localhost:5173
- **Backend health:** http://localhost:4000/health
- **Backend readiness:** http://localhost:4000/ready

The backend waits for Postgres, applies migrations automatically, and serves the API. The
frontend's dev server proxies both `/api` (HTTP) and `/collab` (the collaboration WebSocket) to
the backend, so the browser talks same-origin. HTTP and WebSocket share **one** backend process
and port (a modular monolith — no separate collaboration service, no Redis).

---

## Demonstrating sharing (Phase 5)

Sharing is a real, owner-only flow enforced server-side (the `memberships` table is the
authorization source of truth; the frontend never supplies a trusted role):

1. **Start the stack** and sign up two users A and B (two separate profiles/incognito windows,
   as above).
2. **As A, open a document and click Share.** The dialog lists current members (you, marked
   **Owner**). Search for B by name or email, pick **Editor** or **Viewer**, and add them.
3. **As B, reload the dashboard.** The document appears under **Shared with me** with B's role
   badge. Open it: an **Editor** can edit live; a **Viewer** sees live edits but the editor is
   read-only (the server rejects viewer writes).
4. **Change or revoke access.** Back as A, reopen **Share** to change B's role or remove them.
   A role/removal change is enforced immediately over REST and applies to B's live session on
   its next (re)connect (reload) — the documented single-instance behavior; an already-open
   socket is not force-closed.

Only the owner sees management controls — an editor or viewer opening Share sees a read-only
roster and "Only the owner can manage sharing." Owner/editor/viewer semantics, the owner
invariant, cross-document IDOR rejection, and input validation are covered by
`apps/server/test/integration/sharing.test.ts` and the multi-user Playwright flow
`apps/web/e2e/sharing.spec.ts`.

## Demonstrating real-time collaboration

Collaboration is a real Yjs + Hocuspocus WebSocket stack — edits propagate live and converge
via CRDT (no polling, no whole-document replacement). To see two users editing together:

1. **Start the stack:** `docker compose up --build`, then open http://localhost:5173.
2. **Create two users.** In a normal window, sign up as user A (e.g. `a@example.com`). Open a
   **second, separate browser profile or an incognito window** (a plain second tab shares the
   same session cookie, so it would be the _same_ user) and sign up as user B.
3. **Share the document (real UI, Phase 5).** As user A, open the document and click **Share**
   in the header. Search for user B by name or email, choose **Editor** (or **Viewer** for
   read-only), and add them. B now sees the document under **Shared with me** on the dashboard.
   (Membership remains the access-control source of truth; the Share dialog just calls the
   owner-only membership API — see [Demonstrating sharing](#demonstrating-sharing-phase-5).)

4. **Collaborate.** Open `/d/<id>` in both windows. Type in A → it appears in B without a reload,
   and vice-versa. Each peer shows a colored remote cursor with their name; the header shows a
   live presence stack and a **Synced to cloud** status pill. Close B's window and its presence
   disappears; reopen and it re-syncs.

Inspect the collaboration server logs with `docker compose logs -f server` (tokens are
redacted; no secrets are logged).

**Server-restart durability:** edit a document, wait for the status pill to read _Synced_, then
`docker compose restart server`. Reload the document — the content is reconstructed from
Postgres. (Use `restart`, **not** `down -v`, which intentionally destroys the database volume.)

## Demonstrating offline editing & conflict-free merge (Phase 3)

Offline is a first-class feature: the editor writes to a local `Y.Doc` persisted in
**IndexedDB** (via `y-indexeddb`), and reconnect merges local + remote through the Yjs
state-vector handshake — no last-write-wins, no whole-document overwrite. To see it:

1. **Set up two users on one document** as in steps 1–3 above (two separate browser
   profiles/incognito windows; share with B via the **Share** dialog). Open `/d/<id>` in both;
   wait for both status pills to read **Synced to cloud**.
2. **Take User A offline.** Open DevTools → Network → set **Offline** (or toggle your OS
   network). A's status pill switches to **Offline — saved locally**. (A server outage while
   the browser still has network shows **Reconnecting…** instead — the two causes are
   distinguished truthfully.)
3. **Keep editing in both windows.** Type in A — it keeps working; the editor is **not**
   read-only just because the socket is down. Independently type in B (still online).
4. **Bring User A back online.** Untick Offline. Within a moment both windows **converge**:
   A's offline edits and B's independent edits are **both** present on both sides, merged by
   Yjs. Neither user's work is lost or overwritten.
5. **Reload durability.** With an offline edit made, bring the network back, then reload A —
   the edit is still there (it was persisted locally in IndexedDB). _Note:_ reloading while
   **still** offline additionally needs a service-worker app-shell cache, which is out of MVP
   scope; reload after the network returns.
6. **Server restart while offline.** Take A offline and edit; `docker compose restart server`;
   let B reconnect and edit; bring A back — A's offline edit and B/server's edit both survive
   (server state is rebuilt from Postgres, then the handshake reconciles).

> **Scope note:** offline document _creation_ is intentionally **not** supported (a new
> document needs a server-issued id + membership first); this is flagged, not silently faked.

---

## Document export (PDF & Word)

Any document you can open can be exported from the header **Export ▾** control (PDF or
Word `.docx`). Export is available to **owner, editor, and viewer** — it is a read-only
action — and never appears for a document you cannot access. Trashed documents follow the
existing rule: they are not openable through the document route, so they are not exportable.

**How it works (fully client-side):**

- **Single source of truth.** Export serializes the current editor state via
  `editor.getJSON()` — a read-only snapshot of the collaborative document (a projection of
  the Yjs CRDT). It never calls `setContent`, never mutates the `Y.Doc`, never changes the
  schema, and never disturbs other collaborators. A dedicated regression test asserts the
  editor JSON **and** the encoded Yjs state are byte-identical before and after an export.
- **One transform, two renderers.** A pure, shared transform
  (`packages/shared/src/exportModel.ts`) normalizes the ProseMirror JSON into a page-split
  model; the PDF path ([`pdf-lib`](https://pdf-lib.js.org/)) and the DOCX path
  ([`docx`](https://docx.js.org/)) are thin renderers over it.
- **Real A4 pages & page breaks.** Both formats reuse the editor's own A4 geometry
  (`apps/web/src/features/editor/pageGeometry.ts`), converting px→pt (PDF) and px→twips
  (DOCX). Every `pageBreak` node becomes a **real page boundary** (a new PDF page / a Word
  `PageBreak`) — never the literal text "pageBreak". PDF content that overflows a page flows
  onto continuation pages.
- **Formatting preserved:** paragraphs, H1–H3, **bold**, _italic_, underline,
  ~~strikethrough~~, `inline code`, task checklists (with checked state), blockquotes,
  links, bullet & numbered lists, left/center/right/justified alignment, empty
  paragraphs, and multi-page documents. PDF uses a serif (Times) body face and Courier
  for inline code; DOCX uses Word's built-in Heading styles, real bullet/decimal
  numbering, and **real clickable hyperlinks**. (PDF links are shown as blue underlined
  text — the pdf-lib text pipeline does not emit clickable annotations.)
- **Offline.** Because generation is entirely in-browser from the local Yjs state and the
  generators are bundled (not fetched on demand), export works **offline** with no network
  round trip.
- **Filenames.** The download is named from the document title, sanitized against
  filesystem-illegal characters and path traversal (e.g. `Meeting Notes` → `Meeting
Notes.pdf` / `.docx`); an empty/unusable title falls back to `document`.
- **No server, no DB changes.** Export adds no backend endpoint, no migration, and no new
  persistence — the existing document access controls already gate whether a document is
  available to export.

---

## Common commands

| Task                                    | Command                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| Start (build if needed)                 | `docker compose up --build`                                        |
| Start in background                     | `docker compose up -d --build`                                     |
| Stop (keep data)                        | `docker compose down`                                              |
| Rebuild after dependency/source changes | `docker compose up --build` (or `docker compose build --no-cache`) |
| View logs (all / one service)           | `docker compose logs -f` / `docker compose logs -f server`         |
| Reset the database (destroys data)      | `docker compose down -v && docker compose up -d`                   |
| Run migrations manually                 | `docker compose exec server pnpm --filter @scribe/server migrate`  |
| Open a psql shell                       | `docker compose exec db psql -U scribe -d scribe`                  |

### Developer tooling (host, after `pnpm install`)

| Task                  | Command                            |
| --------------------- | ---------------------------------- |
| Type-check everything | `pnpm typecheck`                   |
| Lint                  | `pnpm lint` (fix: `pnpm lint:fix`) |
| Format                | `pnpm format`                      |
| Run all tests         | `pnpm test`                        |
| Build all packages    | `pnpm build`                       |

**Running the integration & collaboration tests** (they hit a real Postgres and self-skip if
none is reachable): start the DB, then run them —

```bash
docker compose up -d db
pnpm --filter @scribe/server test
```

> **The tests use a SEPARATE database (`scribe_test`), never your development `scribe` database.**
> The integration suite `TRUNCATE`s every table before each test, so it must never point at
> development data. The default test connection is
> `postgres://scribe:scribe_dev_password@localhost:5433/scribe_test` (see
> `apps/server/test/db-config.ts`); the test bootstrap creates that database automatically and a
> guard **refuses to run** if `DATABASE_URL` points at a database whose name is not clearly a test
> database (override deliberately with `ALLOW_NONTEST_DB=1`). Do **not** set `DATABASE_URL` to your
> dev `scribe` database when running tests — that is what previously wiped accounts on every test
> run. Normal `docker compose up` / rebuilds keep your dev data (it lives in the `db_data` named
> volume); only `docker compose down -v` destroys it.

This runs the real
WebSocket collaboration suite (`test/integration/collab.test.ts`): two-client sync,
concurrent-edit convergence, viewer read-only, auth/authorization, idempotent persistence, and
server-restart recovery — plus the Phase 3 **offline conflict matrix**
(`test/integration/offline.test.ts`): offline-then-reconnect merge, both-offline divergence,
different-region and overlapping offline edits, connection flapping, long offline sessions,
server-restart-while-offline, and an explicit no-last-write-wins guard. All over the actual
Hocuspocus transport with byte-level state-vector convergence assertions, not mocks.

**Running the browser (Playwright) offline E2E** — real browsers, real IndexedDB, real network
offline via `context.setOffline`, two independent browser contexts for two distinct users:

```bash
# one-time: install the browser
pnpm --filter @scribe/web exec playwright install chromium

# start the stack (DB + server + web) — e.g. docker compose up, or run them on the host
# then, pointing the seed helper at the SAME database the running server uses:
DATABASE_URL='postgres://scribe:scribe_dev_password@localhost:5433/scribe' \
  pnpm --filter @scribe/web test:e2e
```

> The E2E suite registers throwaway users against the **running** stack, so its seed helper must
> use the same database that stack's server uses. It only ever _adds_ rows (never truncates), so it
> cannot wipe data — but to keep your development `scribe` database pristine, run the E2E stack
> against a disposable database, e.g. start it with `POSTGRES_DB=scribe_e2e` (and matching
> `DATABASE_URL`) and point the seed helper at `.../scribe_e2e`.

The E2E suite (`apps/web/e2e/offline.spec.ts`) covers: live collaboration, offline editing that
stays editable + reconnect convergence, offline-edit-survives-reload, both-offline divergence
with no last-write-wins, and ephemeral presence (disappears on disconnect, returns on reconnect).
Set `PLAYWRIGHT_BASE_URL` to target a deployment other than the default `http://localhost:5173`.

---

## Roadmap

Phase 0 is the foundation. Subsequent phases layer on the real-time/offline system
described in the architecture docs, **without** re-architecting:

1. **Phase 0 — Foundation** ✅ — monorepo, Docker, DB + migrations, auth, document metadata,
   app shell.
2. **Phase 1 — Editor** ✅ — Tiptap/ProseMirror rich-text editor (bold, italic, underline,
   strikethrough, inline code, headings, bullet/numbered lists, task checklists, blockquote,
   links, alignment, page breaks) mounted in the document canvas. All formatting is real
   ProseMirror/Yjs document state — see
   [`docs/architecture/editor-formatting.md`](docs/architecture/editor-formatting.md) and
   [ADR 0011](docs/architecture/adr/0011-link-safety-policy.md) for schema and link-safety
   details.
3. **Phase 2 — Real-time collaboration** ✅ _(this phase)_ — Yjs + Hocuspocus over WebSocket,
   live multi-user editing, WebSocket auth/authorization, presence/awareness, remote cursors,
   `y-indexeddb` local persistence, and CRDT persistence on the server (update log + snapshots).
4. **Phase 3 — Offline & merge** ✅ _(this phase)_ — the truthful sync state machine
   (offline/reconnecting/syncing/synced), reconnect + conflict-free merge under the full offline
   scenario matrix (offline edits, flapping, long offline, simultaneous/divergent/overlapping
   offline edits, server-restart-while-offline), offline-open of a locally-known document via a
   content-free metadata cache, plus the scripted convergence integration suite and Playwright
   multi-context E2E.
5. **Phase 4 — Durability & security hardening** ✅ _(this phase)_ — stateful refresh-token
   rotation + reuse detection + session revocation, HTTP body / WebSocket frame size caps,
   per-IP + per-user rate limiting (in-memory, single-instance), structured secret-free
   security event logging, crash-safe transactional persistence + compaction, and security /
   durability regression suites. See [`docs/architecture/security.md`](docs/architecture/security.md)
   and [ADR-0009](docs/architecture/adr/0009-refresh-rotation-and-abuse-limits.md).
6. **Phase 5 — Sharing & product polish** ✅ _(this phase)_ — a real user-facing Share flow
   (owner adds registered users, assigns Editor/Viewer, changes roles, removes members) backed
   by a server-side membership API + user search authorized against the existing `memberships`
   table; owner invariant + cross-document IDOR rejection + input validation; dashboard grouping
   into owned vs. shared; sharing integration + multi-user Playwright coverage. No Redis, no new
   service, no CRDT change. See [`ADR-0010`](docs/architecture/adr/0010-sharing-membership-api.md).
7. **Document export** ✅ — client-side PDF ([`pdf-lib`](https://pdf-lib.js.org/)) and Word
   `.docx` ([`docx`](https://docx.js.org/)) export from the current editor state, reusing the
   editor's A4 geometry, turning `pageBreak` nodes into real page boundaries, preserving
   headings/emphasis/lists/alignment, working offline, and never mutating the Yjs document. No
   backend endpoint, no migration, no CRDT change.
8. **Editor formatting completion** ✅ — strikethrough, inline code, task checklists,
   blockquote, and safe links wired to the toolbar as real ProseMirror/Yjs schema features.
   See [`editor-formatting.md`](docs/architecture/editor-formatting.md).
9. **Media attachments & inline comments** ✅ _(this phase)_ — image upload (PNG/JPEG/WebP) to
   authenticated **object storage** referenced by a `media` schema node (the binary is never
   in Yjs); server-authorized upload/serve with content-sniffed validation and safe UUID keys;
   and **inline comments** as a Yjs `comment` mark + comments `Y.Map` (anchors move with the
   text, collaborate, work offline, and are excluded from export). No second CRDT, no
   whole-document replacement. See
   [`media-and-comments.md`](docs/architecture/media-and-comments.md),
   [`ADR-0012`](docs/architecture/adr/0012-media-storage.md), and
   [`ADR-0013`](docs/architecture/adr/0013-inline-comments.md).
10. **Phase 6+ (future)** — multi-instance scaling (shared rate-limit/pubsub store, e.g.
    Redis), a media-storage GC sweep for orphaned binaries, service-worker offline app shell,
    offline document creation, version history, ownership transfer, email/link invitations.

Full detail: [`docs/architecture/README.md`](docs/architecture/README.md).

## Security notes (development vs. production)

- The shipped `.env.example` secrets are **development-only**; the server refuses to start
  in `NODE_ENV=production` with default JWT secrets.
- In production set `COOKIE_SECURE=true` (HTTPS), strong unique `JWT_*` secrets, and a
  restrictive `CORS_ORIGINS`. See [`docs/architecture/security.md`](docs/architecture/security.md).
- **WebSocket origin:** the `/collab` upgrade checks the request `Origin` against
  `CORS_ORIGINS` in production (any origin is allowed in development for convenience), so set
  `CORS_ORIGINS` to your real frontend origin(s) in production. All WS traffic should run over
  `wss://` behind the TLS-terminating reverse proxy. The socket authenticates with the
  short-lived access token only; the refresh token is never sent to the WebSocket layer.
