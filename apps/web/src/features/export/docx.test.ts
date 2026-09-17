import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Packer } from 'docx';
import type { JSONContent } from '@tiptap/react';
import { buildDocx, exportDocumentToDocxBlob } from './docx.js';

const para = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
});
function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content };
}

/** Build the .docx, assert it is a real OOXML zip, and return its main XML parts. */
async function render(json: JSONContent): Promise<{ document: string; numbering: string | null }> {
  const buffer = await Packer.toBuffer(buildDocx(json));
  // ZIP local-file-header signature "PK\x03\x04".
  expect(Array.from(buffer.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file('word/document.xml')!.async('string');
  const numberingFile = zip.file('word/numbering.xml');
  const numbering = numberingFile ? await numberingFile.async('string') : null;
  // The content types part must exist for Word to open it.
  expect(zip.file('[Content_Types].xml')).not.toBeNull();
  return { document, numbering };
}

describe('buildDocx', () => {
  it('emits a paragraph with its text', async () => {
    const { document } = await render(doc(para('Hello docx')));
    expect(document).toContain('Hello docx');
    expect(document).toContain('<w:p');
  });

  it('uses built-in Heading 1–3 styles', async () => {
    const { document } = await render(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'B' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'C' }] },
      ),
    );
    expect(document).toContain('Heading1');
    expect(document).toContain('Heading2');
    expect(document).toContain('Heading3');
  });

  it('marks bold, italic and underline at the run level', async () => {
    const { document } = await render(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'b' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'i' },
          { type: 'text', marks: [{ type: 'underline' }], text: 'u' },
        ],
      }),
    );
    expect(document).toMatch(/<w:b\b/);
    expect(document).toMatch(/<w:i\b/);
    expect(document).toMatch(/<w:u\b/);
  });

  it('renders a bullet list and a numbered list with numbering', async () => {
    const { document, numbering } = await render(
      doc(
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para('a')] },
            { type: 'listItem', content: [para('b')] },
          ],
        },
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [para('one')] }],
        },
      ),
    );
    // Both list kinds attach numbering properties (bullets use a bullet numbering).
    expect(document).toContain('<w:numPr>');
    expect(numbering).not.toBeNull();
    expect(numbering!).toContain('decimal');
  });

  it('applies paragraph alignment', async () => {
    const { document } = await render(
      doc(
        para('c', { textAlign: 'center' }),
        para('r', { textAlign: 'right' }),
        para('j', { textAlign: 'justify' }),
      ),
    );
    expect(document).toContain('w:val="center"');
    expect(document).toContain('w:val="right"');
    expect(document).toContain('w:val="both"'); // Word's name for justified
  });

  it('marks strikethrough and inline code (monospace font) at the run level', async () => {
    const { document } = await render(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'strike' }], text: 's' },
          { type: 'text', marks: [{ type: 'code' }], text: 'c' },
        ],
      }),
    );
    expect(document).toMatch(/<w:strike\b/);
    expect(document).toContain('Courier New');
  });

  it('creates a real external hyperlink for a linked run', async () => {
    const { document } = await render(
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            text: 'site',
          },
        ],
      }),
    );
    // docx emits an <w:hyperlink> backed by a relationship (r:id), and styles the run
    // with the built-in Hyperlink character style.
    expect(document).toContain('<w:hyperlink');
    expect(document).toContain('Hyperlink');
  });

  it('renders a task checklist with checkbox glyphs reflecting checked state', async () => {
    const { document } = await render(
      doc({
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [para('todo')],
          },
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [para('done')],
          },
        ],
      }),
    );
    expect(document).toContain('☐'); // unchecked
    expect(document).toContain('☑'); // checked
    expect(document).toContain('todo');
    expect(document).toContain('done');
  });

  it('renders a blockquote with an indent and a left border', async () => {
    const { document } = await render(
      doc({
        type: 'blockquote',
        content: [para('quoted text')],
      }),
    );
    expect(document).toContain('quoted text');
    expect(document).toContain('<w:ind');
    expect(document).toContain('<w:pBdr>'); // paragraph border (the quote rule)
  });

  it('embeds a PNG media block as an image (drawing element present)', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    );
    const media = new Map([['m1', { bytes: new Uint8Array(png), type: 'png' as const }]]);
    const buffer = await Packer.toBuffer(
      buildDocx(
        {
          type: 'doc',
          content: [
            { type: 'media', attrs: { mediaId: 'm1', mime: 'image/png', width: 1, height: 1 } },
          ],
        },
        media,
      ),
    );
    const zip = await JSZip.loadAsync(buffer);
    const document = await zip.file('word/document.xml')!.async('string');
    // A real embedded drawing (not a placeholder) references a media relationship.
    expect(document).toContain('<w:drawing>');
    // The image part is stored in the package.
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });

  it('renders a placeholder for unavailable/WebP media (no drawing, keeps alt text)', async () => {
    const { document } = await render(
      doc({ type: 'media', attrs: { mediaId: 'x', mime: 'image/webp', alt: 'a chart' } }),
    );
    expect(document).toContain('[Image: a chart]');
    expect(document).not.toContain('<w:drawing>');
  });

  it('emits a real page break at a page-break boundary', async () => {
    const { document } = await render(doc(para('one'), { type: 'pageBreak' }, para('two')));
    expect(document).toContain('w:type="page"');
    expect(document).not.toContain('pageBreak'); // never the literal node name
  });

  it('sets an A4 page size and margins in the section properties', async () => {
    const { document } = await render(doc(para('x')));
    // A4 width in twips derived from geometry (794px * 15) = 11910.
    expect(document).toContain('w:w="11910"');
    expect(document).toContain('<w:pgMar');
  });

  it('produces a valid single empty paragraph for an empty document', async () => {
    const { document } = await render(doc({ type: 'paragraph' }));
    expect(document).toContain('<w:p');
  });

  it('exports a Blob for download', async () => {
    const blob = await exportDocumentToDocxBlob(doc(para('x')));
    expect(blob.size).toBeGreaterThan(0);
  });
});
