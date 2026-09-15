# Security

Scope: a minimal but genuinely secure design. No enterprise IAM, no security theatre — only
controls that matter for a collaborative editor. Each control below maps to a real threat.

## Authentication

- **Method:** email + password (Argon2id hashing). Assumption A3; no third-party SSO in MVP.
- **Tokens:** short-lived **JWT access token** (~15 min) held in memory + a long-lived
  **refresh token** in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. Access tokens are not
  in localStorage (XSS-exfiltration risk); the refresh cookie is not readable by JS.
- **Refresh:** the refresh token is **stateful** (a `refresh_token` row per issued token,
  keyed by `jti`, grouped into a `family_id` per login). Each refresh **rotates** the token
  (consumes the old `jti`, issues a new one) and returns a new access token. Presenting an
  already-consumed token (outside a short concurrency grace window) is treated as theft and
  **revokes the whole family** (session). Logout revokes the family too, so a captured token
  is dead after logout — not merely "cookie cleared". See
  [ADR-0009](adr/0009-refresh-rotation-and-abuse-limits.md).

## Authorization & document access

- The **`membership` table is the single source of truth** for who may open a document and
  in what role (`owner`/`editor`/`viewer`).
- Enforced in two places, both server-side:
  - **REST:** every `/api/documents/:id*` route checks membership before returning metadata.
  - **WebSocket:** `onAuthenticate` verifies the JWT _and_ looks up membership for the
    requested document id; no membership → connection closed (`4403`). A `viewer` connects
    read-only (server rejects inbound updates from viewers).
- **Least privilege:** a valid token for user X grants nothing on documents X isn't a member
  of.

### Sharing / membership API (Phase 5)

Sharing is an authorization-critical feature and is enforced entirely server-side against the
same `memberships` table — the frontend never supplies a trusted role.

- **Endpoints:** `GET/POST /api/documents/:id/members`, `PATCH/DELETE
/api/documents/:id/members/:userId` (see [system-overview.md](system-overview.md) and
  [ADR-0010](adr/0010-sharing-membership-api.md)).
- **Who may do what:** any member may **list** members (needed to render the Share dialog);
  only the **owner** may add / change-role / remove. A non-member gets `404` (existence hidden,
  matching REST 404-on-forbidden); a non-owner member gets `403`. A user can therefore never
  grant themselves access, and an editor/viewer can never modify sharing.
- **Owner invariant:** the document owner (`documents.owner_id`) always keeps an `owner`
  membership — their role is never changed and they are never removed via the API, and roles
  are only ever **assigned** as `editor`/`viewer` (ownership is not transferable in the MVP,
  so `owner` is not an assignable role). Duplicate adds return `409` (never a silent overwrite).
- **IDOR / input validation:** the document id and target user id are validated as UUIDs (a
  malformed id is a `400`, never a DB error) and no body carries a document id, so a request
  can only ever address the caller's authorized document. The role is validated against the
  shared enum, and a non-existent (well-formed) user id is a `404`.
- **User search** (`GET /api/users/search?q=`): authenticated-only, returns just public
  identity fields (id, email, displayName, color) — never hashes/tokens — with a minimum query
  length and a capped result set to blunt mass enumeration.

## WebSocket authentication

- Token is passed on connect (query param over `wss://`, or first-message auth). Verified in
  `onAuthenticate` _before_ the doc is loaded or any update is accepted.
- Authorization is re-checked on connect, so revoking a membership takes effect on the next
  (re)connection; long-lived sockets can be force-closed on revocation as an enhancement.
- All WS traffic is over `wss://` (TLS terminated at the reverse proxy).

## Document access enumeration

- Document ids are **UUIDv4** (unguessable), and access failures return **`404`, not `403`**,
  on REST so an attacker can't distinguish "exists but forbidden" from "doesn't exist".
- No endpoint lists documents you aren't a member of.

## Input validation & malformed collaborative updates

- **CRDT frames are opaque and bounded.** Yjs updates are never inspected at the application
  level (they stay CRDT operations); Hocuspocus decodes them internally, and a frame that
  exceeds the size cap is rejected by `ws` (1009 close) before it reaches Hocuspocus or
  persistence — so a garbage/oversized frame can't crash the server or corrupt the doc.
- **Size limits:** per-frame WebSocket cap (`MAX_WS_MESSAGE_BYTES`) and HTTP body cap
  (`MAX_HTTP_BODY_BYTES`). A whole-document size cap is **not** enforced (deferred).
- **REST bodies** validated against shared zod schemas — email format, password length,
  title length, UUID document ids (invalid id → 400, never a DB error).

