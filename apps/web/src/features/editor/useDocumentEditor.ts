import { useEffect } from 'react';
import { type Editor, useEditor } from '@tiptap/react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { type EditorUser, buildEditorExtensions } from './extensions.js';
import { createMediaNodeView } from './mediaNodeView.js';

interface UseDocumentEditorOptions {
  ydoc: Y.Doc;
  provider?: HocuspocusProvider | null;
  editable: boolean;
  user?: EditorUser;
  /** Document id — needed for the media node view's authenticated fetch. */
  documentId?: string;
  /** Notified with the derived A4 page count (drives the page backdrop). */
  onPagesChange?: (pageCount: number) => void;
}

/**
 * Creates the Tiptap editor bound to a document's `Y.Doc`. The Y.Doc is the single
 * source of truth for content — there is no `content` prop, no local ProseMirror
 * history, and no localStorage draft (all removed in Phase 2). Content flows:
 * Tiptap ⇄ Y.Doc ⇄ provider(s) ⇄ server.
 *
 * The editor is recreated only when the `ydoc` identity changes (i.e. on document
 * switch), so remote updates never force the whole subtree to re-render.
 */
export function useDocumentEditor({
  ydoc,
  provider,
  editable,
  user,
  documentId,
  onPagesChange,
}: UseDocumentEditorOptions): Editor | null {
  const editor = useEditor(
    {
      extensions: buildEditorExtensions({ ydoc, provider, user, documentId, onPagesChange }),
      editable,
      // Toolbar reactivity is handled by `useEditorState`, so we don't re-render
      // the whole editor subtree on every (local or remote) transaction.
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: 'scribe-prose focus:outline-none',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Document body',
        },
        // The media node view fetches its binary over the authenticated endpoint using
        // the document id (ADR 0012). Registered here (client-only) so the shared media
        // node stays pure schema. Omitted when there is no documentId (unit tests).
        ...(documentId ? { nodeViews: { media: createMediaNodeView(documentId) } } : {}),
      },
      // NB: no `content` — Collaboration seeds the doc from the shared Y.Doc.
    },
    // Recreate the editor when the collaborative document changes.
    [ydoc],
  );

  // Reflect role changes (viewer vs editor) without recreating the editor.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return editor;
}
