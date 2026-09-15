import type { Hocuspocus } from '@hocuspocus/server';
import { PERMISSION_CHANGED_CLOSE_CODE } from '@scribe/shared';

/**
 * Process-local handle to the live collaboration server, so HTTP request handlers
 * (which run in the SAME process — modular monolith, no second service, no Redis)
 * can act on live WebSocket connections. Registered by attach.ts when the socket
 * server is created and cleared on shutdown.
 *
 * This exists for exactly one reason: membership changes are authoritative on the
 * server, and an ALREADY-OPEN collaboration socket authenticated its role once at
 * connect time (server.ts → onAuthenticate). When the owner changes or revokes a
 * collaborator's role over REST, we must re-evaluate that socket's authorization
 * rather than let it keep the stale (possibly now-elevated) permission.
 */
let hocuspocus: Hocuspocus | null = null;

export function registerCollabServer(instance: Hocuspocus): void {
  hocuspocus = instance;
}

export function unregisterCollabServer(): void {
  hocuspocus = null;
}

/**
 * WebSocket close code sent when a user's permission on a document changed. It is a
 * deliberately NON-terminal code (not 4401 Unauthorized / 4403 Forbidden), so the
 * Hocuspocus provider treats it as an ordinary drop and RECONNECTS. On that
 * reconnect the server's onAuthenticate hook runs again and re-derives the socket's
 * role + read-only flag from the current membership row — closing any authorization
 * gap. Content is preserved: reconnect resyncs via the Yjs state-vector handshake,
 * never a document replacement.
 */
export const PERMISSION_CHANGED_CLOSE = {
  code: PERMISSION_CHANGED_CLOSE_CODE,
  reason: 'permission-changed',
} as const;

/**
 * Force every live collaboration socket that `userId` holds on `documentName` to
 * drop and reconnect, so its authorization is re-evaluated against the current
 * membership. Safe to call when the collab server is not registered (tests that
 * never open a socket) or when the user has no live connection (offline / not
 * viewing) — it is then a no-op. Only the target user's own connections are
 * touched; other collaborators (including the owner) are never disturbed.
 *
 * Returns the number of connections that were closed (used by tests/telemetry).
 */
export function disconnectUserFromDocument(documentName: string, userId: string): number {
  if (!hocuspocus) return 0;
  const document = hocuspocus.documents.get(documentName);
  if (!document) return 0;

  let closed = 0;
  for (const connection of document.getConnections()) {
    // `context` is what onAuthenticate returned — server-derived, never client input.
    const ctx = connection.context as { userId?: string } | undefined;
    if (ctx?.userId === userId) {
      connection.close(PERMISSION_CHANGED_CLOSE);
      closed += 1;
    }
  }
  return closed;
}
