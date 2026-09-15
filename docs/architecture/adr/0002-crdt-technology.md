# ADR-0002 — CRDT Engine: Yjs

**Status:** Accepted · **Decides:** the conflict-free sync engine (the project's core)

## Context

The three graded requirements — real-time collaboration, offline editing, conflict-free
merge — all rest on the conflict-resolution engine. The spec says use a mature CRDT/OT
library, not a hand-rolled algorithm. The engine's data model must flow through editor,
browser memory, offline storage, the wire, and the server DB with minimal translation
(each translation is a merge-bug risk). We need: a rich-text-capable shared type, offline
local persistence, presence/awareness, remote cursors, and an editor binding.

## Decision

Use **Yjs** as the single CRDT engine on client and server.

## Alternatives considered

- **Automerge** — excellent CRDT with a clean document/JSON model and strong history. But:
  historically heavier updates and larger memory/perf footprint for large text; the
  rich-text editor bindings, awareness, and IndexedDB providers are less mature/complete
  than Yjs's. The surrounding ecosystem is the deciding factor.
- **ShareDB (OT, not CRDT)** — mature and proven (used in production editors). But it is
  **operational transformation**, which requires a central server to transform ops and is
  weaker for _offline_ editing (long-divergence OT is hard and is where lost/duplicated
  edits creep in). The spec's heaviest scrutiny is offline merge — CRDT is the safer fit.
- **Hand-rolled CRDT/OT** — explicitly discouraged by the spec and not a plus.

## Why Yjs

- **Purpose-built rich-text type** (`Y.XmlFragment`/`Y.Text`) with efficient, tiny binary
  updates — ideal for per-keystroke sync without sending HTML.
- **The whole stack exists and interoperates:** `y-prosemirror` (editor binding + cursors),
  `y-indexeddb` (offline), `y-websocket`/Hocuspocus (transport), and **awareness**
  (presence) are all first-party or standard. This is the "one model, four locations"
  property that makes the offline/merge story robust — see
  [../system-overview.md](../system-overview.md).
- **Offline is native.** Updates are commutative + idempotent; a client can diverge for
  hours and merge via a state-vector diff. This directly answers Scenarios B–F.
- **No server transform.** The server stores/forwards bytes, minimizing server-side logic
  and failure surface.
- Mature, widely deployed, actively maintained.

## Trade-offs

- Yjs documents are binary CRDT structures, not human-readable rows — persistence and
  debugging need CRDT-aware tooling (addressed in [../persistence.md](../persistence.md)).
- CRDT metadata grows with edit history; mitigated by compaction/snapshots.
- Tombstones from deletions add overhead; acceptable and standard, bounded by compaction.

## Consequences

- The data model, transport, offline store, and DB schema are all organized around Yjs
  updates (drives ADR-0003/0004/0005).
- Presence is modeled via Awareness and kept strictly ephemeral (see
  [../data-model.md](../data-model.md)).
- We never keep a parsed relational copy of content in sync with the CRDT.
