import type { DocumentDto, DocumentView, Role } from '@scribe/shared';
import { pool } from '../../db/pool.js';

interface DocumentJoinRow {
  id: string;
  title: string;
  owner_id: string;
  owner_name: string;
  role: Role;
  created_at: Date;
  updated_at: Date;
  last_opened_at: Date | null;
  deleted_at: Date | null;
}

function toDocumentDto(row: DocumentJoinRow): DocumentDto {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastOpenedAt: row.last_opened_at ? row.last_opened_at.toISOString() : null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

/** The columns every document listing selects, joined to the owner's identity. */
const DOC_SELECT = `
  SELECT d.id, d.title, d.owner_id, o.display_name AS owner_name, m.role,
         d.created_at, d.updated_at, m.last_opened_at, d.deleted_at
    FROM documents d
    JOIN memberships m ON m.document_id = d.id
    JOIN users o ON o.id = d.owner_id`;

/** Creates a document and the owner membership atomically. */
export async function createDocument(ownerId: string, title: string): Promise<DocumentDto> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO documents (title, owner_id) VALUES ($1, $2) RETURNING id`,
      [title, ownerId],
    );
    const created = rows[0];
    if (!created) throw new Error('Failed to create document');
    await client.query(
      `INSERT INTO memberships (document_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [created.id, ownerId],
    );
    await client.query('COMMIT');
    const doc = await getDocumentForUser(created.id, ownerId);
    if (!doc) throw new Error('Failed to create document');
    return doc;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Documents for the current user, scoped to a sidebar section. Every view is
 * membership-scoped (so it never leaks another user's documents) and excludes
 * system templates (templates carry no membership, so the JOIN already omits them —
 * the explicit `is_template = false` is belt-and-suspenders).
 *
 *   - mine   : all live documents the user can access (owned + shared).
 *   - shared : live documents owned by someone else (the user is a non-owner member).
 *   - recent : live documents the user has actually opened, newest interaction first.
 *   - trash  : the user's own soft-deleted documents (only the owner sees/relists Trash).
 */
export async function listDocumentsForUser(
  userId: string,
  view: DocumentView = 'mine',
): Promise<DocumentDto[]> {
  let where = `WHERE m.user_id = $1 AND d.is_template = false`;
  let order = `ORDER BY d.updated_at DESC`;

  switch (view) {
    case 'mine':
      where += ` AND d.deleted_at IS NULL`;
      break;
    case 'shared':
      where += ` AND d.deleted_at IS NULL AND m.role <> 'owner'`;
      break;
    case 'recent':
      where += ` AND d.deleted_at IS NULL AND m.last_opened_at IS NOT NULL`;
      order = `ORDER BY m.last_opened_at DESC LIMIT 20`;
      break;
    case 'trash':
      // Only the owner may see/restore a document in Trash.
      where += ` AND d.deleted_at IS NOT NULL AND m.role = 'owner'`;
      order = `ORDER BY d.deleted_at DESC`;
      break;
  }

  const { rows } = await pool.query<DocumentJoinRow>(`${DOC_SELECT} ${where} ${order}`, [userId]);
  return rows.map(toDocumentDto);
}

/**
 * Returns the LIVE document with the requesting user's role, or `null` when the
 * document does not exist, is soft-deleted (in Trash), or the user has no
 * membership. Callers translate `null` into a 404 (never 403) — see security.md,
 * access enumeration. Because a trashed document returns null here, it cannot be
 * opened, edited, or joined over the collaboration socket.
 */
export async function getDocumentForUser(
  documentId: string,
  userId: string,
): Promise<DocumentDto | null> {
  const { rows } = await pool.query<DocumentJoinRow>(
    `${DOC_SELECT} WHERE d.id = $1 AND m.user_id = $2 AND d.deleted_at IS NULL`,
    [documentId, userId],
  );
  const row = rows[0];
  return row ? toDocumentDto(row) : null;
}

/**
 * Owner/lifecycle info for a document REGARDLESS of its trashed state — used to
 * authorize Trash operations (a document being restored/purged is, by definition,
 * already soft-deleted, so `getDocumentForUser` would hide it). Returns null when the
 * user has no membership on the document.
 */
export interface DocumentAdminInfo {
  role: Role;
  isTemplate: boolean;
  deleted: boolean;
}

export async function getDocumentAdminInfo(
  documentId: string,
  userId: string,
): Promise<DocumentAdminInfo | null> {
  const { rows } = await pool.query<{
    role: Role;
    is_template: boolean;
    deleted_at: Date | null;
  }>(
    `SELECT m.role, d.is_template, d.deleted_at
       FROM documents d
       JOIN memberships m ON m.document_id = d.id
      WHERE d.id = $1 AND m.user_id = $2`,
    [documentId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { role: row.role, isTemplate: row.is_template, deleted: row.deleted_at !== null };
}

/**
 * Updates the title and returns the document with `userId`'s role. Callers must
 * have already authorized the write; this re-joins membership only to render the
 * accurate role in the response.
 */
export async function updateDocumentTitle(
  documentId: string,
  userId: string,
  title: string,
): Promise<DocumentDto | null> {
  await pool.query(`UPDATE documents SET title = $2, updated_at = now() WHERE id = $1`, [
    documentId,
    title,
  ]);
  return getDocumentForUser(documentId, userId);
}

/** Records that `userId` just opened this document (drives Recent). Best-effort. */
export async function touchLastOpened(documentId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE memberships SET last_opened_at = now() WHERE document_id = $1 AND user_id = $2`,
    [documentId, userId],
  );
}

/** Move a document to Trash (soft delete). Content and memberships are preserved. */
export async function softDeleteDocument(documentId: string): Promise<void> {
  await pool.query(`UPDATE documents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [
    documentId,
  ]);
}

/** Restore a document from Trash. */
export async function restoreDocument(documentId: string): Promise<void> {
  await pool.query(`UPDATE documents SET deleted_at = NULL WHERE id = $1`, [documentId]);
}

/** Permanently delete a document (cascades to memberships + persisted content). */
export async function deleteDocument(documentId: string): Promise<void> {
  await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);
}
