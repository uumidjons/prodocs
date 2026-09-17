import { pool } from '../../db/pool.js';

/** A persisted media metadata row (ADR 0012). The binary lives in object storage. */
export interface MediaRow {
  id: string;
  documentId: string;
  uploadedBy: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
}

interface MediaDbRow {
  id: string;
  document_id: string;
  uploaded_by: string;
  storage_key: string;
  mime_type: string;
  byte_size: string; // BIGINT comes back as a string from node-postgres
  original_filename: string | null;
  width: number | null;
  height: number | null;
}

function toMediaRow(r: MediaDbRow): MediaRow {
  return {
    id: r.id,
    documentId: r.document_id,
    uploadedBy: r.uploaded_by,
    storageKey: r.storage_key,
    mimeType: r.mime_type,
    byteSize: Number(r.byte_size),
    originalFilename: r.original_filename,
    width: r.width,
    height: r.height,
  };
}

export interface InsertMediaInput {
  documentId: string;
  uploadedBy: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
}

export async function insertMedia(input: InsertMediaInput): Promise<MediaRow> {
  const { rows } = await pool.query<MediaDbRow>(
    `INSERT INTO media
       (document_id, uploaded_by, storage_key, mime_type, byte_size, original_filename, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.documentId,
      input.uploadedBy,
      input.storageKey,
      input.mimeType,
      input.byteSize,
      input.originalFilename,
      input.width,
      input.height,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to insert media');
  return toMediaRow(row);
}

/**
 * Fetch a media row that BELONGS to `documentId`. Scoping the lookup to the document
 * is essential: membership is checked on the document, so a media id from another
 * document (or a forged id) must not resolve here — it returns null → 404.
 */
export async function getMediaForDocument(
  documentId: string,
  mediaId: string,
): Promise<MediaRow | null> {
  const { rows } = await pool.query<MediaDbRow>(
    `SELECT * FROM media WHERE id = $1 AND document_id = $2 AND deleted_at IS NULL`,
    [mediaId, documentId],
  );
  const row = rows[0];
  return row ? toMediaRow(row) : null;
}
