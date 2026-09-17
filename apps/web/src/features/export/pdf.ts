import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import {
  type ExportAlign,
  type ExportListBlock,
  type ExportMediaBlock,
  type ExportMediaFetcher,
  type ExportQuoteBlock,
  type ExportRun,
  type ExportTaskListBlock,
  type ExportTextBlock,
  isListBlock,
  isMediaBlock,
  isQuoteBlock,
  isTaskListBlock,
  toExportDocument,
} from '@scribe/shared';
import type { JSONContent } from '@tiptap/react';
import { PAGE_HEIGHT, PAGE_MARGIN_X, PAGE_MARGIN_Y, PAGE_WIDTH } from '../editor/pageGeometry.js';

/**
 * PDF EXPORT — renders the export model to a real, text-based A4 PDF with pdf-lib.
 *
 * Design (task §4/§5/§13):
 *   - The document text is drawn as ACTUAL PDF text (drawText), never a screenshot,
 *     so it is selectable/searchable and carries no editor chrome, no collaboration
 *     cursors, no selection highlights, no toolbar.
 *   - Page geometry is derived from the ONE source of truth the editor already uses
 *     (pageGeometry.ts), converted from CSS px @96dpi to PDF points @72dpi. There is
 *     no second set of A4 numbers.
 *   - Each logical export-model page (a run of content between page breaks)
 *     starts a fresh PDF page, and content that overflows a page flows onto an
 *     automatic continuation page — so a manual page break is a real page boundary.
 *   - pdf-lib's built-in Times family (a serif body face, no font embedding needed)
 *     keeps the output document-like and the bundle small.
 *
 * This module is pure output: it takes ProseMirror JSON (a read-only snapshot) and
 * returns bytes. It never touches the editor, the Y.Doc, or the schema.
 */

// CSS px @96dpi → PDF pt @72dpi. Reuses the editor's A4 geometry verbatim.
const PX_TO_PT = 72 / 96;
const PAGE_W = PAGE_WIDTH * PX_TO_PT;
const PAGE_H = PAGE_HEIGHT * PX_TO_PT;
const MARGIN_X = PAGE_MARGIN_X * PX_TO_PT;
const MARGIN_Y = PAGE_MARGIN_Y * PX_TO_PT;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;

const BODY_SIZE = 11;
const LINE_FACTOR = 1.4;
const PARAGRAPH_GAP = 6;
/** Heading point sizes for H1/H2/H3 and the space above them. */
const HEADING: Record<1 | 2 | 3, { size: number; gapBefore: number }> = {
  1: { size: 22, gapBefore: 14 },
  2: { size: 17, gapBefore: 12 },
  3: { size: 13, gapBefore: 10 },
};
const LIST_INDENT = 22;
/** Left offset per `indent` level for paragraphs/headings (mirrors the editor margin). */
const INDENT_STEP = 22;
const MAX_EXPORT_INDENT = 10;
const INK = rgb(0.12, 0.12, 0.13);
/** Link ink — a document-blue that reads as a hyperlink in print. */
const LINK_INK = rgb(0.13, 0.29, 0.85);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  /** Monospace family for inline `code` runs. */
  code: PDFFont;
  codeBold: PDFFont;
  codeItalic: PDFFont;
  codeBoldItalic: PDFFont;
}

/** One shaped token on a line: a word with its style, or an (expandable) space. */
interface Token {
  kind: 'word' | 'space';
  text: string;
  run: ExportRun;
  width: number;
}
interface Line {
  tokens: Token[];
  width: number; // natural width (spaces at their natural size)
  isLast: boolean;
}

