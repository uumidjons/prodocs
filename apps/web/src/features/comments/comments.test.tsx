import { afterEach, describe, expect, it } from 'vitest';
import { Editor, getSchema } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { COLLAB_FIELD, buildBaseExtensions } from '@scribe/shared';
import { buildEditorExtensions } from '../editor/extensions.js';
import {
  addCommentThread,
  deleteCommentThread,
  findCommentRange,
  getCommentsMap,
  setCommentResolved,
} from './commentsStore.js';

/**
 * Inline-comment behavior (ADR 0013). Comments are Yjs state: the anchor is a `comment`
 * mark in the document (moves via ProseMirror mapping) and the thread data lives in a
 * Y.Map in the SAME Y.Doc. These tests use a real editor bound to a seeded Y.Doc.
 */

const schema = getSchema(buildBaseExtensions());

function seededYDoc(text = 'Hello world this is a document'): Y.Doc {
  const ydoc = new Y.Doc();
  Y.applyUpdate(
    ydoc,
    Y.encodeStateAsUpdate(
      prosemirrorJSONToYDoc(
        schema,
        { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        COLLAB_FIELD,
      ),
    ),
  );
  return ydoc;
}

function makeEditor(ydoc: Y.Doc): Editor {
  return new Editor({
    extensions: buildEditorExtensions({
      ydoc,
      provider: null,
      user: { id: 'u1', name: 'Alice', color: '#000' },
    }),
  });
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function addComment(ed: Editor, ydoc: Y.Doc, id: string, from: number, to: number, text: string) {
  ed.chain().setTextSelection({ from, to }).setComment(id).run();
  addCommentThread(ydoc, {
    id,
    authorId: 'u1',
    authorName: 'Alice',
    text,
    createdAt: new Date().toISOString(),
    resolved: false,
    resolvedBy: null,
  });
}

describe('inline comments (Yjs anchor + thread map)', () => {
  it('applies a comment mark and stores the thread in the Yjs map', () => {
    const ydoc = seededYDoc();
    editor = makeEditor(ydoc);
    addComment(editor, ydoc, 'c1', 1, 6, 'first word'); // "Hello"

    // Anchor mark is in the document.
    expect(editor.getHTML()).toContain('data-comment-id="c1"');
    const range = findCommentRange(editor, 'c1');
    expect(range).not.toBeNull();

    // Thread data lives in the SAME Y.Doc's comments map (source of truth) — not React.
    const map = getCommentsMap(ydoc);
    expect(map.get('c1')?.text).toBe('first word');
    expect(map.get('c1')?.authorName).toBe('Alice');
  });

  it('does not add or remove any document text (comment is not content)', () => {
    const ydoc = seededYDoc('abcdef');
    editor = makeEditor(ydoc);
    const before = editor.getText();
    addComment(editor, ydoc, 'c1', 1, 4, 'note');
    expect(editor.getText()).toBe(before);
  });

  it('anchor survives editing: inserting text BEFORE the range shifts it', () => {
    const ydoc = seededYDoc('Hello world');
    editor = makeEditor(ydoc);
    addComment(editor, ydoc, 'c1', 7, 12, 'on world'); // "world"
    const before = findCommentRange(editor, 'c1')!;

    // Insert text at the very start — ProseMirror mapping moves the mark forward.
    editor.chain().setTextSelection(1).insertContent('PREFIX ').run();
    const after = findCommentRange(editor, 'c1')!;
    expect(after.from).toBe(before.from + 'PREFIX '.length);
    // The commented text is still "world".
    expect(editor.state.doc.textBetween(after.from, after.to)).toBe('world');
  });

  it('resolve/reopen updates the thread and the anchor mark attribute', () => {
    const ydoc = seededYDoc();
    editor = makeEditor(ydoc);
    addComment(editor, ydoc, 'c1', 1, 6, 'note');

    setCommentResolved(ydoc, editor, 'c1', true, 'Bob');
    expect(getCommentsMap(ydoc).get('c1')?.resolved).toBe(true);
    expect(getCommentsMap(ydoc).get('c1')?.resolvedBy).toBe('Bob');
    expect(editor.getHTML()).toContain('data-comment-resolved="true"');

    setCommentResolved(ydoc, editor, 'c1', false, 'Bob');
    expect(getCommentsMap(ydoc).get('c1')?.resolved).toBe(false);
  });

  it('delete removes both the thread data and the anchor mark', () => {
    const ydoc = seededYDoc();
    editor = makeEditor(ydoc);
    addComment(editor, ydoc, 'c1', 1, 6, 'note');
    expect(findCommentRange(editor, 'c1')).not.toBeNull();

    deleteCommentThread(ydoc, editor, 'c1');
    expect(getCommentsMap(ydoc).get('c1')).toBeUndefined();
    expect(findCommentRange(editor, 'c1')).toBeNull();
    expect(editor.getHTML()).not.toContain('data-comment-id="c1"');
  });

  it('converges across two Y.Docs (collaboration): a comment made on A appears on B', () => {
    const ydocA = seededYDoc('shared text here');
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
    editor = makeEditor(ydocA);

    addComment(editor, ydocA, 'c1', 1, 7, 'A comments');
    // Propagate A's update to B (as the provider would).
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));

    expect(getCommentsMap(ydocB).get('c1')?.text).toBe('A comments');
  });

  it('excludes comment marks from exported document text', () => {
    // Guard at the editor level: the comment mark renders a span but carries no text,
    // and the export model ignores it (covered in shared/exportModel.test.ts).
    const ydoc = seededYDoc('exported words');
    editor = makeEditor(ydoc);
    addComment(editor, ydoc, 'c1', 1, 9, 'internal note');
    const json = JSON.stringify(editor.getJSON());
    // The note text lives only in the Yjs map, never in the document JSON.
    expect(json).not.toContain('internal note');
  });
});

describe('media command', () => {
  it('setMedia inserts a media node that references a mediaId (no binary in the doc)', () => {
    const ydoc = seededYDoc();
    editor = makeEditor(ydoc);
    editor
      .chain()
      .setMedia({ mediaId: 'abc-123', mime: 'image/png', width: 4, height: 3, alt: 'pic' })
      .run();

    let found: { mediaId: unknown } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'media') found = { mediaId: node.attrs.mediaId };
    });
    expect(found).not.toBeNull();
    expect(found!.mediaId).toBe('abc-123');
    // The document JSON holds only the reference — never base64/binary data.
    expect(JSON.stringify(editor.getJSON())).not.toContain('base64');
  });

  it('Backspace on a selected media node deletes it via the keymap', () => {
    const ydoc = seededYDoc('text');
    editor = makeEditor(ydoc);
    editor.chain().setMedia({ mediaId: 'abc-123', mime: 'image/png' }).run();
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'media') pos = p;
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    // Drive the actual key handler (not deleteSelection directly).
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor!.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
    );
    let stillThere = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'media') stillThere = true;
    });
    expect(stillThere).toBe(false);
  });

  it('a selected media node is deletable (NodeSelection + deleteSelection removes it)', () => {
    const ydoc = seededYDoc('text');
    editor = makeEditor(ydoc);
    editor.chain().setMedia({ mediaId: 'abc-123', mime: 'image/png' }).run();

    // Locate the media node and select it, then delete.
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'media') pos = p;
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    const ok = editor.commands.deleteSelection();
    expect(ok).toBe(true);

    let stillThere = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'media') stillThere = true;
    });
    expect(stillThere).toBe(false);
  });
});
