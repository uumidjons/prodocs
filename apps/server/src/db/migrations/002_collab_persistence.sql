-- Phase 2: collaborative document persistence.
-- Implements the hybrid model from docs/architecture/persistence.md and the
-- DOC_UPDATE / DOC_SNAPSHOT entities in docs/architecture/data-model.md:
--   * doc_update   — append-only log of binary Yjs updates (crash-safe, per change)
--   * doc_snapshot — one compacted full-state row per document (fast cold load)
-- Content is stored ONLY as Yjs binary (bytea); never HTML or ProseMirror JSON.

-- Append-only log of binary Yjs updates. Every update the collaboration server
-- receives is appended here in the change path, so a crash loses at most the
-- in-flight update (which the client's IndexedDB re-offers on reconnect).
CREATE TABLE doc_update (
  seq         BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  update      BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fetch a document's tail in order; also used to find the max folded seq.
CREATE INDEX doc_update_document_seq_idx ON doc_update(document_id, seq);

-- One compacted snapshot per document. `through_seq` records the last update seq
-- folded into `state`; cold load = apply(state) then replay updates with seq >
-- through_seq. Compaction (write snapshot + delete folded updates) runs in one
-- transaction so a crash mid-compaction never leaves a gap.
CREATE TABLE doc_snapshot (
  document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  state       BYTEA NOT NULL,
  through_seq BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
