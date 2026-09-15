import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { PresenceUser } from './types.js';

/** The provider's awareness instance type, without importing y-protocols directly. */
type ProviderAwareness = HocuspocusProvider['awareness'];

/**
 * Resolves the WebSocket endpoint for the collaboration server. In dev and Docker
 * the Vite dev server proxies `/collab` to the backend, so a same-origin URL works
 * everywhere; `VITE_COLLAB_URL` can override it for other deployments.
 */
export function buildCollabUrl(): string {
  const override = import.meta.env.VITE_COLLAB_URL as string | undefined;
  if (override) return override;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/collab`;
}

/** Local IndexedDB store name for a document's CRDT state (y-indexeddb). */
export function indexeddbName(documentId: string): string {
  return `scribe-doc-${documentId}`;
}

/**
 * Maps ephemeral Yjs awareness state into a de-duplicated presence list. Awareness
 * is keyed by transient Yjs clientID; we collapse to the stable application user id
 * so multiple tabs of one person appear once.
 */
export function readPresence(awareness: ProviderAwareness): PresenceUser[] {
  if (!awareness) return [];
  const byId = new Map<string, PresenceUser>();
  for (const state of awareness.getStates().values()) {
    const user = (state as { user?: Partial<PresenceUser> }).user;
    if (user?.id && user.name && user.color) {
      byId.set(user.id, { id: user.id, name: user.name, color: user.color });
    }
  }
  return [...byId.values()];
}
