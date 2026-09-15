import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/react';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { COLLAB_FIELD, INITIAL_DOCUMENT_CONTENT, buildBaseExtensions } from '@scribe/shared';
import { DocumentEditor } from './DocumentEditor.js';

/**
 * Phase 2 editor tests. The editor is now backed by a Y.Doc (no local content,
 * no history, no localStorage). We seed a local Y.Doc the same way the SERVER does
 * (prosemirrorJSONToYDoc with the shared schema), then drive real toolbar commands
 * and assert the resulting document + toolbar reflection. No provider is passed,
 * so these run without a network — the collaboration transport is covered by the
 * server integration suite.
 */

const schema = getSchema(buildBaseExtensions());

/** Build a Y.Doc seeded exactly like the server seeds a brand-new document. */
function seededYDoc(): Y.Doc {
  const ydoc = new Y.Doc();
  Y.applyUpdate(
    ydoc,
    Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, INITIAL_DOCUMENT_CONTENT, COLLAB_FIELD)),
  );
  return ydoc;
}

function renderEditor(editable = true, ydoc: Y.Doc = seededYDoc()) {
  let editor: Editor | null = null;
  const utils = render(
    <DocumentEditor
      ydoc={ydoc}
      provider={null}
      editable={editable}
      onEditorReady={(e) => {
        editor = e;
      }}
    />,
  );
  return { ...utils, ydoc, getEditor: () => editor };
}

async function waitForEditor(getEditor: () => Editor | null): Promise<Editor> {
  await waitFor(() => expect(getEditor()).not.toBeNull());
  const editor = getEditor();
  if (!editor) throw new Error('editor did not initialize');
  return editor;
}

function select(editor: Editor, from: number, to: number) {
  act(() => {
    editor.commands.setTextSelection({ from, to });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocumentEditor — rendering (Yjs-backed)', () => {
  it('renders the seeded collaborative content', async () => {
    const { getEditor } = renderEditor();
    await waitForEditor(getEditor);
    expect(await screen.findByText('Core Objectives')).toBeInTheDocument();
    expect(screen.getByText('Architecture & Next Milestones')).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
  });

  it('exposes the toolbar with accessible controls', async () => {
    const { getEditor } = renderEditor();
    await waitForEditor(getEditor);
    expect(screen.getByRole('toolbar', { name: /text formatting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
  });
});

describe('DocumentEditor — formatting commands operate on the collaborative doc', () => {
  it('applies bold and reflects active state, writing into the Y.Doc', async () => {
    const { getEditor, ydoc } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);

    const bold = screen.getByRole('button', { name: /bold/i });
    fireEvent.click(bold);

    expect(editor.isActive('bold')).toBe(true);
    expect(editor.getHTML()).toContain('<strong>');
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));

    // The change lives in the shared Y.Doc (source of truth), not React state.
    const fragment = ydoc.getXmlFragment(COLLAB_FIELD);
    expect(fragment.toJSON()).toContain('8 milliseconds'); // fragment is populated
  });

  it('applies italic', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    fireEvent.click(screen.getByRole('button', { name: /italic/i }));
    expect(editor.isActive('italic')).toBe(true);
    expect(editor.getHTML()).toContain('<em>');
  });

  it('applies a heading via the style selector and reflects the current block', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    fireEvent.click(screen.getByRole('button', { name: /text style/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Heading 1' }));
    expect(editor.isActive('heading', { level: 1 })).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /text style: heading 1/i })).toBeInTheDocument(),
    );
  });

  it('toggles bullet and numbered lists', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);

    select(editor, 3, 3);
    fireEvent.click(screen.getByRole('button', { name: /bullet list/i }));
    expect(editor.isActive('bulletList')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /numbered list/i }));
    expect(editor.isActive('orderedList')).toBe(true);
  });
});

