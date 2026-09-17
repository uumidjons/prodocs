import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

/**
 * Holds a LIVE HANDLE to the open document's Tiptap editor so the header's Export
 * control can read the current authoritative document state (`editor.getJSON()`)
 * without the header being wired into the editor tree.
 *
 * This is deliberately NOT in uiStore: uiStore holds only chrome state and never
 * anything content-shaped. This store holds a reference to the editor instance (not
 * its content) purely so export — a READ-ONLY action — can serialize the current
 * document. Export never mutates the editor or the Y.Doc (task §8/§9). The handle is
 * set when the editor initializes and cleared when the document view unmounts.
 */
interface ExportState {
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
}

export const useExportStore = create<ExportState>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}));
