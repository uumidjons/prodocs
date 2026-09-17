-- Phase 11: Trash (soft delete) + Recent (per-user last-opened).
--
-- Both are ADDITIVE and non-destructive — no existing column is rewritten and no
-- data is dropped, so the migration can be applied to the existing development
-- database without resetting it.
--
--   * documents.deleted_at        — soft-delete marker. NULL = live document; a
--                                    timestamp = "in Trash". A soft-deleted document
--                                    is excluded from every normal listing and from
--                                    access (open/edit/collab), but its content and
--                                    memberships are preserved so it can be restored.
--   * memberships.last_opened_at  — per-user "recently interacted" timestamp. It lives
--                                    on the MEMBERSHIP (not the document) so Recent is
--                                    scoped to the current user: opening a shared
--                                    document marks it recent for that user only, never
--                                    globally. Templates carry no membership, so they
--                                    can never enter anyone's Recent.
ALTER TABLE documents ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE memberships ADD COLUMN last_opened_at TIMESTAMPTZ;

-- Fast listing of a user's live (non-trashed) documents.
CREATE INDEX documents_deleted_at_idx ON documents(deleted_at);
-- Fast "Recent" ordering per user (only rows the user has actually opened).
CREATE INDEX memberships_last_opened_idx
  ON memberships(user_id, last_opened_at DESC)
  WHERE last_opened_at IS NOT NULL;