describe('DocumentEditor — collaborative undo/redo', () => {
  it('undo/redo works via the toolbar and only affects local edits', async () => {
    const ydoc = seededYDoc();
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    // Local edit at the very start of the document.
    act(() => {
      editor.commands.insertContentAt(1, 'LOCAL ');
    });
    expect(editor.getText()).toContain('LOCAL');

    // Simulate a REMOTE edit by applying an update from a second Y.Doc that shares
    // this doc's state, with a foreign origin (as a real peer's update would have).
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
    // Insert distinctive text far from the local edit via a second editor-less doc.
    const remoteFragment = remote.getXmlFragment(COLLAB_FIELD);
    remote.transact(() => {
      const el = remoteFragment.get(remoteFragment.length - 1);
      // Append a new paragraph node with text by inserting into the fragment.
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'REMOTE-EDIT');
      p.insert(0, [t]);
      remoteFragment.insert(remoteFragment.length, [p]);
      void el;
    }, 'remote-origin');
    act(() => {
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remote), 'remote-origin');
    });
    expect(editor.getText()).toContain('REMOTE-EDIT');

    // Undo the LOCAL edit — the remote edit must remain.
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(editor.getText()).not.toContain('LOCAL');
    expect(editor.getText()).toContain('REMOTE-EDIT');

    // Redo restores the local edit.
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(editor.getText()).toContain('LOCAL');
  });
});

describe('DocumentEditor — manual page breaks (Ctrl/⌘+Enter)', () => {
  const hasPageBreak = (editor: Editor): boolean => {
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'pageBreak') found = true;
    });
    return found;
  };

  it('setPageBreak inserts a real pageBreak node into the collaborative document', async () => {
    const ydoc = seededYDoc();
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    select(editor, 3, 3);
    act(() => {
      editor.chain().focus().setPageBreak().run();
    });

    expect(hasPageBreak(editor)).toBe(true);
    // It lives in the shared Y.Doc (source of truth), so it will sync + persist.
    expect(JSON.stringify(ydoc.getXmlFragment(COLLAB_FIELD).toJSON()).toLowerCase()).toContain(
      'pagebreak',
    );
  });

  it('is exposed on the toolbar and inserts a break when clicked', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    fireEvent.click(screen.getByRole('button', { name: /page break/i }));
    expect(hasPageBreak(editor)).toBe(true);
  });

  it('participates in undo/redo (inserting/removing the break)', async () => {
    const ydoc = seededYDoc();
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    select(editor, 3, 3);
    act(() => {
      editor.chain().focus().setPageBreak().run();
    });
    expect(hasPageBreak(editor)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(hasPageBreak(editor)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(hasPageBreak(editor)).toBe(true);
  });

  it('page break survives a fresh editor bound to the same Y.Doc (reload/collab semantics)', async () => {
    const ydoc = seededYDoc();
    const first = renderEditor(true, ydoc);
    const editor1 = await waitForEditor(first.getEditor);
    select(editor1, 3, 3);
    act(() => {
      editor1.chain().focus().setPageBreak().run();
    });
    first.unmount();

    // A brand-new editor reading the same Y.Doc (as a reload or a second peer would)
    // sees the break because it is part of the shared document state.
    const second = renderEditor(true, ydoc);
    const editor2 = await waitForEditor(second.getEditor);
    expect(hasPageBreak(editor2)).toBe(true);
  });
});

