import type { Role } from '@scribe/shared';
import { getDocumentForUser } from '../modules/documents/repo.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

/**
 * Authorization for a WebSocket collaboration connection. Deliberately reuses the
 * SAME primitives as the HTTP API — `verifyAccessToken` and the membership repo
 * (`getDocumentForUser`) — so REST and WS cannot enforce access differently
 * (security.md: membership is the single source of truth).
 */

export interface CollabIdentity {
  userId: string;
  role: Role;
  /** True for viewers — the caller must mark the connection read-only. */
  readOnly: boolean;
}

export class CollabAuthError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies the access token and the user's membership for `documentName` (a
 * document UUID) BEFORE any document is loaded or any update is accepted. Throws
 * {@link CollabAuthError} on any failure, which the Hocuspocus `onAuthenticate`
 * hook turns into a connection rejection.
 *
 * Non-membership and non-existence are treated identically (both throw), so a
 * caller cannot distinguish "exists but forbidden" from "does not exist" by
 * guessing document UUIDs — matching the REST 404-on-forbidden behavior.
 */
export async function authorizeCollabConnection(
  token: string,
  documentName: string,
): Promise<CollabIdentity> {
  if (!token) throw new CollabAuthError('Missing access token');

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    throw new CollabAuthError('Invalid or expired access token');
  }

  // A malformed room id is never a real document — reject before hitting the DB
  // (an invalid UUID would also error the query).
  if (!UUID_RE.test(documentName)) {
    throw new CollabAuthError('Unknown document');
  }

  const doc = await getDocumentForUser(documentName, userId);
  if (!doc) throw new CollabAuthError('Unknown document'); // no membership OR does not exist

  return { userId, role: doc.role, readOnly: doc.role === 'viewer' };
}
