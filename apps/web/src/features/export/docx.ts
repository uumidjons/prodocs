import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import {
  type ExportAlign,
  type ExportBlock,
  type ExportMediaBlock,
  type ExportMediaFetcher,
  type ExportRun,
  isMediaBlock,
  isQuoteBlock,
  isTaskListBlock,
  isTextBlock,
  toExportDocument,
} from '@scribe/shared';
import type { JSONContent } from '@tiptap/react';
import { PAGE_HEIGHT, PAGE_MARGIN_X, PAGE_MARGIN_Y, PAGE_WIDTH } from '../editor/pageGeometry.js';

/**
 * DOCX EXPORT — renders the export model to a real Office Open XML `.docx` with the
 * `docx` library (a mature, well-typed generator), never renamed HTML (task §7).
 *
 * The document uses Word's built-in Heading 1–3 styles for the heading hierarchy,
 * real bullet/decimal numbering for lists, run-level bold/italic/underline, paragraph
 * alignment, and a genuine page break (`PageBreak`) at every logical page boundary.
 * The single section carries A4 page size and margins derived from the editor's own
 * A4 geometry (pageGeometry.ts) — the same numbers the PDF path uses.
 *
 * Pure output: takes a read-only ProseMirror JSON snapshot and returns a document /
 * bytes. It never touches the editor, the Y.Doc, or the schema.
 */

// CSS px @96dpi → twips (1/1440 inch): 1px = 15 twips. Reuses the editor's geometry.
const PX_TO_TWIP = 15;
const ORDERED_REF = 'scribe-ordered';

const ALIGN: Record<ExportAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const HEADING_LEVEL: Record<1 | 2 | 3, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

/** Build the TextRuns for one styled run, turning `\n` into real in-run line breaks. */
function textRunsForRun(run: ExportRun, isLink: boolean): TextRun[] {
  const segments = (run.text ?? '').split('\n');
  return segments.map(
    (segment, i) =>
      new TextRun({
        text: segment,
        bold: run.bold,
        italics: run.italic,
        underline: run.underline ? {} : undefined,
        strike: run.strike || undefined,
        // Inline code → real monospace formatting (task §10), never unsafe HTML.
        font: run.code ? 'Courier New' : undefined,
        // Word's built-in Hyperlink character style (blue + underline) for links.
        style: isLink ? 'Hyperlink' : undefined,
        // A leading break on every segment after the first reproduces the hard break.
        break: i > 0 ? 1 : undefined,
      }),
  );
}

/**
 * Convert styled runs to Word paragraph children. A run carrying a (safe) `href` is
 * wrapped in a real `ExternalHyperlink` so the DOCX contains a genuine clickable
 * hyperlink (task §10); other runs become plain TextRuns.
 */
function toParagraphChildren(runs: ExportRun[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const run of runs) {
    if (run.href) {
      out.push(new ExternalHyperlink({ link: run.href, children: textRunsForRun(run, true) }));
    } else {
      out.push(...textRunsForRun(run, false));
    }
  }
  return out;
}

/** Resolved image bytes for embedding, keyed by media id (png/jpeg only). */
export type DocxMediaMap = Map<string, { bytes: Uint8Array; type: 'png' | 'jpg' }>;

/** State passed through block rendering so each ordered list gets a fresh count. */
interface DocxContext {
  orderedInstance: number;
  media: DocxMediaMap;
}

/** px content width (A4 minus L/R margins) — the max display width for an image. */
const CONTENT_PX = PAGE_WIDTH - 2 * PAGE_MARGIN_X;

/** One media block → an embedded image paragraph, or a labeled placeholder. */
function mediaParagraph(block: ExportMediaBlock, media: DocxMediaMap): Paragraph {
  const img = media.get(block.mediaId);
  if (img) {
    // Scale intrinsic dimensions (server-sniffed hints) down to the content width.
    const iw = block.width && block.width > 0 ? block.width : CONTENT_PX;
    const ih = block.height && block.height > 0 ? block.height : Math.round(iw * 0.75);
    const scale = Math.min(1, CONTENT_PX / iw);
    return new Paragraph({
      // Alignment from the document's media align (wrap layouts collapse to their side).
      alignment: ALIGN[block.align],
      children: [
        new ImageRun({
          data: img.bytes,
          type: img.type,
          transformation: { width: Math.round(iw * scale), height: Math.round(ih * scale) },
        }),
      ],
    });
  }
  // Placeholder: real text, never a broken reference (WebP/offline/unavailable).
  return new Paragraph({
    alignment: ALIGN[block.align],
    children: [
      new TextRun({
        text: block.alt ? `[Image: ${block.alt}]` : '[Image unavailable in export]',
        italics: true,
        color: '888888',
      }),
    ],
  });
}

/** Twips of left indent per `indent` level (task §B), mirroring the editor's margin. */
const INDENT_TWIPS_PER_LEVEL = 480;

