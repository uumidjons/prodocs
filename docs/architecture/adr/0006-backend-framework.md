# ADR-0006 — Backend: Node.js + TypeScript, Fastify + Hocuspocus, Modular Monolith

**Status:** Accepted

## Context

The backend must serve an HTTP API (auth, document metadata, membership), run the Yjs
WebSocket sync server, and handle persistence. It should be productive, simple, testable,
and maintainable for a small team — not a distributed system.

## Decision

**Node.js + TypeScript**, a **single modular-monolith process** exposing **Fastify** for
HTTP and **Hocuspocus** for WebSocket, sharing internal modules (auth / documents /
persistence) and one Postgres connection.

## Alternatives considered

- **NestJS** — batteries-included and structured, but heavier (decorators/DI) than this
  scope needs; Fastify gives us the same testability with less ceremony.
- **Go / Rust** — great performance, but the Yjs server ecosystem (Hocuspocus, y-websocket)
  and the shared TypeScript CRDT types live in Node. A non-Node backend would force a
  language boundary at the CRDT — the most correctness-sensitive seam. Rejected on
  "minimize model translations".
- **Python (FastAPI)** — good HTTP story, but no first-class mature Yjs server; same
  boundary problem.
- **Microservices** — explicitly out; nothing in the requirements justifies the operational
  cost, and splitting HTTP from WS would fracture shared access-control logic.

## Why this stack

- **One language end-to-end** (browser ↔ wire ↔ server) with the _same_ Yjs types via
  `packages/shared` — the client and server can't disagree about the document schema.
- **Hocuspocus is Node** — choosing Node lets us use the mature Yjs server directly instead
  of reimplementing the sync protocol elsewhere.
- **Fastify** — fast, schema-based validation (input-validation requirement), first-class
  TypeScript, easy to unit/integration test; handles the WS upgrade alongside HTTP.
- **Modular monolith** — HTTP and WS are two entry points into shared modules; access
  control is written once and used by both. Simple to run, test, and reason about.

## Trade-offs

- Node's single-threaded model: CPU-heavy CRDT operations on huge docs could block the loop
  — mitigated by compaction limits and, if ever needed, worker threads / multiple instances
  (the documented scaling seam).
- A monolith scales vertically first; horizontal scaling needs the Redis pub/sub seam
  ([../infrastructure.md](../infrastructure.md)) — acceptable and explicitly out of MVP.

## Consequences

- Backend layout is `http/`, `collab/`, and shared `modules/` (see
  [../project-structure.md](../project-structure.md)).
- Auth and membership checks are enforced identically on REST and WS.
