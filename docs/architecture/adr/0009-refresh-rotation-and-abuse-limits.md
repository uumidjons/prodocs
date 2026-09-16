# ADR-0009 — Stateful refresh-token rotation & abuse limits

**Status:** Accepted (Phase 4) · **Decides:** how refresh tokens are secured and how the
server bounds abusive payloads/requests, within the single-instance MVP.

## Context

Through Phase 3 the refresh token was a **stateless JWT**: a valid signature was accepted
until natural expiry (~30 days). Consequences: a rotated token still worked, logout only
cleared the cookie (the token itself stayed valid), and a stolen refresh token could not be
revoked. `security.md` already _claimed_ "rotation + reuse detection", so this was also
documentation drift. Separately, the WebSocket accepted frames up to the `ws` default of
100 MiB, HTTP bodies used the implicit 1 MiB default, and only auth endpoints were
rate-limited.

## Decision

**1. Make refresh tokens stateful (rotation + reuse detection).** A `refresh_token` table
(migration 003) stores one row per issued token keyed by `jti`, grouped by a `family_id`
minted at login. On refresh, inside a single `SELECT … FOR UPDATE` transaction:

- unknown/expired `jti` → reject (401);
- fresh `jti` → mark consumed, issue a successor in the same family (rotation);
- already-consumed `jti` presented again **after a short grace window** → treat as theft,
  **delete the whole family** (revoke the session), 401;
- already-consumed `jti` **within** the grace window → benign concurrent refresh (two tabs /
  the WS token callback racing an API 401): issue a fresh sibling instead of revoking.

Logout revokes the family. A client-side single-flight mutex ensures the app itself never
fires concurrent refreshes, so the grace window is a safety net, not a routine path.

The grace window (`REFRESH_REUSE_GRACE_MS`, default 10 s) is configurable so tests can set it
to 0 and exercise reuse detection deterministically.

**2. Bound payloads and requests.** Global HTTP `bodyLimit` (`MAX_HTTP_BODY_BYTES`, 64 KiB);
per-frame WebSocket `maxPayload` (`MAX_WS_MESSAGE_BYTES`, 1 MiB); per-user document-creation
limit and a refresh limit added to the existing `@fastify/rate-limit` (in-memory); health
probes exempted. All limits are env-tunable; a single `RATE_LIMIT_MAX` override exists for
tests/ops.

## Alternatives considered

- **Keep stateless JWTs, shorten TTL.** Cheaper, but still no revocation and no reuse
  detection — fails the actual requirement.
- **Opaque random refresh tokens in the DB (no JWT).** Also valid; we kept the signed JWT
  (so the transport is unchanged) and layered state on top via `jti`, minimizing churn.
- **Redis for rotation state / rate limiting.** Rejected: the MVP is single-instance and the
  project explicitly excludes Redis. Postgres + in-memory limiter suffice; the seam to add a
  shared store later is clean.
- **Revoke on _any_ reuse with no grace.** Correct but punishes legitimate concurrent
  refreshes (multi-tab). The short grace + client single-flight resolves this safely.

## Consequences

- Refresh is now a DB transaction (one indexed row lock) — negligible cost, strong guarantee.
- Logout and reuse both kill the session; access tokens still expire independently (~15 min),
  bounding the window after revocation.
- Reuse detection, rotation, revocation, oversized-payload rejection, and rate limiting are
  covered by integration tests (`auth-security`, `auth-concurrency`, `rate-limit`,
  `ws-security`, `http-hardening`).
- **Single-instance limitation:** rotation grace and rate-limit counters live in one process;
  horizontal scaling would need a shared store. Documented in `security.md`.
