# ADR-0010 — User-facing sharing via a server-side membership API

**Status:** Accepted (Phase 5) · **Decides:** how documents are shared between registered
users, within the single-instance MVP and without changing the CRDT/transport architecture.

## Context

Through Phase 4 the `memberships` table was already the single source of truth for document
access (checked on both REST and WebSocket connect), but there was **no product surface** to
manage it: demos granted access by inserting rows with `psql`, and the header "Share" button
was a placeholder. The remaining product-level gap was a real sharing flow — owners adding
registered users, choosing roles, changing and revoking access — without introducing
invitations, email delivery, public links, anonymous access, or any new infrastructure.

## Decision

**1. Expose membership as a REST API nested under the document, authorized server-side.**
A new `modules/memberships` module adds:

- `GET /api/documents/:id/members` — any member may list.
- `POST /api/documents/:id/members` `{ userId, role }` — owner only.
- `PATCH /api/documents/:id/members/:userId` `{ role }` — owner only.
- `DELETE /api/documents/:id/members/:userId` — owner only.

Every operation reuses the **existing** authorization primitive (`getDocumentForUser` → the
caller's role) — no duplicate access logic. Non-members get `404` (existence hidden, matching
REST 404-on-forbidden); non-owner members get `403`.

**2. Constrain roles and preserve the owner invariant.** Assignable roles are `editor` and
`viewer` only (a shared `assignableRoleSchema`); `owner` is never granted, changed, or removed
via the API, so the document owner (`documents.owner_id`) always keeps their `owner`
membership. Ownership transfer is out of MVP scope. Duplicate adds return `409`.

**3. Add a minimal user-search endpoint.** `GET /api/users/search?q=` (authenticated) returns
only public identity fields (id, email, displayName, color), with a minimum query length and a
capped result set to blunt mass enumeration. It is the least surface the "add member" control
needs.

**4. Build the Share UI as a dialog on the existing design system.** A Level-4 modal
(`features/sharing/ShareDialog.tsx`) shows current members + roles, marks the owner, and — for
the owner only — allows search-and-add, role change, and removal. Non-owners see a read-only
roster. The header's existing Share button opens it when a document is active.

## Alternatives considered

- **Email/link invitations.** Rejected: needs email delivery + tokened link tables +
  anonymous access — explicitly out of MVP scope and a much larger attack surface.
- **A separate "sharing service" or permission engine.** Rejected: violates the modular-
  monolith decision (ADR-0006); membership is a table, not a service.
- **Ownership transfer / multiple owners.** Deferred: adds invariant complexity (who guarantees
  ≥1 owner) with no assignment requirement behind it.
- **Force-closing live sockets on revoke.** Deferred: would need a socket registry keyed by
  document/user; the existing "revocation applies on next (re)connect" behavior is correct and
  documented, and REST access is revoked immediately.

## Trade-offs / consequences

- **Revocation is immediate over REST, next-connect over live WS** (unchanged from Phase 4).
  An already-open editor keeps its socket until it reconnects/reloads; the UI handles the
  resulting authorization error cleanly. Honest, not instantaneous.
- **Sharing requires the target to be a registered user** and an online connection for the
  mutation — document _content_ remains offline-first; only the sharing metadata call needs
  the network.
- The `memberships` schema is unchanged — no migration was required. Yjs remains the sole
  conflict-resolution mechanism; no LWW, no custom merge, no whole-document replacement, no
  Redis, no new service.