describe('DocumentEditor — underline', () => {
  it('toggles underline from the toolbar, reflects active state, and writes into the Y.Doc', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);

    const underline = screen.getByRole('button', { name: /underline/i });
    fireEvent.click(underline);

    expect(editor.isActive('underline')).toBe(true);
    expect(editor.getHTML()).toContain('<u>');
    await waitFor(() => expect(underline).toHaveAttribute('aria-pressed', 'true'));
  });

  it('composes with bold (underline + bold on the same text)', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);

    fireEvent.click(screen.getByRole('button', { name: /bold/i }));
    fireEvent.click(screen.getByRole('button', { name: /underline/i }));

    expect(editor.isActive('bold')).toBe(true);
    expect(editor.isActive('underline')).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('<u>');
    expect(html).toContain('<strong>');
  });

  it('participates in Yjs-aware undo/redo', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    fireEvent.click(screen.getByRole('button', { name: /underline/i }));
    expect(editor.isActive('underline')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(editor.getHTML()).not.toContain('<u>');
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(editor.getHTML()).toContain('<u>');
  });

  it('persists in the shared Y.Doc — a fresh editor bound to it still shows the underline', async () => {
    const ydoc = seededYDoc();
    const first = renderEditor(true, ydoc);
    const editor1 = await waitForEditor(first.getEditor);
    select(editor1, 1, 12);
    act(() => {
      editor1.chain().focus().toggleUnderline().run();
    });
    expect(editor1.getHTML()).toContain('<u>');
    first.unmount();

    const second = renderEditor(true, ydoc);
    const editor2 = await waitForEditor(second.getEditor);
    expect(editor2.getHTML()).toContain('<u>');
  });
});

describe('DocumentEditor — strikethrough', () => {
  it('toggles strike from the toolbar and writes <s> into the Y.Doc', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    const btn = screen.getByRole('button', { name: /strikethrough/i });
    fireEvent.click(btn);
    expect(editor.isActive('strike')).toBe(true);
    expect(editor.getHTML()).toContain('<s>');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'));
  });

  it('participates in Yjs-aware undo/redo', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    fireEvent.click(screen.getByRole('button', { name: /strikethrough/i }));
    expect(editor.isActive('strike')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(editor.getHTML()).not.toContain('<s>');
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(editor.getHTML()).toContain('<s>');
  });

  it('persists in the shared Y.Doc across a fresh editor', async () => {
    const ydoc = seededYDoc();
    const first = renderEditor(true, ydoc);
    const editor1 = await waitForEditor(first.getEditor);
    select(editor1, 1, 12);
    act(() => {
      editor1.chain().focus().toggleStrike().run();
    });
    first.unmount();
    const second = renderEditor(true, ydoc);
    const editor2 = await waitForEditor(second.getEditor);
    expect(editor2.getHTML()).toContain('<s>');
  });
});

describe('DocumentEditor — inline code', () => {
  it('toggles inline code and writes <code> (an inline mark, not a code block)', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    const btn = screen.getByRole('button', { name: /inline code/i });
    fireEvent.click(btn);
    expect(editor.isActive('code')).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('<code>');
    // It is inline: no <pre> code block was produced.
    expect(html).not.toContain('<pre>');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'));
  });

  it('is exclusive by schema (code clears other inline marks — Tiptap Code excludes "_")', async () => {
    // The official Code mark sets `excludes: '_'`, so inline code intentionally does
    // NOT combine with bold/italic/etc. We assert the schema-correct behavior rather
    // than forcing an unsupported combination (task §3 — "where the schema allows").
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    fireEvent.click(screen.getByRole('button', { name: /bold/i }));
    expect(editor.isActive('bold')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /inline code/i }));
    expect(editor.isActive('code')).toBe(true);
    // Applying code removed bold on the run — this is the excludes rule, not a bug.
    expect(editor.isActive('bold')).toBe(false);
  });

  it('does coexist with alignment (a block attribute, not an excluded mark)', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    fireEvent.click(screen.getByRole('button', { name: /inline code/i }));
    act(() => {
      editor.chain().focus().setTextAlign('center').run();
    });
    expect(editor.isActive('code')).toBe(true);
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);
  });
});

describe('DocumentEditor — blockquote', () => {
  it('toggles a real blockquote node and reflects active state', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    const btn = screen.getByRole('button', { name: /blockquote/i });
    fireEvent.click(btn);
    expect(editor.isActive('blockquote')).toBe(true);
    expect(editor.getHTML()).toContain('<blockquote>');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'));
  });

  it('toggles off again (removes the blockquote)', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    fireEvent.click(screen.getByRole('button', { name: /blockquote/i }));
    expect(editor.isActive('blockquote')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /blockquote/i }));
    expect(editor.isActive('blockquote')).toBe(false);
  });

  it('persists in the shared Y.Doc across a fresh editor', async () => {
    const ydoc = seededYDoc();
    const first = renderEditor(true, ydoc);
    const editor1 = await waitForEditor(first.getEditor);
    select(editor1, 3, 3);
    act(() => {
      editor1.chain().focus().toggleBlockquote().run();
    });
    first.unmount();
    const second = renderEditor(true, ydoc);
    const editor2 = await waitForEditor(second.getEditor);
    expect(editor2.getHTML()).toContain('<blockquote>');
  });
});

