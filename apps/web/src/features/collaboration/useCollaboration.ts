import { useEffect, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { PERMISSION_CHANGED_CLOSE_CODE, type Role, roleAtLeast } from '@scribe/shared';
import { getValidAccessToken } from '../../api/index.js';
import type { SyncStatus } from '../../ui/StatusPill.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { buildCollabUrl, indexeddbName, readPresence } from './collabClient.js';
import { type ConnectionSignals, deriveConnectionStatus } from './connectionState.js';

/** The collaboration objects a document's editor binds to. */
export interface Collaboration {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

/**
 * Permanently delete ONE document's local y-indexeddb store (the `scribe-doc-<id>`
 * database). Scoped to a single document by name so other documents' offline state
 * is never touched. Resolves once the delete settles (success, error, or blocked) so
 * the caller can safely recreate persistence for the same name afterwards without
 * racing an in-flight open handle. Never rejects — a missing/unavailable IndexedDB
 * simply means there is nothing to purge.
 */
function purgeLocalPersistence(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve();
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Owns the collaboration LIFECYCLE for one document — Layer 2 (Y.Doc) + Layer 3
 * (transport) from system-overview.md — kept isolated from the editor UI. It:
 *
 *   - creates exactly one Y.Doc, one y-indexeddb persistence, and one Hocuspocus
 *     provider per document (never per render);
 *   - authenticates the socket with a short-lived access token (refreshed via the
 *     httpOnly cookie), never the refresh token;
 *   - derives the TRUTHFUL sync status (connection-states.md) from the provider
 *     socket events *and* the browser's own `navigator.onLine` signal, so OFFLINE
 *     and RECONNECTING are distinguished by cause (§13), and pushes it + the
 *     presence list into the UI store;
 *   - tears everything down on unmount / document switch, so providers, sockets,
 *     Y.Docs, IndexedDB listeners and window listeners never leak between docs.
 *
 * It does NOT touch document content (that is Yjs/Tiptap) and knows nothing about
 * the toolbar or editor commands. Crucially, nothing here can make the editor
 * read-only: offline is a transport fact, editability is a role fact.
 */
export function useCollaboration(
  documentId: string | undefined,
  role: Role,
): Collaboration | null {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const setConnectionStatus = useUiStore((s) => s.setConnectionStatus);
  const setPresence = useUiStore((s) => s.setPresence);
  const [collab, setCollab] = useState<Collaboration | null>(null);

  // The current authoritative role, read at (re)init time to decide whether to trust
  // local persistence. Kept in a ref so a LIVE role change does not, by itself,
  // re-run the effect (the permission-change socket drop drives re-init instead) —
  // it only informs the NEXT init.
  const roleRef = useRef(role);
  roleRef.current = role;

  // Bumped whenever the SERVER signals an authoritative permission change for this
  // client (a `PERMISSION_CHANGED_CLOSE_CODE` socket close, sent on role change or
  // removal). Incrementing it tears the whole session down and rebuilds it against a
  // FRESH Y.Doc, after purging this document's local persistence — see the effect.
  const [resetEpoch, setResetEpoch] = useState(0);
  // True only when the pending (re)init was triggered by a permission change, so the
  // effect purges local persistence exactly then and NEVER on an ordinary mount /
  // document switch / network reconnect (which must keep offline durability intact).
  const purgeOnInit = useRef(false);

  useEffect(() => {
    if (!documentId || !userId) return;

    let cancelled = false;
    let teardown = () => {};

    const init = async () => {
      // A permission change is a hard collaboration boundary: any local CRDT state
      // this client accumulated under the OLD role — including unsynced edits the
      // server never accepted — must not survive into the new role. Purge this one
      // document's local store BEFORE creating the fresh Y.Doc/persistence, so the
      // rebuilt session can only ever contain the AUTHORITATIVE server state it
      // resyncs. Scoped by document name; other documents are untouched. Ordinary
      // EDITOR mounts and network reconnects skip this and keep offline durability.
      //
      // We ALSO purge whenever this session initializes as a VIEWER. A viewer can
      // never legitimately create local-only edits, so anything in its local store
      // that the server has not sent is unauthorized (e.g. an edit that slipped
      // through during a live editor→viewer transition and was persisted before the
      // demotion settled). Discarding it on load and resyncing purely from the server
      // closes the IndexedDB reload/reconnect resurrection path. The trade-off — a
      // viewer's offline read cache is not reused — is an acceptable, scoped cost of
      // the security invariant (editors keep full offline durability).
      const viewerLoad = !roleAtLeast(roleRef.current, 'editor');
      if (purgeOnInit.current || viewerLoad) {
        purgeOnInit.current = false;
        await purgeLocalPersistence(indexeddbName(documentId));
        if (cancelled) return;
      }

      const ydoc = new Y.Doc();
      // y-indexeddb is the LOCAL durable CRDT copy (ADR-0004): it loads last-known
      // content before the socket connects (offline-first load) and persists every
      // update so offline edits survive reload/restart. It is created unconditionally
      // and independently of the WebSocket — offline works with zero providers
      // reachable. If IndexedDB is unavailable (private mode) construction can throw;
      // we degrade to in-memory rather than crash the editor.
      let idb: IndexeddbPersistence | null = null;
      try {
        idb = new IndexeddbPersistence(indexeddbName(documentId), ydoc);
      } catch (err) {
        console.warn('[collab] IndexedDB unavailable — offline durability is off', err);
      }

      // Mutable transport signals; any change recomputes the derived status so the UI
      // and the sync engine can never disagree (connection-states.md).
      const signals: ConnectionSignals = {
        providerStatus: 'connecting',
        synced: false,
        authFailed: false,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
        connectedOnce: false,
      };
      const pushStatus = () => setConnectionStatus(deriveConnectionStatus(signals));

      const provider = new HocuspocusProvider({
        url: buildCollabUrl(),
        name: documentId,
        document: ydoc,
        // WS auth uses only the short-lived access token; refreshed on each connect.
        token: async () => (await getValidAccessToken()) ?? '',
        onAuthenticationFailed() {
          signals.authFailed = true;
          pushStatus();
        },
        onClose({ event }) {
          // The server force-drops this client's socket with a dedicated close code
          // whenever its permission on the document changes (role change or removal).
          // That is the ONE authoritative moment at which local edits made under the
          // old role could otherwise linger and later resurrect, so we rebuild the
          // whole session from scratch (fresh Y.Doc + purged persistence, resynced
          // from the server). The provider still reconnects on its own; this only
          // discards the divergent local copy first. Any other close code (network
          // blip, auth failure) leaves local persistence untouched.
          if (event?.code === PERMISSION_CHANGED_CLOSE_CODE && !cancelled) {
            purgeOnInit.current = true;
            setResetEpoch((n) => n + 1);
          }
        },
        onStatus({ status }) {
          signals.providerStatus = status;
          if (status === 'connected') {
            signals.connectedOnce = true;
            signals.authFailed = false; // a fresh successful connection clears prior auth error
            signals.synced = provider.synced;
          } else {
            // A new (re)connection attempt: the previous handshake no longer holds.
            signals.synced = false;
          }
          pushStatus();
        },
        onSynced() {
          signals.synced = true;
          pushStatus();
        },
      });

      // The browser's own network signal makes OFFLINE vs RECONNECTING truthful:
      // no network → OFFLINE (a reconnect cannot succeed); network but socket down →
      // RECONNECTING (retry in progress). These fire independently of the socket.
      const onOnline = () => {
        signals.online = true;
        pushStatus();
      };
      const onOffline = () => {
        signals.online = false;
        pushStatus();
      };
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);

      const awareness = provider.awareness;
      const updatePresence = () => setPresence(readPresence(awareness));
      awareness?.on('change', updatePresence);
      updatePresence();

      pushStatus();
      setCollab({ ydoc, provider });

      teardown = () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        awareness?.off('change', updatePresence);
        provider.destroy();
        void idb?.destroy();
        ydoc.destroy();
      };
    };

    void init();

    return () => {
      cancelled = true;
      teardown();
      setCollab(null);
      setConnectionStatus(null);
      setPresence([]);
    };
    // Re-init when the document or signed-in user changes, or when a permission
    // change (`resetEpoch`) demands a fresh, authoritative-only session.
  }, [documentId, userId, resetEpoch, setConnectionStatus, setPresence]);

  return collab;
}

/** Re-export for consumers that only need the status union. */
export type { SyncStatus };
