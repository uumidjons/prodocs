import type { SyncStatus } from '../../ui/StatusPill.js';

/**
 * Pure derivation of the connection/sync state machine from
 * docs/architecture/connection-states.md. Kept as a standalone pure function so
 * every transition is unit-testable without a live WebSocket (testing-strategy.md:
 * "prove convergence, don't assume it" — the state machine is prove-able logic).
 *
 * The governing rule (connection-states.md): the state only ever describes the
 * *remote* relationship. Editing is never blocked by any of these states — that is
 * enforced in the editor layer (role drives `editable`, never the socket).
 *
 * The derivation is intentionally *honest* about the two distinct not-connected
 * causes the spec (§13) asks us to distinguish:
 *
 *   - the browser reports no network (`navigator.onLine === false`)      → OFFLINE
 *   - the browser has network but the socket is down and we are retrying → RECONNECTING
 *
 * so "Offline — saved locally" is never shown while a reconnect could actually
 * succeed, and "Reconnecting…" is never shown while the machine genuinely has no
 * network. A server outage (process down, but browser online) is truthfully a
 * RECONNECTING state, not OFFLINE and never SYNCED.
 */

/** The raw transport signals the provider + browser expose. */
export interface ConnectionSignals {
  /** HocuspocusProvider socket status. */
  providerStatus: 'connecting' | 'connected' | 'disconnected';
  /** Whether the Yjs sync handshake has completed on the current connection. */
  synced: boolean;
  /** Whether authentication/authorization failed fatally (non-retryable). */
  authFailed: boolean;
  /** `navigator.onLine` — the browser's own network reachability signal. */
  online: boolean;
  /** True once a connection has succeeded at least once (distinguishes first
   *  connect from a retry after a drop). */
  connectedOnce: boolean;
}

export function deriveConnectionStatus(s: ConnectionSignals): SyncStatus {
  // Fatal auth/access loss is terminal and non-retryable — surface it even if the
  // socket is technically flapping, so the user is prompted to re-authenticate
  // rather than staring at an endless "Reconnecting…".
  if (s.authFailed) return 'error';

  // The browser reporting no network is decisive: we are offline and MUST NOT claim
  // "Synced to cloud", even if the socket object hasn't yet noticed it dropped. This
  // is checked before the connected branch precisely so a stale "connected" status
  // can never mask a real loss of network (the spec's "no lying about synced" rule).
  if (!s.online) return 'offline';

  if (s.providerStatus === 'connected') {
    // Connected, but the initial or catch-up handshake may still be in flight.
    return s.synced ? 'synced' : 'syncing';
  }

  // Not connected but the browser has network: the socket is down and we are
  // retrying (e.g. server outage, §13) — that is RECONNECTING, distinct from OFFLINE.
  if (s.connectedOnce) return 'reconnecting';
  return 'connecting';
}