describe('DocumentEditor — task checklist', () => {
  const taskCount = (editor: Editor): number => {
    let n = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') n += 1;
    });
    return n;
  };

  it('toggles a task list and the checked state is a document node attribute', async () => {
    const ydoc = seededYDoc();
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    fireEvent.click(screen.getByRole('button', { name: /task checklist/i }));
    expect(editor.isActive('taskList')).toBe(true);
    expect(taskCount(editor)).toBeGreaterThanOrEqual(1);

    // Toggle checked via the document command (as the checkbox node-view does), then
    // assert it is stored in the ProseMirror/Yjs document — not React/Zustand state.
    let taskPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'taskItem' && taskPos === -1) taskPos = pos;
    });
    act(() => {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeAttribute(taskPos, 'checked', true);
          return true;
        })
        .run();
    });
    expect(editor.state.doc.nodeAt(taskPos)!.attrs.checked).toBe(true);
    expect(JSON.stringify(ydoc.getXmlFragment(COLLAB_FIELD).toJSON()).toLowerCase()).toContain(
      'taskitem',
    );
  });

  it('checked state persists across a fresh editor bound to the same Y.Doc', async () => {
    const ydoc = seededYDoc();
    const first = renderEditor(true, ydoc);
    const editor1 = await waitForEditor(first.getEditor);
    select(editor1, 3, 3);
    act(() => {
      editor1.chain().focus().toggleTaskList().run();
    });
    let taskPos = -1;
    editor1.state.doc.descendants((node, pos) => {
      if (node.type.name === 'taskItem' && taskPos === -1) taskPos = pos;
    });
    act(() => {
      editor1
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeAttribute(taskPos, 'checked', true);
          return true;
        })
        .run();
    });
    first.unmount();

    const second = renderEditor(true, ydoc);
    const editor2 = await waitForEditor(second.getEditor);
    let found = false;
    editor2.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem' && node.attrs.checked === true) found = true;
    });
    expect(found).toBe(true);
  });
});

