# Technical Decisions (summary)

This is the executive summary of the technology choices. Each row links to a full ADR with
context, alternatives, trade-offs, and consequences. **Decisions are made on fit for the
three hard requirements (real-time, offline, conflict-free merge), not popularity.**

| Concern            | Choice                                                   | Main alternatives                              | One-line reason                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CRDT engine        | **Yjs**                                                  | Automerge, ShareDB (OT)                        | Fastest + smallest updates, first-class rich-text type, native IndexedDB + awareness + editor bindings — the whole offline/presence/editor stack exists and interoperates. [ADR-0002](adr/0002-crdt-technology.md) |
| Rich-text editor   | **Tiptap / ProseMirror**                                 | Slate, Lexical, Quill                          | Official, battle-tested Yjs binding (`y-prosemirror`) incl. cursors; strict schema; headless so we can build the original UI. [ADR-0001](adr/0001-rich-text-editor.md)                                             |
| Transport          | **WebSocket via Hocuspocus**                             | raw `y-websocket`, WebRTC, custom WS           | Yjs-native server with auth/load/store hooks and awareness built-in; less bespoke code than raw and safer than P2P WebRTC. [ADR-0003](adr/0003-realtime-transport.md)                                              |
| Offline store      | **IndexedDB via `y-indexeddb`**                          | localStorage, OPFS, custom                     | Async, large-capacity, structured; the provider persists CRDT _updates_, so merge stays lossless. localStorage is explicitly rejected. [ADR-0004](adr/0004-offline-persistence.md)                                 |
| Server persistence | **Postgres: update log + snapshots**                     | single blob, updates-only, external Yjs stores | Survives restart, bounded storage via compaction, fast cold load. [ADR-0005](adr/0005-server-persistence.md)                                                                                                       |
| Backend            | **Node.js + TS, Fastify + Hocuspocus, modular monolith** | NestJS, Go, Python                             | One language across the wire with the CRDT; Hocuspocus is Node-only; monolith fits the scope. [ADR-0006](adr/0006-backend-framework.md)                                                                            |
| Frontend           | **React + TS + Vite, Zustand**                           | Vue/Svelte; Redux/MobX                         | Best editor/Yjs ecosystem; Zustand covers the little non-CRDT UI state without Redux ceremony. [ADR-0007](adr/0007-frontend-architecture.md)                                                                       |
| Database           | **PostgreSQL**                                           | SQLite, MongoDB                                | Reliable transactional store for both metadata and binary CRDT rows; one DB for everything. [ADR-0008](adr/0008-database.md)                                                                                       |

## Why localStorage is _not_ used for offline (called out because the spec demands it)

`localStorage` is rejected as the offline mechanism for concrete technical reasons, not
taste:

1. **Synchronous + main-thread** — blocks the UI; unusable for frequent writes while typing.
2. **~5 MB cap and string-only** — CRDT updates are binary; base64-ing them into a 5 MB
   string bucket does not scale to real documents or long offline sessions.
3. **No structured/indexed access** — you can only store the _latest_ value under a key,
   which nudges you straight into the anti-pattern the spec forbids: "save the latest HTML
   and overwrite on reconnect". That loses concurrent edits.

IndexedDB is async, effectively bounded by disk (hundreds of MB+), stores binary, and
`y-indexeddb` uses it to persist the **stream of CRDT updates** plus compacted state — so
a reconnecting client _merges_ rather than _overwrites_. This is the difference between
genuinely offline-capable and offline-theatre. See
[offline-sync.md](offline-sync.md).

## The unifying principle

Notice every row points the same way: pick the option that lets **one CRDT data model
(Yjs)** flow unchanged through editor ⇄ memory ⇄ local disk ⇄ wire ⇄ server DB. Each
alternative we rejected would have forced a _translation_ at one of those boundaries, and
every translation is a place where a merge can silently go wrong. Minimizing model
translations is how we maximize offline/merge correctness.
