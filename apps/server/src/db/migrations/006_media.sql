-- Phase (media & comments): media attachment metadata.
-- ADDITIVE ONLY. No existing table or document content is modified. The binary bytes
-- live in object storage (ADR 0012); this table holds ONLY the metadata + the opaque
-- storage_key that points at the object. The document references a row by `id`
-- (the media node's `mediaId`); the binary is never stored here.

CREATE TABLE media (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  uploaded_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Opaque, server-generated object key (a UUID) — never a user filename or path.
  storage_key       TEXT NOT NULL UNIQUE,
  -- Server-sniffed MIME (content-derived, never the client's claim).
  mime_type         TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size         BIGINT NOT NULL,
  -- Original filename retained for display/download only; NEVER used as a path.
  original_filename TEXT,
  width             INTEGER,
  height            INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reserved for a future orphan-GC lifecycle; unused by the MVP serve/upload paths.
  deleted_at        TIMESTAMPTZ
);

-- Serving looks up by (document_id, id): membership is checked on document_id, and the
-- row must belong to that document (so a media id from another document 404s).
CREATE INDEX media_document_id_idx ON media(document_id);