## XSS & rich-text sanitization

- The editor's schema is a **strict allow-list** (paragraph, heading, list, bold, italic).
  ProseMirror does not execute arbitrary HTML — content is a structured document, not an
  HTML string, so the classic "paste `<script>`" vector doesn't apply on the editing path.
- **Paste** is filtered through the schema (unknown nodes/marks/attrs, `javascript:` URLs,
  event handlers stripped).
- **Links** are user-controlled `href`s, so they pass a shared fail-closed allow-list
  (`packages/shared/src/linkPolicy.ts`): only `http`/`https`/`mailto`/`tel` are permitted;
  `javascript:`/`data:`/`vbscript:`/`file:` (including whitespace-obfuscated variants) are
  rejected. The allow-list is enforced both on `setLink` (toolbar popover) and via the
  Tiptap `Link` extension's `isAllowedUri` (covering pasted HTML), and links render with
  `rel="noopener noreferrer nofollow"`. See
  [ADR 0011](adr/0011-link-safety-policy.md) and
  [editor-formatting.md](editor-formatting.md).
- If content is ever rendered outside the editor (e.g. a future export/preview), it is
  sanitized (DOMPurify) — never `innerHTML` of raw content. React escapes by default. The
  PDF/DOCX exporters emit text via typed generators (pdf-lib / docx), not HTML, and drop
  unsafe link hrefs.

## Media uploads (attachments)

Uploaded images are untrusted binary input (ADR 0012). Controls:

- **Authenticated + authorized.** Upload requires a valid access token and **editor/owner**
  membership on the document; a viewer is rejected (403) and a non-member is 404 (access
  enumeration parity). Serving requires membership on the document.
- **Content-based type validation.** The server **sniffs the actual bytes** (magic
  numbers) and accepts only PNG/JPEG/WebP; the client-declared MIME is ignored. HTML, SVG
  (script-bearing), and executables are rejected. An independent size cap
  (`MEDIA_MAX_BYTES`, default 5 MiB) is enforced server-side.
- **Safe storage identity.** The stored object key is a server-generated **UUID**, never
  the user filename and never a path; the filesystem store verifies the resolved path stays
  within the media root (no traversal). The document references a stable `mediaId`, not a
  path.
- **No public exposure.** There are no public or signed URLs. Media is served only through
  the authenticated, membership-checked endpoint with `Content-Disposition: inline`,
  `X-Content-Type-Options: nosniff`, and a private cache. A forged `mediaId`, or a real id
  requested under the wrong document, returns 404 — private-document media cannot be
  retrieved by guessing ids.
- **Export** fetches only the current document's authorized media via that endpoint —
  never arbitrary URLs.

## Inline comments

Comments (ADR 0013) live in the collaborative Y.Doc (a `comment` mark + a comments
`Y.Map`). Their mutation boundary is the **same** as the document's: a viewer's
collaboration connection is read-only, so Hocuspocus rejects any comment write from a
viewer — the UI's disabled state is convenience, not the security boundary. Comment text
is never rendered into normal PDF/DOCX export.

## CSRF

- State-changing REST uses the `Authorization: Bearer` header (not ambient cookies), which
  is not auto-attached cross-site, so CSRF is largely mitigated. The refresh cookie is
  `SameSite=Lax` and the refresh endpoint additionally checks `Origin`.

## CORS

- API allows only the known frontend origin(s) via an explicit allow-list; credentials mode
  configured to match the cookie strategy. No wildcard with credentials.

## Rate limiting & abuse

- **Auth endpoints:** per-IP fixed-window limits via `@fastify/rate-limit` (in-memory) —
  login/register 10/min, refresh 60/min — to blunt brute force / credential stuffing.
- **Document creation:** per-**user** limit (30/min), keyed by the Bearer token's subject.
- **HTTP body size:** capped globally (`MAX_HTTP_BODY_BYTES`, default 64 KiB); over-limit
  bodies are rejected with 413 before a handler runs.
- **WS message size:** each frame is capped (`MAX_WS_MESSAGE_BYTES`, default 1 MiB) at the
  `ws` transport layer; an oversized frame closes the socket (1009) without reaching
  Hocuspocus or persistence.
- **Health/readiness probes are exempt** from rate limiting so infrastructure polling can't
  trip the limiter and flap the container.
- Not implemented (documented, not implied): per-connection WS message-rate/connection-count
  caps and login lockout backoff. Yjs updates stay opaque — no application-level inspection
  of CRDT binary.

## Secrets & sensitive data

