# Scribe — Architecture Documentation

Scribe is a web-based collaborative rich-text document editor. It is _inspired by_ the
general idea of Google Docs but is not a clone: it has its own visual identity
("Editorial Precision", see [`../../UI/DESIGN.md`](../../UI/DESIGN.md)) and its own UX.

This directory contains the **architecture design produced before implementation**.
Nothing in the application has been built yet. The purpose of these documents is to be
reviewed and approved, and then to serve as the implementation contract.

## The problem in one sentence

Let two or more people edit the same rich-text document at the same time, keep editing
when the network drops, and merge everyone's changes back together afterwards **without
losing or duplicating anyone's work** — behind an original, systematic UI.

The hard part is **not** the text editor. It is **real-time collaboration + offline
editing + conflict-free merge**. The architecture is designed around that.

## Reading order

| #   | Document                                                                       | What it answers                                                                                                            |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | [system-overview.md](system-overview.md)                                       | What are the pieces and how do they fit together?                                                                          |
| 2   | [technical-decisions.md](technical-decisions.md)                               | What stack, and _why_ this stack? (summary of the ADRs)                                                                    |
| 3   | [realtime-collaboration.md](realtime-collaboration.md)                         | How do edits propagate live between clients?                                                                               |
| 4   | [offline-sync.md](offline-sync.md)                                             | How does offline editing and merge-on-reconnect work? (**the critical doc**)                                               |
| 4a  | [collaboration-correctness-contract.md](collaboration-correctness-contract.md) | The **invariants, forbidden patterns, guarantees, durability boundary, and correctness matrix** the sync layer must keep.  |
| 5   | [data-model.md](data-model.md)                                                 | What is stored, where, and what is ephemeral vs. durable?                                                                  |
| 6   | [persistence.md](persistence.md)                                               | How is CRDT document state persisted and recovered?                                                                        |
| 7   | [connection-states.md](connection-states.md)                                   | The sync state machine and what happens to edits in each state.                                                            |
| 8   | [security.md](security.md)                                                     | Auth, authorization, WS security, XSS/sanitization, abuse.                                                                 |
| 9   | [testing-strategy.md](testing-strategy.md)                                     | Unit / integration / e2e plan focused on the real requirements.                                                            |
| 10  | [project-structure.md](project-structure.md)                                   | Repository layout and why.                                                                                                 |
| 11  | [editor-formatting.md](editor-formatting.md)                                   | The editor document schema and per-feature semantics (storage, collaboration, offline, permissions, export).               |
| 12  | [media-and-comments.md](media-and-comments.md)                                 | Media attachments (object storage) and inline comments (Yjs anchor + thread map): architecture, security, offline, export. |
| —   | [adr/](adr/)                                                                   | Architectural Decision Records for each major choice.                                                                      |

## TL;DR of the recommended architecture

- **Editor:** Tiptap (on top of ProseMirror) — [ADR-0001](adr/0001-rich-text-editor.md)
- **CRDT:** Yjs — [ADR-0002](adr/0002-crdt-technology.md)
- **Transport:** WebSocket via the Hocuspocus provider/server — [ADR-0003](adr/0003-realtime-transport.md)
- **Offline persistence:** IndexedDB via `y-indexeddb` — [ADR-0004](adr/0004-offline-persistence.md)
- **Server persistence:** Postgres storing binary Yjs updates (append log) + periodic snapshots — [ADR-0005](adr/0005-server-persistence.md)
- **Backend:** Node.js + TypeScript, Fastify (HTTP) + Hocuspocus (WS), modular monolith — [ADR-0006](adr/0006-backend-framework.md)
- **Frontend:** React + TypeScript + Vite, Zustand for local UI state (no Redux) — [ADR-0007](adr/0007-frontend-architecture.md)
- **Database:** PostgreSQL — [ADR-0008](adr/0008-database.md)
- **Infra:** Docker Compose; reverse proxy → (static frontend | Fastify+WS) → Postgres.

The one deliberately unconventional call: **the same CRDT engine (Yjs) is the single
source of truth on the client, across the wire, in the browser's offline store, and in
the server database.** One data model end-to-end is what makes offline merge correct
instead of "best effort". Everything else follows from that decision.

## Status of the UI reference

A visual source of truth **exists** in the repository:
`UI/DESIGN.md` (design tokens + system) and `UI/screen.png` (rendered concept, product
name **"Scribe"**), plus a static `UI/code.html` mockup. The frontend must reproduce this
faithfully. No visual details were invented in these docs; where a screen is not shown in
the reference it is called out as an assumption.

## Assumptions (called out explicitly)

These are things the assignment does not fully specify. We chose a default and flagged it
rather than pretending it was given.

- **A1 — Single workspace, flat document list.** The UI shows workspace/folders; for MVP
  we model one implicit workspace per user and a flat list of documents. Multi-workspace
  is a future feature.
- **A2 — Sharing model is link + explicit grants, roles `owner`/`editor`/`viewer`.**
  The UI has a "Share" action; MVP implements owner + invited editors. Fine-grained ACLs
  are future.
- **A3 — Auth is email + password with JWT.** No third-party SSO for MVP.
- **A4 — "Almost immediately" ≈ sub-200ms perceived on a healthy LAN/broadband**; local
  keystrokes are always instant (applied to the local CRDT first).
- **A5 — Comments, version history, templates, export, media** appear in the UI concept
  but are **explicitly out of MVP scope** (see below). The data model leaves room for them
  but does not implement them.

## MVP boundary

**In:** rich-text editing (bold, italic, headings, bullet + numbered lists), document
create/load/persist, real-time multi-user sync, presence (names + colors), remote
cursors/selections, offline editing with local persistence, reconnect + conflict-free
merge, the original UI, README, this architecture set, a demo video.

**Out (future):** comments, advanced sharing/permissions, version history, templates,
export, advanced search, notifications, rich media, audio "Huddle", advanced formatting,
analytics. These may appear in the UI concept; that does not make them MVP.
