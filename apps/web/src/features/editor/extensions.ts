import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import type { Extensions } from '@tiptap/react';
import { COLLAB_FIELD, buildBaseExtensions } from '@scribe/shared';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { Pagination } from './pagination.js';
import { MediaPaste } from './mediaPaste.js';
import { renderCollaborationCaret, renderCollaborationSelection } from './collabCursor.js';

/**
 * Builds the live editor extensions: the SHARED base schema (Layer 1) plus the
 * Yjs collaboration bindings (Layers 2/3). Keeping the schema in @scribe/shared
 * guarantees it matches the server's seeding schema exactly.
 *
 * - `Collaboration` binds the editor to the document's `Y.Doc` and provides
 *   per-user collaborative undo/redo (a Yjs `UndoManager` scoped to local edits),
 *   which replaces StarterKit's local history (disabled in the shared base).
 * - `CollaborationCursor` publishes/reads awareness so remote carets and
 *   selections render with each peer's name and color. It also sets the local
 *   `user` awareness field the presence UI reads.
 *
 * The toolbar is unchanged: it still calls the same editor commands, which now
 * operate on the collaborative document.
 */

/** Re-exported from the shared schema so the toolbar's HeadingSelect stays in sync. */
export { HEADING_LEVELS, type HeadingLevel } from '@scribe/shared';

export interface EditorUser {
  id: string;
  name: string;
  color: string;
}

interface BuildOptions {
  ydoc: Y.Doc;
  /** When absent (e.g. unit tests), remote cursors are omitted but editing works. */
  provider?: HocuspocusProvider | null;
  user?: EditorUser;
  /** Document id — enables clipboard/drop image upload (ADR 0012). */
  documentId?: string;
  /** Notified with the derived A4 page count so the backdrop renders matching sheets. */
  onPagesChange?: (pageCount: number) => void;
}

export function buildEditorExtensions({
  ydoc,
  provider,
  user,
  documentId,
  onPagesChange,
}: BuildOptions): Extensions {
  const extensions: Extensions = [
    ...buildBaseExtensions(),
    // A4 pagination is a client-only presentation layer (decorations); it is not
    // part of the shared schema and never touches the collaborative document.
    Pagination.configure({ onPagesChange }),
    Collaboration.configure({ document: ydoc, field: COLLAB_FIELD }),
  ];

  // Paste/drop image → authenticated upload → media node (client-only; needs the doc id).
  if (documentId) {
    extensions.push(MediaPaste.configure({ documentId }));
  }

  if (provider) {
    extensions.push(
      CollaborationCursor.configure({
        provider,
        // Identity-only awareness payload: stable id, display name, and the
        // collaboration color (the caller supplies the collaboration color as
        // `user.color`). No email/tokens/private profile data is published.
        user: user ? { id: user.id, name: user.name, color: user.color } : undefined,
        // Scribe-native remote caret + name flag, and translucent remote selection
        // (see collabCursor.ts). Colors come per-collaborator from awareness, so no
        // shared CSS rule can make one collaborator's color affect another.
        render: renderCollaborationCaret,
        selectionRender: renderCollaborationSelection,
      }),
    );
  }

  return extensions;
}
