import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { type Editor, EditorContent } from '@tiptap/react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { Spinner } from '../../ui/Spinner.js';
import { type EditorUser } from './extensions.js';
import { pageGeometryVars, stackHeight } from './pageGeometry.js';
import { Toolbar } from './Toolbar.js';
import { useDocumentEditor } from './useDocumentEditor.js';
import { EditorToasts } from './EditorToasts.js';
import { CommentsPanel } from '../comments/CommentsPanel.js';

interface DocumentEditorProps {
  ydoc: Y.Doc;
  provider?: HocuspocusProvider | null;
  editable: boolean;
  user?: EditorUser;
  /** Document id — enables media upload/fetch and scopes comment authorship. */
  documentId?: string;
  /** Test/instrumentation hook — receives the editor once it initializes. */
  onEditorReady?: (editor: Editor) => void;
}

/**
 * Owns the document canvas: the floating toolbar (above the sheets) and the
 * editable A4 "sheets" bound to the collaborative `Y.Doc`. The canvas contains ONLY
 * document content — the document title lives in the application header.
 *
 * PAGE MODEL (task §4/§5): the pages are drawn as a BACKDROP of full-height A4 white
 * sheets (`.scribe-sheet`) behind a transparent editing layer (`.scribe-prose`). The
 * pagination extension measures the content, inserts transparent page-gap
 * decorations that flow content onto each sheet, and reports the derived page COUNT
 * so we render exactly that many backdrop sheets. Because the backdrop sheets are
 * always full A4 height regardless of content, an empty page, a list-only page, or
 * the page after a manual break all keep a stable A4 size — content never shrinks a
 * page. All geometry comes from one source (pageGeometry.ts), shared with the CSS.
 *
 * The Y.Doc remains the single source of truth; pagination is never written to it.
 */
export function DocumentEditor({
  ydoc,
  provider,
  editable,
  user,
  documentId,
  onEditorReady,
}: DocumentEditorProps) {
  const [pageCount, setPageCount] = useState(1);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Stable callback so the editor (created once per Y.Doc) keeps a valid reference;
  // the useState setter identity is stable, so this never needs to change.
  const onPagesChange = useCallback((count: number) => {
    setPageCount(Math.max(1, count));
  }, []);

  const editor = useDocumentEditor({ ydoc, provider, editable, user, documentId, onPagesChange });

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  return (
    <div className="scribe-pages" style={pageGeometryVars}>
      <EditorToasts />
      {editor && (
        <Toolbar
          editor={editor}
          documentId={documentId}
          ydoc={ydoc}
          user={user}
          commentsOpen={commentsOpen}
          onToggleComments={() => setCommentsOpen((v) => !v)}
        />
      )}

      {editor && commentsOpen && (
        <CommentsPanel
          editor={editor}
          ydoc={ydoc}
          user={user}
          onClose={() => setCommentsOpen(false)}
        />
      )}

      <div
        className="scribe-page-sheet"
        // The transparent editing layer is stretched to cover the full backdrop so
        // the last (possibly content-light) page still reads as a full A4 sheet.
        style={{ '--content-min-height': `${stackHeight(pageCount)}px` } as CSSProperties}
      >
        {/* Backdrop: one full-height white A4 sheet per logical page (presentation
            only, never editable, never part of the document). */}
        <div className="scribe-page-backdrop" aria-hidden="true">
          {Array.from({ length: pageCount }, (_, i) => (
            <div key={i} className="scribe-sheet" />
          ))}
        </div>

        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="scribe-prose flex justify-center py-16" aria-label="Preparing editor">
            <Spinner size={24} />
          </div>
        )}
      </div>
    </div>
  );
}
