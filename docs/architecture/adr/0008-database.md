# ADR-0008 — Database: PostgreSQL

**Status:** Accepted

## Context

We need one durable store for two kinds of data: **relational metadata** (users, documents,
memberships) and **binary CRDT state** (update log + snapshots, [ADR-0005](0005-server-persistence.md)).
It must be transactional (compaction must be atomic), reliable, and simple to run in Docker
for the assignment.

## Decision

Use **PostgreSQL** for everything.

## Alternatives considered

- **SQLite (embedded)** — the spec permits an embedded DB and it's tempting for simplicity.
  But concurrent writers (the WS receive path appending updates while HTTP serves metadata)
  and running as a shared server for multiple app instances/tests are cleaner on Postgres.
  SQLite is a fine fallback if we needed zero infra, but Postgres better reflects a
  production choice and handles `bytea` + concurrency comfortably.
- **MongoDB** — document store, but we have clear relational entities (memberships/roles)
  where referential integrity and transactions matter; the CRDT bytes don't benefit from a
  document DB. Two paradigms, no gain.
- **A separate KV store for CRDT + SQL for metadata** — two datastores to run, back up, and
  keep consistent; loses cross-cutting transactions (e.g. atomic compaction). One database
  wins.

## Why Postgres

- **Transactions** make compaction atomic (write new snapshot + delete folded updates in
  one tx) — a correctness requirement, not a nicety.
- **`bytea`** stores binary Yjs updates/snapshots natively; **`bigserial`** gives the
  monotonic `seq` the log needs.
- **One store** for metadata and content → simpler ops, one backup (`pg_dump` backs up the
  documents too), one connection pool.
- Ubiquitous, reliable, trivial to run via Docker Compose, great tooling and testing story
  (ephemeral containers in CI).

## Trace-offs

- Requires running a DB server (vs. embedded SQLite) — trivial with Docker Compose and
  justified by concurrency + transactional compaction.
- Binary content isn't SQL-queryable as text — intentional; the CRDT is the source of
  truth, metadata columns cover listing/search needs.

## Consequences

- Schema per [../data-model.md](../data-model.md); persistence per
  [../persistence.md](../persistence.md).
- Scaling seam: read replicas / pooling if ever needed (out of MVP).
