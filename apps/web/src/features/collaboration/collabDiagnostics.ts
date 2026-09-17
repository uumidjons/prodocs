import type { Editor } from '@tiptap/react';

/**
 * TEST-ONLY convergence diagnostics (testing-strategy.md → E2E; correctness
 * contract §17). Exposes the open document's CANONICAL LOGICAL state to the
 * Playwright suite so a browser-level convergence assertion can detect STRUCTURAL
 * divergence — different marks, node attributes (e.g. `textAlign`), page breaks, or
 * list structure — not merely different plain text.
 *
 * The canonical representation is `editor.getJSON()`: the ProseMirror document JSON,
 * which is exactly the logical projection of the shared Yjs document. It deliberately
 * EXCLUDES client-only presentation (pagination decorations, remote cursors), which
 * are per-client and viewport-dependent and would make two converged replicas look
 * different. It is therefore the right thing to compare across peers — the browser
 * analogue of the server suite's Yjs state-vector equality check.
 *
 * This is installed ONLY in dev builds (`import.meta.env.DEV`), the mode the E2E
 * suite runs against (Vite dev server). It is never bundled into a production build,
 * never mutates the editor or the Y.Doc, and exposes no document content in
 * production. It is diagnostics, not a synchronization mechanism.
 */

/** The window surface the E2E convergence helpers read. Present only in dev. */
export interface ScribeConvergenceProbe {
  /** Canonical logical document JSON (ProseMirror doc: marks, attrs, structure). */
  documentJson(): unknown;
  /**
   * TEST-ONLY: force a LOCAL document mutation into the bound editor/Y.Doc, bypassing
   * the read-only DOM gate. This exists so the permission-regression E2E can
   * deterministically simulate the exact failure the fix guards against — a client
   * that acquired local CRDT state it was NOT authorized to create (e.g. a keystroke
   * that slipped through during the read-only transition). It is programmatic and
   * dev-only; it never runs in production and is not a product code path. Returns
   * true if a transaction was dispatched.
   */
  injectLocalEdit(text: string): boolean;
  /**
   * TEST-ONLY: place the caret at the very START of a top-level block (by 0-based
   * index; default 0), then focus the editor. Native caret keys (Home/ArrowLeft) are
   * unreliable in headless Chromium once a Playwright query has run against the page,
   * so the indentation E2E uses this to position the caret deterministically before
   * exercising Backspace. Dev-only; never a product code path.
   */
  caretToBlockStart(blockIndex?: number): boolean;
}

declare global {
  interface Window {
    __scribeConvergence?: ScribeConvergenceProbe;
  }
}

/**
 * Install (or refresh) the convergence probe for the currently open editor. Returns a
 * cleanup that removes it. In production builds this is a no-op that returns a no-op
 * cleanup, so callers can install it unconditionally.
 */
export function installConvergenceProbe(editor: Editor): () => void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return () => {};
  window.__scribeConvergence = {
    // A read-only snapshot each call — never a cached/stale copy — so the E2E poll
    // observes live convergence as remote updates land.
    documentJson: () => editor.getJSON(),
    // Programmatic local edit for the permission-regression E2E (dev-only). Inserts
    // at the document end; `insertContentAt` dispatches a real ProseMirror/Y.Doc
    // transaction regardless of the editor's `editable` flag, modelling a local
    // mutation the user was not authorized to make.
    injectLocalEdit: (text: string) => {
      const end = editor.state.doc.content.size;
      return editor.commands.insertContentAt(end, text);
    },
    caretToBlockStart: (blockIndex = 0) => {
      const doc = editor.state.doc;
      let pos = 1; // inside the first top-level block
      let i = 0;
      let acc = 0;
      doc.forEach((node) => {
        if (i === blockIndex) pos = acc + 1;
        acc += node.nodeSize;
        i += 1;
      });
      return editor.chain().focus().setTextSelection(pos).run();
    },
  };
  return () => {
    if (window.__scribeConvergence?.documentJson) delete window.__scribeConvergence;
  };
}
