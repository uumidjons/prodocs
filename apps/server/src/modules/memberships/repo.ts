import type { MemberDto, Role } from '@scribe/shared';
import { pool } from '../../db/pool.js';

/**
 * Membership persistence. `memberships` is the authorization source of truth
 * (data-model.md) — the SAME table checked by REST document access and the
 * WebSocket `onAuthenticate` hook. Sharing mutations flow through here so there is
 * exactly one place that access grants are created/changed/removed.
 */

interface MemberJoinRow {
  user_id: string;
  email: string;
  display_name: string;
  color: string;
  role: Role;
  owner_id: string;
}

function toMemberDto(row: MemberJoinRow): MemberDto {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    role: row.role,
    isOwner: row.user_id === row.owner_id,
  };
}

/**
 * All members of a document with their public identity + role, owner first then
 * by name. Joins the document to flag the owner (owner invariant lives here).
 */
export async function listMembers(documentId: string): Promise<MemberDto[]> {
  const { rows } = await pool.query<MemberJoinRow>(
    `SELECT m.user_id, u.email, u.display_name, u.color, m.role, d.owner_id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN documents d ON d.id = m.document_id
      WHERE m.document_id = $1
      ORDER BY (m.user_id = d.owner_id) DESC, u.display_name ASC`,
    [documentId],
  );
  return rows.map(toMemberDto);
}

/** The role a user holds on a document, or null if they are not a member. */
export async function getMemberRole(documentId: string, userId: string): Promise<Role | null> {
  const { rows } = await pool.query<{ role: Role }>(
    'SELECT role FROM memberships WHERE document_id = $1 AND user_id = $2',
    [documentId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Insert a membership. Uses `ON CONFLICT DO NOTHING` and reports whether a row was
 * actually created, so the caller can turn a duplicate into a safe 409 rather than
 * a DB error or a silent overwrite.
 */
export async function insertMember(
  documentId: string,
  userId: string,
  role: Role,
): Promise<{ created: boolean }> {
  const { rowCount } = await pool.query(
    `INSERT INTO memberships (document_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO NOTHING`,
    [documentId, userId, role],
  );
  return { created: (rowCount ?? 0) > 0 };
}

/** Change an existing member's role. Returns whether a row was updated. */
export async function updateMemberRole(
  documentId: string,
  userId: string,
  role: Role,
): Promise<{ updated: boolean }> {
  const { rowCount } = await pool.query(
    'UPDATE memberships SET role = $3 WHERE document_id = $1 AND user_id = $2',
    [documentId, userId, role],
  );
  return { updated: (rowCount ?? 0) > 0 };
}

/** Remove a member. Returns whether a row was deleted. */
export async function deleteMember(
  documentId: string,
  userId: string,
): Promise<{ deleted: boolean }> {
  const { rowCount } = await pool.query(
    'DELETE FROM memberships WHERE document_id = $1 AND user_id = $2',
    [documentId, userId],
  );
  return { deleted: (rowCount ?? 0) > 0 };
}
