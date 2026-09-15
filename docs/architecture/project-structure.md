# Project Structure

A **pnpm monorepo** with two apps and shared packages. The monorepo is justified — not
cargo-culted — because the client and server **share the collaborative types and the CRDT
schema**, and a shared package guarantees they can't drift (a mismatch there is exactly how
merge bugs happen). It also lets integration tests import both sides directly.

```
clone-google-docs/
├─ apps/
│  ├─ web/                        # React + TS + Vite frontend
│  │  ├─ src/
│  │  │  ├─ app/                  # shell, routing, providers
│  │  │  ├─ features/
│  │  │  │  ├─ editor/            # Tiptap setup, toolbar, schema config
│  │  │  │  ├─ collaboration/     # provider wiring, awareness/presence UI, cursors
│  │  │  │  ├─ documents/         # list, create, load
│  │  │  │  └─ auth/              # login/signup, token handling
│  │  │  ├─ sync/                 # HocuspocusProvider + y-indexeddb setup, sync state machine
│  │  │  ├─ api/                  # typed REST client
│  │  │  ├─ ui/                   # design-system components (tokens from UI/DESIGN.md)
│  │  │  ├─ stores/               # Zustand stores (UI/sync state only)
│  │  │  └─ types/                # re-exports from @scribe/shared
│  │  └─ tests/                   # component + e2e (Playwright)
│  └─ server/                     # Node + TS backend (modular monolith)
│     ├─ src/
│     │  ├─ http/                 # Fastify app, routes, schemas
│     │  ├─ collab/               # Hocuspocus server, auth/load/store hooks
│     │  ├─ modules/
│     │  │  ├─ auth/              # login, refresh, hashing
│     │  │  ├─ documents/         # metadata CRUD, membership checks
│     │  │  └─ persistence/       # doc_update log, snapshots, compaction
│     │  ├─ db/                   # migrations, queries, Postgres client
│     │  └─ config/               # env loading/validation
│     └─ tests/                   # unit + integration
├─ packages/
│  └─ shared/                     # @scribe/shared: TS types, CRDT schema helpers,
│                                 #   Yjs update codec utils, role enums, constants
├─ docs/
│  └─ architecture/               # this documentation set + adr/
├─ UI/                            # existing visual source of truth (DESIGN.md, screen.png, code.html)
├─ infra/
│  ├─ docker-compose.yml          # web, server, postgres, reverse proxy
│  └─ proxy/                      # Caddy/Nginx config
├─ .env.example
├─ package.json                   # workspaces, root scripts
└─ README.md                      # run instructions + why these tools (deliverable)
```

## Why this shape

- **`apps/` vs `packages/`** — clear split between deployables and shared libraries.
- **`packages/shared`** — the one thing both sides _must_ agree on (types, CRDT schema, role
  enums) lives once. This is the concrete payoff of the monorepo.
- **Feature-first frontend** (`features/editor`, `features/collaboration`, …) rather than
  type-first (`components/`, `hooks/`) so responsibilities are obvious and a reviewer can
  find "where collaboration lives" instantly.
- **`sync/` is its own thing** on the frontend — the provider + IndexedDB + state machine
  are isolated from both UI and editor, matching the layer separation in
  [system-overview.md](system-overview.md).
- **Backend `modules/`** — auth, documents, persistence are internal modules of one
  process, not services. Two entry points (`http/`, `collab/`) share them.
- **`infra/`** — one `docker-compose` brings up the whole system for local dev and mirrors
  production topology.

## What we deliberately did _not_ create

- No `microservices/`, no `gateway/` service, no message-broker config — single monolith.
- No premature `packages/ui-kit` published library — the design system lives in `apps/web/ui`
  until there's a second consumer.
- No `k8s/` or Helm charts — Docker Compose is the deployment unit for this assignment.
