-- Phase 4: refresh-token rotation + reuse detection.
--
-- Until now the refresh token was a stateless JWT: a valid signature was accepted
-- until natural expiry, so a rotated or logged-out token still worked and a stolen
-- token could not be revoked. This table makes refresh tokens *stateful* so we can:
--   * rotate on every use (each refresh issues a new jti and consumes the old one),
--   * detect reuse of an already-consumed token, and
--   * revoke an entire token "family" (the whole login session) on reuse or logout.
--
-- One row per issued refresh token, keyed by the token's `jti`. `family_id` ties
-- every token descended from a single login together, so revoking the family kills
-- the session. `used_at` marks a token as consumed by a rotation; presenting a
-- consumed token again (outside a short concurrency grace window) is treated as
-- theft and revokes the family. Rows are removed on logout, on family revoke, and
-- opportunistically once expired.
CREATE TABLE refresh_token (
  jti        UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id  UUID NOT NULL,
  used_at    TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_token_family_idx ON refresh_token(family_id);
CREATE INDEX refresh_token_user_idx ON refresh_token(user_id);
CREATE INDEX refresh_token_expires_idx ON refresh_token(expires_at);