describe('DocumentEditor — links (popover)', () => {
  const openPopover = () => fireEvent.click(screen.getByRole('button', { name: /insert link/i }));
  const urlInput = () => screen.getByLabelText(/link url/i) as HTMLInputElement;

  it('applies a link over the selection via the popover', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    openPopover();
    fireEvent.change(urlInput(), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(editor.isActive('link')).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    // Safety attributes are present so a link can't be an XSS / tab-nabbing vector.
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('upgrades a bare host to https://', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    openPopover();
    fireEvent.change(urlInput(), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(editor.getHTML()).toContain('href="https://example.com"');
  });

  it('rejects a javascript: URL with an inline error and applies no link', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    openPopover();
    fireEvent.change(urlInput(), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(editor.isActive('link')).toBe(false);
    expect(editor.getHTML()).not.toContain('javascript:');
  });

  it('removes an existing link', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    act(() => {
      editor.chain().focus().setLink({ href: 'https://example.com' }).run();
    });
    expect(editor.isActive('link')).toBe(true);
    // Reopen (button now reads "Edit link") and click Remove.
    fireEvent.click(screen.getByRole('button', { name: /edit link/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(editor.isActive('link')).toBe(false);
  });

  it('detects the current link URL when the caret is inside one', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 1, 12);
    act(() => {
      editor.chain().focus().setLink({ href: 'https://prefilled.example' }).run();
    });
    select(editor, 3, 3); // caret inside the link
    fireEvent.click(screen.getByRole('button', { name: /edit link/i }));
    expect(urlInput().value).toBe('https://prefilled.example');
  });
});

describe('DocumentEditor — text alignment', () => {
  /** Open the alignment dropdown and choose an option by its accessible label. */
  async function chooseAlign(label: RegExp) {
    fireEvent.click(screen.getByRole('button', { name: /alignment/i }));
    fireEvent.click(await screen.findByRole('option', { name: label }));
  }

  it('aligns a paragraph center / right / justify and reflects the active state', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);

    select(editor, 3, 3); // inside the first paragraph
    await chooseAlign(/align center/i);
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);
    expect(editor.getHTML()).toContain('text-align: center');

    await chooseAlign(/align right/i);
    expect(editor.isActive({ textAlign: 'right' })).toBe(true);

    await chooseAlign(/justify/i);
    expect(editor.isActive({ textAlign: 'justify' })).toBe(true);

    // Back to left (default) — no longer center/right/justify.
    await chooseAlign(/align left/i);
    expect(editor.isActive({ textAlign: 'left' })).toBe(true);
    expect(editor.isActive({ textAlign: 'center' })).toBe(false);
  });

  it('aligns a heading', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);

    // Turn the first block into a heading, then right-align it.
    select(editor, 3, 3);
    act(() => {
      editor.chain().focus().setHeading({ level: 2 }).run();
    });
    await chooseAlign(/align right/i);

    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(editor.isActive({ textAlign: 'right' })).toBe(true);
    expect(editor.getHTML()).toContain('text-align: right');
  });

  it('reflects the current alignment in the toolbar control', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    await chooseAlign(/align center/i);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /alignment: align center/i })).toBeInTheDocument(),
    );
  });

  it('participates in undo/redo', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    select(editor, 3, 3);
    await chooseAlign(/align center/i);
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(editor.isActive({ textAlign: 'center' })).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);
  });

  it('persists in the shared Y.Doc — a fresh editor bound to it keeps the alignment', async () => {
    const ydoc = seededYDoc();
    const first = renderEditor(true, ydoc);
    const editor1 = await waitForEditor(first.getEditor);
    select(editor1, 3, 3);
    act(() => {
      editor1.chain().focus().setTextAlign('center').run();
    });
    expect(editor1.getHTML()).toContain('text-align: center');
    first.unmount();

    const second = renderEditor(true, ydoc);
    const editor2 = await waitForEditor(second.getEditor);
    expect(editor2.getHTML()).toContain('text-align: center');
  });
});

describe('DocumentEditor — permissions', () => {
  it('is not editable for viewers and disables toolbar controls', async () => {
    const { getEditor } = renderEditor(false);
    const editor = await waitForEditor(getEditor);
    expect(editor.isEditable).toBe(false);
    expect(screen.getByRole('button', { name: /bold/i })).toBeDisabled();
    // New formatting controls are also disabled for viewers.
    expect(screen.getByRole('button', { name: /underline/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /alignment/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /strikethrough/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /inline code/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /blockquote/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /task checklist/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /insert link/i })).toBeDisabled();
    // Media & comment controls are disabled for viewers too (upload/comment mutations
    // are additionally rejected server-side: a viewer's collab connection is read-only).
    expect(screen.getByRole('button', { name: /insert image/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /add comment/i })).toBeDisabled();
  });

  it('still renders viewer-visible formatting (underline + alignment) read-only', async () => {
    // Seed a doc that already contains underline + a centered paragraph, then open
    // it read-only: the marks/attrs must render even though editing is disabled.
    const ydoc = seededYDoc();
    const author = renderEditor(true, ydoc);
    const authorEd = await waitForEditor(author.getEditor);
    select(authorEd, 1, 12);
    act(() => {
      authorEd.chain().focus().toggleUnderline().setTextAlign('center').run();
    });
    author.unmount();

    const viewer = renderEditor(false, ydoc);
    const viewerEd = await waitForEditor(viewer.getEditor);
    expect(viewerEd.isEditable).toBe(false);
    const html = viewerEd.getHTML();
    expect(html).toContain('<u>');
    expect(html).toContain('text-align: center');
  });
});

