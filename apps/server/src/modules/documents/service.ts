import type { CreateDocumentInput, DocumentDto, DocumentView } from '@scribe/shared';
import { roleAtLeast } from '@scribe/shared';
import { Errors } from '../../http/errors.js';
import {
  createDocument,
  deleteDocument,
  getDocumentAdminInfo,
  getDocumentForUser,
  listDocumentsForUser,
  restoreDocument,
  softDeleteDocument,
  touchLastOpened,
  updateDocumentTitle,
} from './repo.js';
import { copyDocumentContent } from './templateCopy.js';
import { getTemplateById } from './templates.js';

const DEFAULT_TITLE = 'Untitled document';

export function list(userId: string, view: DocumentView = 'mine'): Promise<DocumentDto[]> {
  return listDocumentsForUser(userId, view);
}

export { listTemplates } from './templates.js';

/**
 * Creates a document (task §1/§3). Two paths:
 *
 *   - Blank: a fresh, empty document owned by the creator (title "Untitled document").
 *     Nothing is copied from any other document.
 *   - From a SYSTEM TEMPLATE (`fromTemplateId`): a brand-new, independent document
 *     (new id, creator becomes owner, NO copied memberships) whose content is copied
 *     from the template's durable Yjs state. The template is never modified, and its
 *     title becomes the new document's initial title (a new INSTANCE, not a "Copy of").
 *
 * Only real system templates are accepted as a source — a user's own document is
 * never a template, so there is no recursive "Copy of Copy of …" chain.
 */
export async function create(userId: string, input: CreateDocumentInput): Promise<DocumentDto> {
  const requestedTitle = input.title?.trim();

  if (input.fromTemplateId) {
    // Only a real system template is a valid source. Unknown / non-template ids 404.
    const template = await getTemplateById(input.fromTemplateId);
    if (!template) throw Errors.notFound('Template not found');

    // A new instance: default the title to the template's own name (never "Copy of …").
    const doc = await createDocument(userId, requestedTitle || template.title);

    // Copy CONTENT only (no memberships, no awareness/presence — see templateCopy).
    // A copy failure must not leave a dangling empty document, so roll it back.
    try {
      await copyDocumentContent(template.id, doc.id);
    } catch (err) {
      await deleteDocument(doc.id).catch(() => {});
      throw err;
    }
    return doc;
  }

  return createDocument(userId, requestedTitle || DEFAULT_TITLE);
}

export async function get(userId: string, documentId: string): Promise<DocumentDto> {
  const doc = await getDocumentForUser(documentId, userId);
  if (!doc) throw Errors.notFound('Document not found');
  // Opening a document is a "meaningful interaction": record it so the document
  // surfaces in the user's Recent list (per-user, survives reload/logout). Best
  // effort — a failure here must never block opening the document.
  await touchLastOpened(documentId, userId).catch(() => {});
  return doc;
}

export async function updateTitle(
  userId: string,
  documentId: string,
  title: string,
): Promise<DocumentDto> {
  // Existence + access first (404 hides non-members), then role for the write.
  const doc = await getDocumentForUser(documentId, userId);
  if (!doc) throw Errors.notFound('Document not found');
  if (!roleAtLeast(doc.role, 'editor')) throw Errors.forbidden('You cannot edit this document');

  const updated = await updateDocumentTitle(documentId, userId, title);
  if (!updated) throw Errors.notFound('Document not found');
  return updated;
}

/**
 * Move a document to Trash (soft delete — task §5). Only the OWNER of a real user
 * document may do this: a non-owner (viewer/editor) must not be able to trash the
 * owner's document, and a system template (no membership) can never be trashed
 * through the normal document flow.
 */
export async function trash(userId: string, documentId: string): Promise<void> {
  const info = await getDocumentAdminInfo(documentId, userId);
  // No membership OR it is a system template → 404 (never reveal, never allow).
  if (!info || info.isTemplate) throw Errors.notFound('Document not found');
  if (!roleAtLeast(info.role, 'owner'))
    throw Errors.forbidden('Only the owner can delete this document');
  await softDeleteDocument(documentId);
}

/** Restore a document from Trash back to the owner's Documents (task §5). */
export async function restore(userId: string, documentId: string): Promise<void> {
  const info = await getDocumentAdminInfo(documentId, userId);
  if (!info || info.isTemplate) throw Errors.notFound('Document not found');
  if (!roleAtLeast(info.role, 'owner'))
    throw Errors.forbidden('Only the owner can restore this document');
  await restoreDocument(documentId);
}

/**
 * Permanently delete a document (task §5). Owner-only and irreversible; cascades to
 * memberships and persisted CRDT content. Only meaningful for a document already in
 * Trash, but authorized purely by ownership.
 */
export async function purge(userId: string, documentId: string): Promise<void> {
  const info = await getDocumentAdminInfo(documentId, userId);
  if (!info || info.isTemplate) throw Errors.notFound('Document not found');
  if (!roleAtLeast(info.role, 'owner'))
    throw Errors.forbidden('Only the owner can delete this document');
  await deleteDocument(documentId);
}