/** Writer that owns the growing PDF and lays text top-down with overflow paging. */
class PdfLayout {
  private page: PDFPage;
  /** Distance of the next line's TOP from the page top. */
  private cursor = MARGIN_Y;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE_W, PAGE_H]);
  }

  /** Begin a brand-new logical page (a manual page break → real page boundary). */
  newLogicalPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.cursor = MARGIN_Y;
  }

  /** Continuation page created when content overflows the current page bottom. */
  private overflowPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.cursor = MARGIN_Y;
  }

  private fontFor(run: ExportRun): PDFFont {
    if (run.code) {
      if (run.bold && run.italic) return this.fonts.codeBoldItalic;
      if (run.bold) return this.fonts.codeBold;
      if (run.italic) return this.fonts.codeItalic;
      return this.fonts.code;
    }
    if (run.bold && run.italic) return this.fonts.boldItalic;
    if (run.bold) return this.fonts.bold;
    if (run.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /** Break a sequence of styled runs into wrapped lines that fit `maxWidth`. */
  private wrap(runs: ExportRun[], size: number, maxWidth: number, forceBold: boolean): Line[] {
    const lines: Line[] = [];
    let tokens: Token[] = [];
    let width = 0;

    const flush = () => {
      // Drop a trailing space so it never affects alignment width.
      while (tokens.length && tokens[tokens.length - 1]!.kind === 'space') {
        width -= tokens.pop()!.width;
      }
      lines.push({ tokens, width, isLast: false });
      tokens = [];
      width = 0;
    };

    for (const run of runs) {
      const styled: ExportRun = forceBold ? { ...run, bold: true } : run;
      const font = this.fontFor(styled);
      const segments = (run.text ?? '').split('\n');
      segments.forEach((segment, i) => {
        if (i > 0) flush(); // hard break
        for (const piece of segment.split(/(\s+)/)) {
          if (piece === '') continue;
          const isSpace = /^\s+$/.test(piece);
          if (isSpace) {
            if (tokens.length === 0) continue; // no leading space on a line
            const w = font.widthOfTextAtSize(' ', size);
            tokens.push({ kind: 'space', text: ' ', run: styled, width: w });
            width += w;
          } else {
            const w = font.widthOfTextAtSize(piece, size);
            // Wrap before a word that would overflow (unless the line is empty; an
            // over-long single word is allowed to run wide rather than be dropped).
            if (width + w > maxWidth && tokens.some((t) => t.kind === 'word')) flush();
            tokens.push({ kind: 'word', text: piece, run: styled, width: w });
            width += w;
          }
        }
      });
    }
    flush();
    if (lines.length) lines[lines.length - 1]!.isLast = true;
    return lines;
  }

  /** Draw one wrapped line, applying alignment (justify expands inter-word spaces). */
  private drawLine(
    line: Line,
    size: number,
    align: ExportAlign,
    x0: number,
    maxWidth: number,
    barX?: number,
  ): void {
    const lineHeight = size * LINE_FACTOR;
    if (this.cursor + lineHeight > PAGE_H - MARGIN_Y) this.overflowPage();
    const baseline = PAGE_H - this.cursor - size;

    // Blockquote left rule: a vertical bar spanning this line's height.
    if (barX !== undefined) {
      this.page.drawLine({
        start: { x: barX, y: PAGE_H - this.cursor },
        end: { x: barX, y: PAGE_H - this.cursor - lineHeight },
        thickness: 2,
        color: LINK_INK,
      });
    }

    const gaps = line.tokens.filter((t) => t.kind === 'space').length;
    let extraPerGap = 0;
    let x = x0;
    if (align === 'right') x = x0 + (maxWidth - line.width);
    else if (align === 'center') x = x0 + (maxWidth - line.width) / 2;
    else if (align === 'justify' && !line.isLast && gaps > 0) {
      extraPerGap = (maxWidth - line.width) / gaps;
    }

    for (const t of line.tokens) {
      if (t.kind === 'space') {
        x += t.width + extraPerGap;
        continue;
      }
      const font = this.fontFor(t.run);
      const ink = t.run.href ? LINK_INK : INK;
      this.page.drawText(t.text, { x, y: baseline, size, font, color: ink });
      // A hyperlink and an underline mark both draw an underline; a link also uses
      // the link ink so it reads as a hyperlink.
      if (t.run.underline || t.run.href) {
        const uy = baseline - size * 0.1;
        this.page.drawLine({
          start: { x, y: uy },
          end: { x: x + t.width, y: uy },
          thickness: Math.max(0.5, size * 0.05),
          color: ink,
        });
      }
      if (t.run.strike) {
        const sy = baseline + size * 0.28;
        this.page.drawLine({
          start: { x, y: sy },
          end: { x: x + t.width, y: sy },
          thickness: Math.max(0.5, size * 0.05),
          color: ink,
        });
      }
      x += t.width;
    }
    this.cursor += lineHeight;
  }

  private drawRuns(
    runs: ExportRun[],
    size: number,
    align: ExportAlign,
    x0: number,
    maxWidth: number,
    forceBold = false,
    barX?: number,
  ): void {
    const lines = this.wrap(runs, size, maxWidth, forceBold);
    if (lines.length === 0 || (lines.length === 1 && lines[0]!.tokens.length === 0)) {
      // Empty paragraph → one blank line so the structure is preserved.
      if (barX !== undefined) {
        // Still draw the quote rule for an empty quote line.
        const lineHeight = size * LINE_FACTOR;
        if (this.cursor + lineHeight > PAGE_H - MARGIN_Y) this.overflowPage();
        this.page.drawLine({
          start: { x: barX, y: PAGE_H - this.cursor },
          end: { x: barX, y: PAGE_H - this.cursor - lineHeight },
          thickness: 2,
          color: LINK_INK,
        });
        this.cursor += lineHeight;
        return;
      }
      this.cursor += size * LINE_FACTOR;
      return;
    }
    for (const line of lines) this.drawLine(line, size, align, x0, maxWidth, barX);
  }

  drawTextBlock(block: ExportTextBlock): void {
    // Left indent (task §B) shifts the text column right and narrows it, deterministically
    // from the document's `indent` level — never a browser measurement.
    const level = Math.max(0, Math.min(MAX_EXPORT_INDENT, block.indent ?? 0));
    const x0 = MARGIN_X + level * INDENT_STEP;
    const w = Math.max(40, CONTENT_W - level * INDENT_STEP);
    if (block.type === 'heading' && block.level) {
      this.cursor += HEADING[block.level].gapBefore;
      this.drawRuns(block.runs, HEADING[block.level].size, block.align, x0, w, true);
    } else {
      this.drawRuns(block.runs, BODY_SIZE, block.align, x0, w);
    }
    this.cursor += PARAGRAPH_GAP;
  }

  drawListBlock(block: ExportListBlock): void {
    const markerX = MARGIN_X;
    const textX = MARGIN_X + LIST_INDENT;
    const textW = CONTENT_W - LIST_INDENT;
    const font = this.fonts.regular;
    block.items.forEach((item, idx) => {
      const marker = block.type === 'orderedList' ? `${idx + 1}.` : '•';
      const lineHeight = BODY_SIZE * LINE_FACTOR;
      if (this.cursor + lineHeight > PAGE_H - MARGIN_Y) this.overflowPage();
      // Marker sits on the baseline of the item's first line.
      const baseline = PAGE_H - this.cursor - BODY_SIZE;
      this.page.drawText(marker, { x: markerX, y: baseline, size: BODY_SIZE, font, color: INK });
      this.drawRuns(
        item.runs.length ? item.runs : [{ text: '' }],
        BODY_SIZE,
        item.align,
        textX,
        textW,
      );
    });
    this.cursor += PARAGRAPH_GAP;
  }

  /**
   * Media — draw a pre-embedded image scaled to the content width, or a labeled
   * placeholder box when the image is unavailable/unsupported (WebP, offline, 404).
   * `image` is pre-embedded because pdf-lib's embedPng/embedJpg are async and this
   * layout pass is synchronous (see exportDocumentToPdf).
   */
  drawMediaBlock(block: ExportMediaBlock, image: PDFImage | null): void {
    this.cursor += PARAGRAPH_GAP;
    if (image) {
      // Honor the document's stored display width (CSS px → pt), clamped to the content
      // column so an image can never exceed the page; aspect ratio is preserved.
      const desiredW = block.width && block.width > 0 ? block.width * PX_TO_PT : image.width;
      const targetW = Math.min(desiredW, CONTENT_W);
      const scale = targetW / image.width;
      const w = image.width * scale;
      const h = image.height * scale;
      // If it doesn't fit on the rest of the page, move to a fresh page first.
      if (this.cursor + h > PAGE_H - MARGIN_Y && this.cursor > MARGIN_Y) this.overflowPage();
      // Alignment from the document's media align (wrap layouts collapse to their side).
      let x = MARGIN_X + (CONTENT_W - w) / 2;
      if (block.align === 'left') x = MARGIN_X;
      else if (block.align === 'right') x = MARGIN_X + (CONTENT_W - w);
      const y = PAGE_H - this.cursor - h;
      this.page.drawImage(image, { x, y, width: w, height: h });
      this.cursor += h + PARAGRAPH_GAP;
      return;
    }
    // Placeholder: a bordered box with a short label (never a broken reference).
    const boxH = 40;
    if (this.cursor + boxH > PAGE_H - MARGIN_Y && this.cursor > MARGIN_Y) this.overflowPage();
    const y = PAGE_H - this.cursor - boxH;
    this.page.drawRectangle({
      x: MARGIN_X,
      y,
      width: CONTENT_W,
      height: boxH,
      borderWidth: 1,
      borderColor: rgb(0.6, 0.6, 0.62),
    });
    const label = block.alt ? `[Image: ${block.alt}]` : '[Image unavailable in export]';
    this.page.drawText(label.slice(0, 80), {
      x: MARGIN_X + 8,
      y: y + boxH / 2 - 4,
      size: 10,
      font: this.fonts.italic,
      color: rgb(0.4, 0.4, 0.42),
    });
    this.cursor += boxH + PARAGRAPH_GAP;
  }

  /** Blockquote — indented runs with a left rule (drawn per line so it flows/paginates). */
  drawQuoteBlock(block: ExportQuoteBlock): void {
    const barX = MARGIN_X + 2;
    const textX = MARGIN_X + LIST_INDENT;
    const textW = CONTENT_W - LIST_INDENT;
    for (const para of block.paragraphs) {
      // Blockquote body reads as quoted prose → italicize runs that aren't code.
      const runs = para.runs.map((r) => (r.code ? r : { ...r, italic: true }));
      this.drawRuns(
        runs.length ? runs : [{ text: '' }],
        BODY_SIZE,
        para.align,
        textX,
        textW,
        false,
        barX,
      );
    }
    this.cursor += PARAGRAPH_GAP;
  }

  /** Task checklist — a real checkbox square (checked → a check mark) + item runs. */
  drawTaskListBlock(block: ExportTaskListBlock): void {
    const boxX = MARGIN_X;
    const textX = MARGIN_X + LIST_INDENT;
    const textW = CONTENT_W - LIST_INDENT;
    const boxSize = BODY_SIZE * 0.85;
    block.items.forEach((item) => {
      const lineHeight = BODY_SIZE * LINE_FACTOR;
      if (this.cursor + lineHeight > PAGE_H - MARGIN_Y) this.overflowPage();
      // Box aligned to the first line of the item.
      const boxBottom = PAGE_H - this.cursor - BODY_SIZE + 1;
      this.page.drawRectangle({
        x: boxX,
        y: boxBottom,
        width: boxSize,
        height: boxSize,
        borderWidth: 1,
        borderColor: INK,
      });
      if (item.checked) {
        // A simple check mark inside the box (two strokes).
        this.page.drawLine({
          start: { x: boxX + boxSize * 0.18, y: boxBottom + boxSize * 0.5 },
          end: { x: boxX + boxSize * 0.42, y: boxBottom + boxSize * 0.22 },
          thickness: 1,
          color: INK,
        });
        this.page.drawLine({
          start: { x: boxX + boxSize * 0.42, y: boxBottom + boxSize * 0.22 },
          end: { x: boxX + boxSize * 0.82, y: boxBottom + boxSize * 0.78 },
          thickness: 1,
          color: INK,
        });
      }
      this.drawRuns(
        item.runs.length ? item.runs : [{ text: '' }],
        BODY_SIZE,
        item.align,
        textX,
        textW,
      );
    });
    this.cursor += PARAGRAPH_GAP;
  }
}

/**
 * Pre-embed every media object referenced by the model. pdf-lib's embedPng/embedJpg are
 * async, but the layout pass is synchronous, so we resolve all images up front into a
 * map. WebP (not embeddable by pdf-lib), a fetch failure, or a null fetcher leave the id
 * out of the map → the layout draws a placeholder. Only the current document's authorized
 * media is fetched (via the host-provided fetcher) — never arbitrary URLs.
 */
async function embedMedia(
  pdf: PDFDocument,
  model: ReturnType<typeof toExportDocument>,
  fetchMedia?: ExportMediaFetcher,
): Promise<Map<string, PDFImage>> {
  const images = new Map<string, PDFImage>();
  if (!fetchMedia) return images;
  const ids = new Set<string>();
  for (const page of model.pages) {
    for (const block of page.blocks) if (isMediaBlock(block)) ids.add(block.mediaId);
  }
  for (const mediaId of ids) {
    try {
      const res = await fetchMedia(mediaId);
      if (!res) continue;
      if (res.mime === 'image/png') images.set(mediaId, await pdf.embedPng(res.bytes));
      else if (res.mime === 'image/jpeg') images.set(mediaId, await pdf.embedJpg(res.bytes));
      // WebP is intentionally unsupported by pdf-lib → placeholder (documented).
    } catch {
      // Unavailable/undecodable image → placeholder; never fail the whole export.
    }
  }
  return images;
}

/** Generate a PDF (as bytes) from a ProseMirror document snapshot. */
export async function exportDocumentToPdf(
  doc: JSONContent,
  fetchMedia?: ExportMediaFetcher,
): Promise<Uint8Array> {
  const model = toExportDocument(doc);
  const pdf = await PDFDocument.create();
  pdf.setCreator('ProDocs');
  pdf.setProducer('ProDocs');
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    code: await pdf.embedFont(StandardFonts.Courier),
    codeBold: await pdf.embedFont(StandardFonts.CourierBold),
    codeItalic: await pdf.embedFont(StandardFonts.CourierOblique),
    codeBoldItalic: await pdf.embedFont(StandardFonts.CourierBoldOblique),
  };

  const images = await embedMedia(pdf, model, fetchMedia);

  const layout = new PdfLayout(pdf, fonts);
  model.pages.forEach((page, i) => {
    if (i > 0) layout.newLogicalPage();
    for (const block of page.blocks) {
      if (isListBlock(block)) layout.drawListBlock(block);
      else if (isTaskListBlock(block)) layout.drawTaskListBlock(block);
      else if (isQuoteBlock(block)) layout.drawQuoteBlock(block);
      else if (isMediaBlock(block)) layout.drawMediaBlock(block, images.get(block.mediaId) ?? null);
      else layout.drawTextBlock(block);
    }
  });

  return pdf.save();
}

/** Generate a PDF as a Blob suitable for a browser download. */
export async function exportDocumentToPdfBlob(
  doc: JSONContent,
  fetchMedia?: ExportMediaFetcher,
): Promise<Blob> {
  const bytes = await exportDocumentToPdf(doc, fetchMedia);
  // Copy into a fresh ArrayBuffer so the Blob owns memory independent of pdf-lib.
  return new Blob([bytes.slice()], { type: 'application/pdf' });
}
