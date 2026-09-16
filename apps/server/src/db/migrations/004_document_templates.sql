-- Phase 10: system templates.
--
-- Distinguishes a SYSTEM TEMPLATE (a product-provided source document) from a
-- normal user document, so that:
--   * normal user documents NEVER appear as templates, and
--   * a user's document list can exclude templates cleanly.
--
-- A single additive boolean is sufficient — templates otherwise reuse the exact
-- same `documents` + persistence (doc_snapshot / doc_update) machinery as any
-- document, so there is no need for a separate table. System templates are owned by
-- a dedicated system user (seeded at startup) and carry no user memberships, so the
-- existing membership-based access rules already keep them out of every user's
-- Documents list and sharing UI; this column makes the distinction explicit and
-- query-friendly.
ALTER TABLE documents ADD COLUMN is_template BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup/listing of the (few) templates.
CREATE INDEX documents_is_template_idx ON documents(is_template) WHERE is_template = true;
