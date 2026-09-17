import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import {
  isListBlock,
  isMediaBlock,
  isQuoteBlock,
  isTaskListBlock,
  isTextBlock,
  sanitizeFilename,
  toExportDocument,
  type ExportListBlock,
  type ExportMediaBlock,
  type ExportQuoteBlock,
  type ExportTaskListBlock,
  type ExportTextBlock,
} from './exportModel.js';

/** Deep-freeze so any accidental mutation during transform throws in strict mode. */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

describe('toExportDocument', () => {
  it('maps a paragraph with bold/italic/underline runs', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'b' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'i' },
            { type: 'text', marks: [{ type: 'underline' }], text: 'u' },
          ],
        },
      ],
    };
    const model = toExportDocument(doc);
    expect(model.pages).toHaveLength(1);
    const block = model.pages[0]!.blocks[0] as ExportTextBlock;
    expect(block.type).toBe('paragraph');
    expect(block.runs).toEqual([
      { text: 'plain ' },
      { text: 'b', bold: true },
      { text: 'i', italic: true },
      { text: 'u', underline: true },
    ]);
  });

  it('maps strike, inline code, and safe link marks onto runs', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'strike' }], text: 's' },
            { type: 'text', marks: [{ type: 'code' }], text: 'c' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
              text: 'l',
            },
          ],
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportTextBlock;
    expect(block.runs).toEqual([
      { text: 's', strike: true },
      { text: 'c', code: true },
      { text: 'l', href: 'https://example.com' },
    ]);
  });

  it('drops an unsafe link href (fail-closed against a dangerous scheme)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              text: 'x',
            },
          ],
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportTextBlock;
    expect(block.runs[0]!.href).toBeUndefined();
  });

  it('maps a task list preserving each item text and checked state', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
            },
          ],
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportTaskListBlock;
    expect(isTaskListBlock(block)).toBe(true);
    expect(block.items).toHaveLength(2);
    expect(block.items[0]).toMatchObject({ checked: false });
    expect(block.items[0]!.runs[0]!.text).toBe('todo');
    expect(block.items[1]).toMatchObject({ checked: true });
    expect(block.items[1]!.runs[0]!.text).toBe('done');
  });

  it('maps a media node to a media block reference (never a binary)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'media',
          attrs: {
            mediaId: '00000000-0000-4000-8000-000000000000',
            mime: 'image/png',
            width: 12,
            height: 9,
            alt: 'diagram',
          },
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportMediaBlock;
    expect(isMediaBlock(block)).toBe(true);
    expect(block).toEqual({
      type: 'media',
      mediaId: '00000000-0000-4000-8000-000000000000',
      mime: 'image/png',
      width: 12,
      height: 9,
      alt: 'diagram',
      align: 'center',
    });
  });

  it('skips a media node with no mediaId (never a dangling reference)', () => {
    const doc: JSONContent = { type: 'doc', content: [{ type: 'media', attrs: {} }] };
    expect(toExportDocument(doc).pages[0]!.blocks).toHaveLength(0);
  });

  it('does NOT leak inline comments into exported runs (comments are excluded)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'comment', attrs: { commentId: 'c1' } }],
              text: 'visible text',
            },
          ],
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportTextBlock;
    // The text is preserved, but the run carries NO comment metadata of any kind.
    expect(block.runs).toEqual([{ text: 'visible text' }]);
    expect(JSON.stringify(toExportDocument(doc))).not.toContain('commentId');
  });

  it('maps a blockquote into its contained paragraphs', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
            {
              type: 'paragraph',
              attrs: { textAlign: 'right' },
              content: [{ type: 'text', text: 'second' }],
            },
          ],
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportQuoteBlock;
    expect(isQuoteBlock(block)).toBe(true);
    expect(block.paragraphs).toHaveLength(2);
    expect(block.paragraphs[0]!.runs[0]!.text).toBe('first');
    expect(block.paragraphs[1]!.align).toBe('right');
  });

  it('maps headings H1–H3 with their levels and alignment', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] },
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [{ type: 'text', text: 'B' }],
        },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'C' }] },
      ],
    };
    const blocks = toExportDocument(doc).pages[0]!.blocks as ExportTextBlock[];
    expect(blocks.map((b) => b.level)).toEqual([1, 2, 3]);
    expect(blocks[1]!.align).toBe('center');
  });

  it('captures each alignment value and defaults to left', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'l' }] },
        {
          type: 'paragraph',
          attrs: { textAlign: 'right' },
          content: [{ type: 'text', text: 'r' }],
        },
        {
          type: 'paragraph',
          attrs: { textAlign: 'justify' },
          content: [{ type: 'text', text: 'j' }],
        },
      ],
    };
    const blocks = toExportDocument(doc).pages[0]!.blocks as ExportTextBlock[];
    expect(blocks.map((b) => b.align)).toEqual(['left', 'right', 'justify']);
  });

  it('maps bullet and numbered lists to items', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
          ],
        },
      ],
    };
    const [bullet, ordered] = toExportDocument(doc).pages[0]!.blocks as ExportListBlock[];
    expect(bullet!.type).toBe('bulletList');
    expect(bullet!.items).toHaveLength(2);
    expect(bullet!.items[0]!.runs[0]!.text).toBe('a');
    expect(ordered!.type).toBe('orderedList');
    expect(ordered!.items[0]!.runs[0]!.text).toBe('one');
  });

  it('splits into a new page at every pageBreak node', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'p1' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'p2' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'p3' }] },
      ],
    };
    const model = toExportDocument(doc);
    expect(model.pages).toHaveLength(3);
    expect((model.pages[2]!.blocks[0] as ExportTextBlock).runs[0]!.text).toBe('p3');
  });

  it('never emits the literal text "pageBreak"', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      ],
    };
    const json = JSON.stringify(toExportDocument(doc));
    expect(json).not.toContain('pageBreak');
  });

  it('turns hardBreak into a newline inside a run', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line2' },
          ],
        },
      ],
    };
    const block = toExportDocument(doc).pages[0]!.blocks[0] as ExportTextBlock;
    expect(block.runs.map((r) => r.text)).toEqual(['line1', '\n', 'line2']);
  });

  it('yields one empty page for an empty document', () => {
    const model = toExportDocument({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(model.pages).toHaveLength(1);
    const block = model.pages[0]!.blocks[0] as ExportTextBlock;
    expect(block.type).toBe('paragraph');
    expect(block.runs).toEqual([]);
  });

  it('handles null/undefined content defensively', () => {
    expect(toExportDocument(null).pages).toHaveLength(1);
    expect(toExportDocument(undefined).pages[0]!.blocks).toEqual([]);
  });

  it('does not mutate its input', () => {
    const doc: JSONContent = deepFreeze({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'x' }] },
      ],
    });
    const clone = structuredClone(doc);
    expect(() => toExportDocument(doc)).not.toThrow();
    expect(doc).toEqual(clone);
  });
});