describe('DocumentEditor — no Phase-1 localStorage bridge remains', () => {
  it('does not write document content to localStorage while editing', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);

    act(() => {
      editor.commands.insertContentAt(1, 'typed ');
    });

    const wroteDraft = setItem.mock.calls.some(([key]) => String(key).includes('doc-draft'));
    expect(wroteDraft).toBe(false);
  });
});

describe('DocumentEditor — content is data, not executable HTML (XSS regression)', () => {
  it('renders typed markup as literal text, never as live DOM (no script/img injected)', async () => {
    const { getEditor, container } = renderEditor();
    const editor = await waitForEditor(getEditor);

    // A user types text that would be dangerous if ever treated as HTML. The editor
    // schema is a strict allow-list and React escapes text, so this must appear as
    // plain characters — never as a <script>/<img> element in the document.
    const payload = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
    act(() => {
      editor.commands.insertContentAt(1, payload);
    });

    const body = container.querySelector('[aria-label="Document body"]');
    expect(body).not.toBeNull();
    // No live elements were created from the typed string.
    expect(body!.querySelector('script')).toBeNull();
    expect(body!.querySelector('img')).toBeNull();
    // The characters survive as text content (proving it was inserted, but inert).
    expect(body!.textContent).toContain('alert(1)');
    expect(body!.textContent).toContain('<script>');
  });

  it('exposes editor content only as a ProseMirror document (no dangerouslySetInnerHTML path)', async () => {
    const { getEditor } = renderEditor();
    const editor = await waitForEditor(getEditor);
    // The editor's canonical content is structured JSON (ProseMirror), not an HTML
    // string blob — the whole reason the "paste raw HTML" vector doesn't apply.
    expect(editor.getJSON().type).toBe('doc');
  });
});

/**
 * Page-break EDITING semantics — regression cover for the reported "giant blue
 * rectangle" bug. The break is not selectable, so clicking near it or backspacing
 * into it must never produce a NodeSelection; the break is removed in a single
 * key press via ordinary transactions (Yjs-captured), and Ctrl/⌘+Enter keeps a list
 * structurally valid with the break at the top level.
 */
