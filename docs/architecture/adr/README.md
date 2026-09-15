# Architectural Decision Records

Each ADR captures one significant decision: **Context · Decision · Alternatives · Why ·
Trade-offs · Consequences**. Decisions are argued on requirement-fit, not popularity.

| ADR                                               | Decision                                                   | Status   |
| ------------------------------------------------- | ---------------------------------------------------------- | -------- |
| [0001](0001-rich-text-editor.md)                  | Rich-text editor: **Tiptap / ProseMirror**                 | Accepted |
| [0002](0002-crdt-technology.md)                   | CRDT engine: **Yjs**                                       | Accepted |
| [0003](0003-realtime-transport.md)                | Transport: **WebSocket via Hocuspocus**                    | Accepted |
| [0004](0004-offline-persistence.md)               | Offline store: **IndexedDB (`y-indexeddb`)**               | Accepted |
| [0005](0005-server-persistence.md)                | Server persistence: **update log + snapshots in Postgres** | Accepted |
| [0006](0006-backend-framework.md)                 | Backend: **Node + TS, Fastify + Hocuspocus, monolith**     | Accepted |
| [0007](0007-frontend-architecture.md)             | Frontend: **React + TS + Vite + Zustand**                  | Accepted |
| [0008](0008-database.md)                          | Database: **PostgreSQL**                                   | Accepted |
| [0009](0009-refresh-rotation-and-abuse-limits.md) | Refresh-token rotation + reuse detection & abuse limits    | Accepted |
| [0010](0010-sharing-membership-api.md)            | User-facing sharing via a server-side membership API       | Accepted |
| [0011](0011-link-safety-policy.md)                | Hyperlink safety allow-list & formatting schema additions  | Accepted |
| [0012](0012-media-storage.md)                     | Media attachments: object storage, schema node & serving   | Accepted |
| [0013](0013-inline-comments.md)                   | Inline comments: Yjs anchor mark + thread map              | Accepted |
