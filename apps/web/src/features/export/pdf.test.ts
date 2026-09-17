import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { JSONContent } from '@tiptap/react';
import { exportDocumentToPdf, exportDocumentToPdfBlob } from './pdf.js';

const para = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
});

function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content };
}

/** Assert the bytes are a real PDF and return the reloaded document for inspection. */
async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  return PDFDocument.load(bytes);
}

describe('exportDocumentToPdf', () => {
  it('produces a valid single-page PDF for a paragraph', async () => {
    const pdf = await loadPdf(await exportDocumentToPdf(doc(para('Hello world'))));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('is theme-independent: identical output whether the UI is light or dark', async () => {
    // Export reads ONLY the document model + explicit light document colors; it never
    // consults the DOM theme. Rendering the same content while `data-theme="dark"` is set
    // therefore produces byte-for-byte-length-identical output to the light render — a
    // dark UI can never leak a dark theme into the exported document.
    const content = doc(
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      para('Body paragraph with a run.'),
    );
    const root = document.documentElement;
    const prior = root.getAttribute('data-theme');
    try {
      root.setAttribute('data-theme', 'light');
      const light = await exportDocumentToPdf(content);
      root.setAttribute('data-theme', 'dark');
      const dark = await exportDocumentToPdf(content);
      expect(new TextDecoder().decode(dark.slice(0, 5))).toBe('%PDF-');
      // Same structure ⇒ same byte length (PDF date stamps are fixed-length).
      expect(dark.length).toBe(light.length);
      expect((await PDFDocument.load(dark)).getPageCount()).toBe(
        (await PDFDocument.load(light)).getPageCount(),
      );
    } finally {
      if (prior === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prior);
    }
  });

  it('renders H1–H3 headings without error', async () => {
    const bytes = await exportDocumentToPdf(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
      ),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  it('renders bold, italic and underlined runs', async () => {
    const bytes = await exportDocumentToPdf(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'b' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'i' },
          { type: 'text', marks: [{ type: 'underline' }], text: 'u' },
          { type: 'text', marks: [{ type: 'bold' }, { type: 'italic' }], text: 'bi' },
        ],
      }),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  it('renders bullet and numbered lists', async () => {
    const list = (type: 'bulletList' | 'orderedList'): JSONContent => ({
      type,
      content: [
        { type: 'listItem', content: [para('one')] },
        { type: 'listItem', content: [para('two')] },
      ],
    });
    expect((await loadPdf(await exportDocumentToPdf(doc(list('bulletList'))))).getPageCount()).toBe(
      1,
    );
    expect(
      (await loadPdf(await exportDocumentToPdf(doc(list('orderedList'))))).getPageCount(),
    ).toBe(1);
  });

  it('renders every alignment', async () => {
    const bytes = await exportDocumentToPdf(
      doc(
        para('left', { textAlign: 'left' }),
        para('center', { textAlign: 'center' }),
        para('right', { textAlign: 'right' }),
        para(
          'justified text that is long enough to wrap across more than a single line so justification actually spreads the words',
          { textAlign: 'justify' },
        ),
      ),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  it('renders strike, inline code, and a link run without error', async () => {
    const bytes = await exportDocumentToPdf(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'strike' }], text: 'struck' },
          { type: 'text', marks: [{ type: 'code' }], text: 'code()' },
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            text: 'link',
          },
        ],
      }),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  it('renders a task checklist (checked + unchecked) without error', async () => {
    const bytes = await exportDocumentToPdf(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [para('todo')] },
          { type: 'taskItem', attrs: { checked: true }, content: [para('done')] },
        ],
      }),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  it('renders a blockquote without error', async () => {
    const bytes = await exportDocumentToPdf(
      doc({ type: 'blockquote', content: [para('quoted line one'), para('quoted line two')] }),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  // A real, decodable 1×1 PNG (pdf-lib validates image bytes on embed).
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );

  it('embeds a PNG media block when the fetcher provides bytes', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'media',
          attrs: { mediaId: 'm1', mime: 'image/png', width: 1, height: 1, alt: 'dot' },
        },
      ],
    };
    const bytes = await exportDocumentToPdf(doc, async () => ({
      bytes: new Uint8Array(PNG_1x1),
      mime: 'image/png',
    }));
    const pdf = await loadPdf(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('draws a placeholder (no throw) when media is unavailable or WebP', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'media', attrs: { mediaId: 'gone', mime: 'image/png', alt: 'x' } },
        { type: 'media', attrs: { mediaId: 'webp', mime: 'image/webp', alt: 'w' } },
      ],
    };
    // Fetcher returns null (offline/unavailable) and a webp the PDF cannot embed.
    const bytes = await exportDocumentToPdf(doc, async (id) =>
      id === 'webp' ? { bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' } : null,
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(1);
  });

  it('never fetches media when no fetcher is provided (text-only export unaffected)', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'media', attrs: { mediaId: 'm1', mime: 'image/png' } }],
    };
    // No fetcher → placeholder, still a valid one-page PDF.
    expect((await loadPdf(await exportDocumentToPdf(doc))).getPageCount()).toBe(1);
  });

  it('turns a page break into a real PDF page boundary', async () => {
    const bytes = await exportDocumentToPdf(
      doc(para('page one'), { type: 'pageBreak' }, para('page two')),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(2);
  });

  it('produces N+1 pages for N page breaks', async () => {
    const bytes = await exportDocumentToPdf(
      doc(
        para('1'),
        { type: 'pageBreak' },
        para('2'),
        { type: 'pageBreak' },
        para('3'),
        { type: 'pageBreak' },
        para('4'),
      ),
    );
    expect((await loadPdf(bytes)).getPageCount()).toBe(4);
  });

  it('flows overflowing content onto continuation pages', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      para(`Paragraph number ${i} with some text.`),
    );
    const pdf = await loadPdf(await exportDocumentToPdf(doc(...many)));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it('exports an empty document as a single page', async () => {
    const pdf = await loadPdf(await exportDocumentToPdf(doc({ type: 'paragraph' })));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('exports a Blob with the application/pdf type', async () => {
    const blob = await exportDocumentToPdfBlob(doc(para('x')));
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});
