# ADR-0005 — Server Persistence: Update Log + Snapshots in Postgres

**Status:** Accepted

## Context

The server must persist collaborative documents so they survive restarts, load quickly,
recover consistently, and don't grow without bound. A CRDT document is a set of binary
updates, not a row of HTML. See [../persistence.md](../persistence.md) for the full
mechanism; this ADR records the decision.

## Decision

Store, per document, an **append-only log of binary Yjs updates** (`doc_update`) plus a
**periodically compacted snapshot** (`doc_snapshot`) of the full encoded `Y.Doc`, in
**PostgreSQL** ([ADR-0008](0008-database.md)). Cold load = snapshot + replay of updates
newer than the snapshot's `through_seq`.

## Alternatives considered

- **Single blob, rewritten on save** — simplest, but write amplification and a real risk of
  dropping concurrent updates in a save race; no crash-safety between saves.
- **Updates-only, forever** — never loses data, but cold load replays all history (slow)
  and storage grows unbounded.
- **Snapshot-only, periodic** — fast load, bounded, but loses updates since the last
  snapshot on a crash.
- **External Yjs stores (y-leveldb, etc.)** — introduces a second datastore alongside
  Postgres (which we need anyway for users/docs/memberships). One database is simpler and
  transactional.

## Why the hybrid

- **No update loss** (append every update in the receive path) **and** **fast cold load**
  (snapshot + short tail) **and** **bounded storage** (truncate folded updates on
  compaction) — it is the only option that satisfies all three graded concerns at once.
- **One database** for metadata _and_ content; compaction is a single transaction, so a
  crash mid-compaction never leaves a gap.
- Plugs directly into Hocuspocus's `onLoadDocument`/`onStoreDocument`
  ([ADR-0003](0003-realtime-transport.md)).

## Trade-offs

- Compaction is extra code vs. a naive blob — a small, well-understood scheduled task, not
  a service.
- Storing `bytea` means content isn't queryable as text in SQL — acceptable; the CRDT is
  the source of truth and title/metadata are mirrored to columns for listing.

## Consequences

- Server restart recovery, storage growth, and consistency are handled as described in
  [../persistence.md](../persistence.md).
- Snapshots also lay the groundwork for a future version-history feature (not in MVP).
