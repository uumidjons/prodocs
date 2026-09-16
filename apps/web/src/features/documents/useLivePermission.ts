import { useEffect, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { type Role, roleAtLeast } from '@scribe/shared';
import { ApiError, api } from '../../api/index.js';

/**
 * The single source of truth for what the current user may do with the OPEN
 * document, kept live. The server is authoritative: the role only ever changes
 * here in response to the authoritative server (the REST metadata endpoint), never
 * from a client guess.
 *
 * Why a hook and not just `data.role`: `data.role` is fetched once when the document
 * opens. If the owner changes this user's role while the document is open, that
 * initial value goes stale. The collaboration server force-drops this user's socket
 * on a membership change (memberships/service.ts → disconnectUserFromDocument), so
 * we listen to the provider's re-authentication to re-derive the permission:
 *
 *   - reconnect + `authenticated`      → re-fetch the role (viewer↔editor takes effect)
 *   - reconnect + `authenticationFailed` → access was revoked (removed member)
 *
 * Editability is derived from this one role (`canEdit`), so the editor, toolbar and
 * title read-only state can never disagree. Security is unaffected either way: the
 * server independently rejects unauthorized writes on the re-authenticated socket,
 * so a brief UI lag during the reconnect can never become a write the server allows.
 */
export interface LivePermission {
  /** The current user's authoritative role on the open document. */
  role: Role;
  /** True when the user may edit (owner/editor) and access has not been revoked. */
  canEdit: boolean;
  /** True once the server has revoked this user's access to the document. */
  revoked: boolean;
}

export function useLivePermission(
  documentId: string,
  provider: HocuspocusProvider | null | undefined,
  initialRole: Role,
): LivePermission {
  const [role, setRole] = useState<Role>(initialRole);
  const [revoked, setRevoked] = useState(false);
  // Skip the first `authenticated` after mount: DocumentView already fetched the
  // role over REST, so an immediate re-fetch would be redundant. We only react to
  // RE-authentication (a reconnect), which is where a live role change surfaces.
  const seenFirstAuth = useRef(false);

  // Reset when the document (or its freshly-fetched role) changes — e.g. a switch.
  useEffect(() => {
    setRole(initialRole);
    setRevoked(false);
    seenFirstAuth.current = false;
  }, [documentId, initialRole]);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;

    const refetchRole = async () => {
      try {
        const doc = await api.documents.get(documentId);
        if (cancelled) return;
        setRole(doc.role);
        setRevoked(false);
      } catch (err) {
        // 403/404 from the authoritative server = access was revoked while open.
        // A non-ApiError (offline) or a 401 (handled by the API client's refresh /
        // auth-failure flow) must NOT be mistaken for revocation.
        if (!cancelled && err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setRevoked(true);
        }
      }
    };

    const onAuthenticated = () => {
      if (!seenFirstAuth.current) {
        seenFirstAuth.current = true;
        return;
      }
      void refetchRole();
    };

    // The forced reconnect after a removal is rejected by onAuthenticate. Confirm
    // against REST (authoritative) rather than assuming: a transient WS auth hiccup
    // where REST still returns the document should not flash a false revocation.
    const onAuthFailed = () => void refetchRole();

    provider.on('authenticated', onAuthenticated);
    provider.on('authenticationFailed', onAuthFailed);
    return () => {
      cancelled = true;
      provider.off('authenticated', onAuthenticated);
      provider.off('authenticationFailed', onAuthFailed);
    };
  }, [documentId, provider]);

  return { role, canEdit: !revoked && roleAtLeast(role, 'editor'), revoked };
}