- All secrets (JWT signing keys, DB URL, cookie secret) come from **environment variables**,
  never committed; a `.env.example` documents the shape. Distinct keys per environment.
- Passwords only ever stored as Argon2id hashes. No sensitive data in logs (tokens/bodies
  redacted). TLS everywhere in transit.

## Threat → control summary

| Threat                            | Control                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| Stolen token via XSS              | Access token in memory; refresh token httpOnly; strict editor schema  |
| Unauthorized doc access           | Membership check on REST + WS; 404 on forbidden; UUID ids             |
| Unauthorized sharing change       | Owner-only membership mutations; 404 non-member / 403 non-owner       |
| Self-grant / privilege escalation | No document id in any body; owner invariant; assignable roles only    |
| User enumeration via search       | Auth-only, min query length, capped results, public fields only       |
| Doc enumeration                   | UUIDv4 + non-distinguishing 404                                       |
| Malformed/oversized CRDT frame    | Size cap → 1009 close before Hocuspocus/persistence                   |
| Brute force login                 | Per-IP fixed-window rate limiting + Argon2id                          |
| WS oversized payload              | Per-frame `maxPayload` cap (1009). (No per-connection rate/count cap) |
| CSRF                              | Bearer-header auth + SameSite cookie + Origin check                   |
| Secret leakage                    | Env vars, `.env.example`, no secrets in logs/repo                     |
| Refresh-token theft               | Rotation + reuse detection → family revoke; logout revokes session    |
| Oversized HTTP/WS payload         | 413 on HTTP body > cap; ws frame > cap → 1009 close, no persist       |

## Implementation status (Phase 4)

Phase 4 hardened the above; this records exactly what is and isn't implemented so the
document does not over-claim.

**Implemented:** stateful refresh-token rotation + reuse detection + family/session revoke
(`refresh_token` table, migration 003); logout revokes the family; Origin allow-list check on
`/api/auth/refresh` in production (defense-in-depth atop `SameSite=Lax`); HTTP body cap (413);
per-frame WebSocket size cap (1009); per-IP auth/refresh limits and per-user document-creation
limit (in-memory `@fastify/rate-limit`); health probes exempt from limiting; structured,
secret-free security events (`observability/events.ts`: `auth.login.failed`,
`auth.refresh.reuse_detected`, `ws.auth.failed`, `ws.payload.too_large`, `ratelimit.exceeded`,
`persistence.failure`, …); client single-flight refresh (no self-inflicted concurrent refresh).

**Deliberate limitations (single-instance MVP):**

- The rate limiter and refresh-session grace are **in-memory / single-process**. Horizontal
  scaling would need a shared store (e.g. Redis) — intentionally out of scope (no Redis in MVP).
- No per-connection WS message-rate or connection-count caps, and no login lockout backoff
  (frame-size cap + fixed-window limits are the MVP defense).
- No DOMPurify pipeline: content is a strict-schema ProseMirror document rendered by React
  (escaped), never raw HTML, so there is no HTML-injection surface to sanitize today. If
  content is ever rendered as HTML outside the editor, sanitization must be added there.
- Membership revocation takes effect on the next WS (re)connect; long-lived sockets are not
  force-closed on revoke.

## Implementation status (Phase 5 — sharing)

Phase 5 added the user-facing sharing flow **without** weakening any existing boundary and
**without** new infrastructure (no Redis, no new service, no CRDT change).

**Implemented:** the membership API above (list/add/change-role/remove) and user search, all
authorized server-side against the existing `memberships` table; the Share dialog UI (owner
manages; non-owners see a read-only roster); dashboard grouping into owned vs. shared. Backed
by a real-Postgres integration suite (`test/integration/sharing.test.ts`: owner authz, editor
& viewer denial, non-member denial, cross-document IDOR, invalid id/role, duplicate handling,
owner invariant, user search) and a multi-context Playwright flow (`e2e/sharing.spec.ts`:
share → collaborate → change role → remove → new session denied).

**Revocation behavior (unchanged from Phase 4, restated honestly):** removing a member or
downgrading their role is enforced **immediately over REST** (the next `GET /api/documents/:id`
returns `404`/reflects the new role). For live collaboration it applies on the next WebSocket
**(re)connect** — `onAuthenticate` re-checks membership on every connect, so a new session for a
removed user is rejected. An already-open socket is **not** force-closed; the UI handles the
authorization error cleanly on reload. Force-closing live sockets on revoke would require a
socket registry keyed by document/user and is intentionally deferred (no new coordination
infrastructure in the single-instance MVP).