describe('type guards', () => {
  it('isListBlock / isTextBlock partition the block union', () => {
    const text: ExportTextBlock = { type: 'paragraph', align: 'left', indent: 0, runs: [] };
    const list: ExportListBlock = { type: 'bulletList', items: [] };
    expect(isTextBlock(text)).toBe(true);
    expect(isListBlock(text)).toBe(false);
    expect(isListBlock(list)).toBe(true);
    expect(isTextBlock(list)).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it('keeps ordinary titles unchanged', () => {
    expect(sanitizeFilename('Meeting Notes')).toBe('Meeting Notes');
    expect(sanitizeFilename('Untitled document')).toBe('Untitled document');
  });

  it('removes filesystem-illegal characters', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
  });

  it('neutralizes path traversal and strips leading/trailing dots', () => {
    // Slashes become spaces, so the result can never be a path or a `..` traversal.
    const traversal = sanitizeFilename('../../etc/passwd');
    expect(traversal).not.toContain('/');
    expect(traversal).not.toContain('\\');
    expect(traversal.startsWith('.')).toBe(false);
    expect(traversal).toContain('etc passwd');
    expect(sanitizeFilename('...hidden...')).toBe('hidden');
    expect(sanitizeFilename('/absolute/path')).toBe('absolute path');
  });

  it('collapses whitespace and control characters', () => {
    expect(sanitizeFilename('  spaced\t\tout \n')).toBe('spaced out');
    expect(sanitizeFilename('bellbell')).toBe('bellbell');
  });

  it('falls back to "document" when nothing usable remains', () => {
    expect(sanitizeFilename('')).toBe('document');
    expect(sanitizeFilename('   ')).toBe('document');
    expect(sanitizeFilename('///')).toBe('document');
    expect(sanitizeFilename(null)).toBe('document');
    expect(sanitizeFilename('...')).toBe('document');
  });

  it('caps very long titles', () => {
    expect(sanitizeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});