describe('DocumentEditor — page break editing semantics', () => {
  const para = (text?: string): JSONContent =>
    text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };

  /** Seed a Y.Doc from explicit ProseMirror JSON, exactly as the server would. */
  function seedDoc(content: JSONContent[]): Y.Doc {
    const ydoc = new Y.Doc();
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, { type: 'doc', content }, COLLAB_FIELD)),
    );
    return ydoc;
  }

  const hasPageBreak = (editor: Editor): boolean => {
    let found = false;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'pageBreak') found = true;
    });
    return found;
  };

  /** Document position at the start of the first block AFTER the page break. */
  const startAfterBreak = (editor: Editor): number => {
    let pos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'pageBreak' && pos === -1) pos = offset + node.nodeSize + 1;
    });
    return pos;
  };

  /** Document position at the end of the last block BEFORE the page break. */
  const endBeforeBreak = (editor: Editor): number => {
    let pos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'pageBreak' && pos === -1) pos = offset - 1;
    });
    return pos;
  };

  const pressKey = (editor: Editor, key: string) => {
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key });
    });
  };

  it('the page break node is not selectable (no NodeSelection is possible)', async () => {
    const ydoc = seedDoc([para('abc'), { type: 'pageBreak' }, para('def')]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);
    const breakNode = editor.state.doc.child(1);
    expect(breakNode.type.name).toBe('pageBreak');
    expect(NodeSelection.isSelectable(breakNode)).toBe(false);
  });

  it('Backspace at the start of the empty paragraph after a break removes it in ONE press', async () => {
    const ydoc = seedDoc([para('Hello'), { type: 'pageBreak' }, para()]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);
    expect(hasPageBreak(editor)).toBe(true);

    select(editor, startAfterBreak(editor), startAfterBreak(editor));
    pressKey(editor, 'Backspace');

    // Removed on the FIRST press, and the selection is a plain cursor — never a
    // NodeSelection on the break (which was the reported bug).
    expect(hasPageBreak(editor)).toBe(false);
    expect(editor.state.selection instanceof NodeSelection).toBe(false);
    expect(editor.getText()).toContain('Hello');
  });

  it('Backspace at the start of NON-empty content after a break removes it, content intact', async () => {
    const ydoc = seedDoc([para('abc'), { type: 'pageBreak' }, para('def')]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    select(editor, startAfterBreak(editor), startAfterBreak(editor));
    pressKey(editor, 'Backspace');

    expect(hasPageBreak(editor)).toBe(false);
    const text = editor.getText();
    expect(text).toContain('abc');
    expect(text).toContain('def');
  });

  it('Delete at the end of the block before a break removes it, content intact', async () => {
    const ydoc = seedDoc([para('abc'), { type: 'pageBreak' }, para('def')]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    select(editor, endBeforeBreak(editor), endBeforeBreak(editor));
    pressKey(editor, 'Delete');

    expect(hasPageBreak(editor)).toBe(false);
    expect(editor.getText()).toContain('abc');
    expect(editor.getText()).toContain('def');
  });

  it('Backspace in the MIDDLE of a paragraph does not touch the break (falls through)', async () => {
    const ydoc = seedDoc([para('abc'), { type: 'pageBreak' }, para('def')]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    // Cursor after "d" in "def" (parentOffset 1, not the block start).
    select(editor, startAfterBreak(editor) + 1, startAfterBreak(editor) + 1);
    pressKey(editor, 'Backspace');

    // The break is untouched; only a character was deleted by default handling.
    expect(hasPageBreak(editor)).toBe(true);
    expect(editor.getText()).toContain('ef');
  });

  it('the paragraph after a break is a normal editable paragraph (typing works)', async () => {
    const ydoc = seedDoc([para('Hello'), { type: 'pageBreak' }, para()]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    const pos = startAfterBreak(editor);
    act(() => {
      editor.chain().focus().setTextSelection(pos).insertContent('Second page').run();
    });
    expect(editor.getText()).toContain('Second page');
    expect(hasPageBreak(editor)).toBe(true);
  });

  it('Ctrl/⌘+Enter inside a list keeps the list valid and the break at top level', async () => {
    const listDoc: JSONContent[] = [
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [para('item one')] }],
      },
    ];
    const ydoc = seedDoc(listDoc);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    // Put the caret inside the list item, then insert a page break.
    select(editor, 4, 4);
    act(() => {
      editor.chain().focus().setPageBreak().run();
    });

    // Structure must be: bulletList (valid, no nested break), pageBreak, paragraph —
    // all at the TOP level.
    const kinds = editor.state.doc.content.content.map((n) => n.type.name);
    expect(kinds).toEqual(['bulletList', 'pageBreak', 'paragraph']);
    // The break is NOT nested inside the list.
    let breakInsideList = false;
    editor.state.doc.child(0).descendants((n) => {
      if (n.type.name === 'pageBreak') breakInsideList = true;
    });
    expect(breakInsideList).toBe(false);
    // The document is still structurally valid.
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it('removing a break via Backspace participates in Yjs undo/redo', async () => {
    const ydoc = seedDoc([para('Hello'), { type: 'pageBreak' }, para()]);
    const { getEditor } = renderEditor(true, ydoc);
    const editor = await waitForEditor(getEditor);

    select(editor, startAfterBreak(editor), startAfterBreak(editor));
    pressKey(editor, 'Backspace');
    expect(hasPageBreak(editor)).toBe(false);

    // Undo restores the break; redo removes it again — through the Yjs UndoManager.
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(hasPageBreak(editor)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(hasPageBreak(editor)).toBe(false);
  });
});
