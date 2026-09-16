import type { AssignableRole, MemberDto } from '@scribe/shared';
import { disconnectUserFromDocument } from '../../collab/controller.js';
import { Errors } from '../../http/errors.js';
import { logSecurityEvent } from '../../observability/events.js';
import { getDocumentForUser } from '../documents/repo.js';
import { findById } from '../users/repo.js';
import {
  deleteMember,
  getMemberRole,
  insertMember,
  listMembers,
  updateMemberRole,
} from './repo.js';

/**
 * Sharing / membership rules. Authorization is enforced HERE, server-side, and
 * reuses the existing membership model (`getDocumentForUser`) as the source of
 * truth — the frontend never supplies a trusted role.
 *
 * Access rules:
 *   - Any member may LIST the members (needed to render the Share dialog for all).
 *   - Only the OWNER may add, change-role, or remove members.
 *   - Non-members get 404 (existence is hidden — matches REST 404-on-forbidden);
 *     non-owner members get 403 (they can see the doc, they just lack the role).
 *
 * Owner invariant: the document owner (`documents.owner_id`) always keeps an
 * `owner` membership. Their role is never changed and they are never removed via
 * this API, and ownership is never granted to anyone else (assignable roles are
 * editor/viewer only). This preserves "every document has exactly its creator as
 * owner" without an ownership-transfer feature (out of MVP scope).
 */

/**
 * Load the document for the caller and assert they may MANAGE sharing (owner).
 * Returns the document (with the caller's role) so callers know the owner id.
 * 404 when the caller is not a member (hide existence); 403 when they are a
 * non-owner member.
 */
async function requireOwner(callerId: string, documentId: string) {
  const doc = await getDocumentForUser(documentId, callerId);
  if (!doc) throw Errors.notFound('Document not found');
  if (doc.role !== 'owner') {
    logSecurityEvent('authz.denied', { action: 'manage_sharing', documentId });
    throw Errors.forbidden('You do not have permission to manage sharing');
  }
  return doc;
}

/** List a document's members. Any member (owner/editor/viewer) may read this. */
export async function list(callerId: string, documentId: string): Promise<MemberDto[]> {
  const doc = await getDocumentForUser(documentId, callerId);
  if (!doc) throw Errors.notFound('Document not found');
  return listMembers(documentId);
}

/** Owner adds a registered user with an assignable role (editor/viewer). */
export async function add(
  callerId: string,
  documentId: string,
  targetUserId: string,
  role: AssignableRole,
): Promise<MemberDto[]> {
  const doc = await requireOwner(callerId, documentId);

  // The target must be a real registered user. A distinct, non-enumerating message
  // ("User not found") — the caller already proved owner access to this document.
  const target = await findById(targetUserId);
  if (!target) throw Errors.notFound('User not found');

  // Adding the owner (or an existing member) is a no-op conflict, surfaced clearly.
  if (targetUserId === doc.ownerId) throw Errors.conflict('User already has access');

  const { created } = await insertMember(documentId, targetUserId, role);
  if (!created) throw Errors.conflict('User already has access');

  return listMembers(documentId);
}

/** Owner changes a member's role. The owner's own role can never be changed. */
export async function changeRole(
  callerId: string,
  documentId: string,
  targetUserId: string,
  role: AssignableRole,
): Promise<MemberDto[]> {
  const doc = await requireOwner(callerId, documentId);

  // Owner invariant: the document owner always remains an owner.
  if (targetUserId === doc.ownerId) {
    throw Errors.forbidden("The owner's role cannot be changed");
  }

  const existing = await getMemberRole(documentId, targetUserId);
  if (!existing) throw Errors.notFound('User is not a member of this document');

  await updateMemberRole(documentId, targetUserId, role);

  // Live re-authorization: drop the target's open collaboration socket(s) for this
  // document so they reconnect and re-run onAuthenticate against the NEW role. This
  // is what makes viewer→editor and editor→viewer take effect immediately on an
  // already-open document, with no authorization gap (the server re-derives the
  // read-only flag) and no content loss (reconnect resyncs via Yjs state vectors).
  disconnectUserFromDocument(documentId, targetUserId);

  return listMembers(documentId);
}

/** Owner removes a member. The owner can never be removed (owner invariant). */
export async function remove(
  callerId: string,
  documentId: string,
  targetUserId: string,
): Promise<MemberDto[]> {
  const doc = await requireOwner(callerId, documentId);

  if (targetUserId === doc.ownerId) {
    throw Errors.forbidden('The owner cannot be removed');
  }

  const { deleted } = await deleteMember(documentId, targetUserId);
  if (!deleted) throw Errors.notFound('User is not a member of this document');

  // Revocation is now immediate for live sockets too: drop the removed user's open
  // connection(s). On the forced reconnect onAuthenticate finds no membership and
  // rejects the socket (Unauthorized), which the client surfaces as a revoked-access
  // state. REST access was already denied by the deleted row above.
  disconnectUserFromDocument(documentId, targetUserId);

  return listMembers(documentId);
}
