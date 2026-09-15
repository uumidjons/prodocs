# ADR-0003 — Real-Time Transport: WebSocket via Hocuspocus

**Status:** Accepted

## Context

We need to move Yjs updates + awareness between clients and the server in near real time,
handle join/disconnect/reconnect, authenticate connections, and hook persistence. The
choice must fit Yjs and keep bespoke networking/merge code minimal.

## Decision

Use **WebSocket** as the transport, via the **Hocuspocus** provider (client) and server —
a production Yjs sync server that wraps the `y-websocket` protocol with lifecycle hooks.

## Alternatives considered

- **Raw `y-websocket`** — the canonical minimal Yjs WS provider/server. Great, but the
  reference server is intentionally bare: auth and persistence are DIY. We'd rebuild what
  Hocuspocus already provides (`onAuthenticate`, `onLoadDocument`, `onStoreDocument`,
  awareness, hooks), adding bespoke code exactly where correctness matters most.
- **WebRTC (`y-webrtc`)** — peer-to-peer, low server cost, but: needs signaling +
  TURN/STUN, presence/persistence become awkward, NAT traversal is unreliable, and there's
  no natural central authority for **server-side persistence and access control**. Wrong
  fit for a document store with auth. (Noted as a possible future enhancement for ad-hoc
  low-latency peer links, not the primary path.)
- **Custom WebSocket protocol** — maximum control, but reinventing the Yjs sync protocol is
  effort with downside and no requirement behind it.
- **SSE / long-polling** — one-directional / higher latency; poor fit for bidirectional
  low-latency editing.

## Why Hocuspocus over raw y-websocket

- **Auth + access control hooks** (`onAuthenticate`) let us verify the JWT and membership
  before any update is accepted — the exact WS-security requirement
  (see [../security.md](../security.md)).
- **Persistence hooks** (`onLoadDocument`/`onStoreDocument`) are the clean seam for the
  Postgres update-log + snapshot strategy ([ADR-0005](0005-server-persistence.md)).
- **Awareness, multiplexing multiple docs over one socket, and reconnection** are handled.
- Extension point for **Redis pub/sub** later if we ever scale to multiple instances,
  without changing the client.

## Trade-offs

- A framework dependency (vs. hand-rolled) — accepted; it is Yjs-focused and thin.
- Node-only server — consistent with [ADR-0006](0006-backend-framework.md); it constrains
  the backend language, which we already chose as Node/TS for exactly this reason.

## Consequences

- The connection/join/sync/reconnect/restart flows in
  [../realtime-collaboration.md](../realtime-collaboration.md) and
  [../connection-states.md](../connection-states.md) are implemented against the provider's
  events and the server's hooks.
- No custom transform/merge code on the server — it authenticates, fans out, and persists.