/** Render one export block into one or more Word paragraphs. */
function blockToParagraphs(block: ExportBlock, ctx: DocxContext): Paragraph[] {
  if (isTextBlock(block)) {
    const level = Math.max(0, Math.min(10, block.indent ?? 0));
    const indent = level > 0 ? { left: level * INDENT_TWIPS_PER_LEVEL } : undefined;
    if (block.type === 'heading') {
      const opts: IParagraphOptions = {
        heading: block.level ? HEADING_LEVEL[block.level] : HeadingLevel.HEADING_1,
        alignment: ALIGN[block.align],
        ...(indent ? { indent } : {}),
        children: toParagraphChildren(block.runs),
      };
      return [new Paragraph(opts)];
    }
    return [
      new Paragraph({
        alignment: ALIGN[block.align],
        ...(indent ? { indent } : {}),
        children: toParagraphChildren(block.runs),
      }),
    ];
  }

  if (isQuoteBlock(block)) {
    // Blockquote → indented paragraphs with a left border rule (a real Word quote
    // look, not renamed HTML). Body runs are italicized to read as quoted prose.
    return block.paragraphs.map(
      (para) =>
        new Paragraph({
          alignment: ALIGN[para.align],
          indent: { left: 480 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 18, space: 12, color: '3B49DF' },
          },
          children: toParagraphChildren(
            para.runs.map((r) => (r.code ? r : { ...r, italic: true })),
          ),
        }),
    );
  }

  if (isMediaBlock(block)) {
    return [mediaParagraph(block, ctx.media)];
  }

  if (isTaskListBlock(block)) {
    // Task checklist → each item prefixed with a real checkbox glyph reflecting the
    // document `checked` state (task §10). Word renders ☐/☑ natively (UTF-8 XML).
    return block.items.map(
      (item) =>
        new Paragraph({
          alignment: ALIGN[item.align],
          indent: { left: 360 },
          children: [
            new TextRun({ text: item.checked ? '☑ ' : '☐ ' }),
            ...toParagraphChildren(item.runs),
          ],
        }),
    );
  }

  // Lists: bullet uses docx's built-in bullet; ordered uses our numbering reference
  // with a per-list instance so each numbered list restarts at 1.
  const instance = block.type === 'orderedList' ? ctx.orderedInstance++ : 0;
  return block.items.map((item) => {
    const opts: IParagraphOptions = {
      alignment: ALIGN[item.align],
      children: toParagraphChildren(item.runs),
      ...(block.type === 'orderedList'
        ? { numbering: { reference: ORDERED_REF, level: 0, instance } }
        : { bullet: { level: 0 } }),
    };
    return new Paragraph(opts);
  });
}

/**
 * Build the in-memory Word document (used by both the Blob path and tests). `media`
 * carries pre-fetched PNG/JPEG bytes keyed by media id (empty when there is none or the
 * host provided no fetcher — images then render as placeholders).
 */
export function buildDocx(doc: JSONContent, media: DocxMediaMap = new Map()): Document {
  const model = toExportDocument(doc);
  const ctx: DocxContext = { orderedInstance: 0, media };

  const children: Paragraph[] = [];
  model.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      // A real Word page break at every logical page boundary (task §6/§7).
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    for (const block of page.blocks) children.push(...blockToParagraphs(block, ctx));
  });
  // A document with zero paragraphs is invalid; ensure at least one empty paragraph.
  if (children.length === 0) children.push(new Paragraph({}));

  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: PAGE_WIDTH * PX_TO_TWIP, height: PAGE_HEIGHT * PX_TO_TWIP },
        margin: {
          top: PAGE_MARGIN_Y * PX_TO_TWIP,
          bottom: PAGE_MARGIN_Y * PX_TO_TWIP,
          left: PAGE_MARGIN_X * PX_TO_TWIP,
          right: PAGE_MARGIN_X * PX_TO_TWIP,
        },
      },
    },
    children,
  };

  return new Document({
    creator: 'ProDocs',
    title: 'ProDocs document export',
    numbering: {
      config: [
        {
          reference: ORDERED_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [section],
  });
}

/**
 * Pre-fetch every referenced PNG/JPEG for the CURRENT document (via the host fetcher)
 * so buildDocx (synchronous) can embed them. WebP is not supported by docx ImageRun and
 * is left out (→ placeholder); a fetch failure is skipped (→ placeholder). Only
 * authorized current-document media is fetched — never arbitrary URLs.
 */
async function fetchDocxMedia(
  doc: JSONContent,
  fetchMedia?: ExportMediaFetcher,
): Promise<DocxMediaMap> {
  const map: DocxMediaMap = new Map();
  if (!fetchMedia) return map;
  const model = toExportDocument(doc);
  const ids = new Set<string>();
  for (const page of model.pages) {
    for (const block of page.blocks) if (isMediaBlock(block)) ids.add(block.mediaId);
  }
  for (const mediaId of ids) {
    try {
      const res = await fetchMedia(mediaId);
      if (!res) continue;
      if (res.mime === 'image/png') map.set(mediaId, { bytes: res.bytes, type: 'png' });
      else if (res.mime === 'image/jpeg') map.set(mediaId, { bytes: res.bytes, type: 'jpg' });
      // WebP unsupported by docx ImageRun → placeholder (documented).
    } catch {
      // Unavailable image → placeholder; never fail the whole export.
    }
  }
  return map;
}

/** Generate a `.docx` as a Blob suitable for a browser download. */
export async function exportDocumentToDocxBlob(
  doc: JSONContent,
  fetchMedia?: ExportMediaFetcher,
): Promise<Blob> {
  const media = await fetchDocxMedia(doc, fetchMedia);
  return Packer.toBlob(buildDocx(doc, media));
}
