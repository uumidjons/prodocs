import { describe, expect, it } from 'vitest';
import { Editor, getSchema } from '@tiptap/react';
import * as Y from 'yjs';
import Collaboration from '@tiptap/extension-collaboration';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { COLLAB_FIELD, INITIAL_DOCUMENT_CONTENT, buildBaseExtensions } from '@scribe/shared';
import { Packer } from 'docx';
import { exportDocumentToPdf } from './pdf.js';
import { buildDocx } from './docx.js';

/**
 * The critical guarantee (task §8/§9/§15): export is READ-ONLY. It must never mutate
 * the editor's document or the underlying Y.Doc, so a collaborator editing at the same
 * time can never observe an export-caused change.
 *
 * We seed a Y.Doc exactly as the server does, bind a real Tiptap editor to it via the
 * Collaboration extension, snapshot both the editor JSON and the encoded CRDT state,
 * run both exporters against `editor.getJSON()`, and assert nothing changed.
 */

const schema = getSchema(buildBaseExtensions());

function seededYDoc(): Y.Doc {
  const ydoc = new Y.Doc();
  Y.applyUpdate(
    ydoc,
    Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, INITIAL_DOCUMENT_CONTENT, COLLAB_FIELD)),
  );
  return ydoc;
}

describe('export does not mutate collaborative state', () => {
  it('leaves the editor document and the Y.Doc byte-identical', async () => {
    const ydoc = seededYDoc();
    const editor = new Editor({
      extensions: [
        ...buildBaseExtensions(),
        Collaboration.configure({ document: ydoc, field: COLLAB_FIELD }),
      ],
    });

    try {
      const jsonBefore = JSON.stringify(editor.getJSON());
      const stateBefore = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      // Run BOTH exporters against the live snapshot.
      const pdfBytes = await exportDocumentToPdf(editor.getJSON());
      const docxBytes = await Packer.toBuffer(buildDocx(editor.getJSON()));
      expect(pdfBytes.length).toBeGreaterThan(0);
      expect(docxBytes.length).toBeGreaterThan(0);

      const jsonAfter = JSON.stringify(editor.getJSON());
      const stateAfter = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      expect(jsonAfter).toEqual(jsonBefore);
      expect(stateAfter.equals(stateBefore)).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('still lets a concurrent edit apply normally after an export', async () => {
    const ydoc = seededYDoc();
    const editor = new Editor({
      extensions: [
        ...buildBaseExtensions(),
        Collaboration.configure({ document: ydoc, field: COLLAB_FIELD }),
      ],
    });
    try {
      await exportDocumentToPdf(editor.getJSON());
      // Editing after export works and changes the document (export did not lock it).
      const sizeBefore = Y.encodeStateAsUpdate(ydoc).length;
      editor.commands.insertContentAt(1, 'NEW ');
      expect(editor.getText()).toContain('NEW');
      expect(Y.encodeStateAsUpdate(ydoc).length).not.toBe(sizeBefore);
    } finally {
      editor.destroy();
    }
  });
});
