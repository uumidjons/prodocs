import { Hocuspocus } from '@hocuspocus/server';
import type { onAuthenticatePayload } from '@hocuspocus/server';
import { config } from '../config/index.js';
import { logSecurityEvent } from '../observability/events.js';
import { authorizeCollabConnection } from './auth.js';
import { onChange, onLoadDocument, onStoreDocument } from './persistence.js';

/**
 * Builds the Hocuspocus collaboration server (the WebSocket "Layer 3" endpoint).
 * It is NOT a separate service — the returned instance is attached to the same
 * Node process / HTTP server as Fastify (see attach.ts), preserving the modular
 * monolith. No Redis, no second app.
 *
 * Order of guarantees per connection:
 *   1. onAuthenticate — verify JWT + membership BEFORE the doc loads or any update
 *      is accepted; viewers are marked read-only (server rejects their updates).
 *   2. onLoadDocument — reconstruct the Y.Doc from Postgres (or seed if new).
 *   3. onChange/onStoreDocument — persist updates and periodic snapshots.
 */
export function createHocuspocus(): Hocuspocus {
  return new Hocuspocus({
    // How long to wait after the last change before writing a snapshot; updates
    // are still appended immediately in onChange, so this only paces compaction.
    // Tests flush quickly so snapshots settle within the test's lifetime.
    debounce: config.nodeEnv === 'test' ? 200 : 2000,
    maxDebounce: config.nodeEnv === 'test' ? 500 : 10000,
    // Evict a document from memory as soon as its last client disconnects (after
    // flushing a snapshot). Matches our "server memory is a cache" model, keeps
    // memory bounded, and lets the process shut down without waiting on idle docs.
    unloadImmediately: true,
    // Ping/idle timeout for detecting dead peers. Kept short in tests so a client
    // that vanished without a clean close is reaped quickly (otherwise teardown
    // waits on the default 30s). Production uses the standard 30s.
    timeout: config.nodeEnv === 'test' ? 2000 : 30000,

    async onAuthenticate(data: onAuthenticatePayload) {
      try {
        const identity = await authorizeCollabConnection(data.token, data.documentName);
        // Viewers may observe in real time but cannot write: Hocuspocus rejects
        // inbound document updates from a read-only connection.
        if (identity.readOnly) {
          data.connection.readOnly = true;
        }
        // Exposed to later hooks as `context`; never trusted from the client.
        return { userId: identity.userId, role: identity.role };
      } catch (err) {
        // Log the failed connection (no token/content ever logged) then rethrow so
        // Hocuspocus closes the socket. Covers bad/expired token and missing
        // membership alike — both are a rejected collaboration connection.
        logSecurityEvent('ws.auth.failed', { documentName: data.documentName });
        throw err;
      }
    },

    onLoadDocument,
    onChange,
    onStoreDocument,
  });
}
