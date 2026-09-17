import type { JSONContent } from '@tiptap/core';
import { isSafeLinkUrl } from './linkPolicy.js';

/**
 * EXPORT MODEL — a pure, transport-free normalization of the collaborative document
 * into the smallest structure the PDF and DOCX generators both need.
 *
 * Why this lives in @scribe/shared and is pure (no DOM, no editor, no heavy deps):
 *   - Export must read the CURRENT authoritative document state, which is the Tiptap /
 *     ProseMirror document (a projection of the Yjs CRDT). The editor exposes that as
 *     ProseMirror JSON via `editor.getJSON()` — a plain, read-only snapshot. We never
 *     call setContent, never mutate the Y.Doc, never touch the schema (task §8/§9).
 *   - Both output formats (pdf-lib, docx) are just different renderers of the SAME
 *     logical model, so the ProseMirror → model transform is written and tested ONCE
 *     here, and each generator is a thin adapter over it (task §13).
 *
 * PAGE BREAKS: the shared schema's `pageBreak` node (see editor.ts) is
 * document-structure information. Here it is the ONLY thing that starts a new
 * {@link ExportPage}; it never becomes literal text or a marker glyph (task §6). Each
 * logical page therefore maps to a real page boundary in both PDF and DOCX.
 */

/** Block text alignment, mirroring the `textAlign` attribute in the shared schema. */
export type ExportAlign = 'left' | 'center' | 'right' | 'justify';

/** A styled run of text. Marks map 1:1 to the shared schema's inline marks. */
export interface ExportRun {
  /** Run text. May contain `\n` for a hard line break (schema `hardBreak`). */
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Inline code mark — rendered in a monospace face by the exporters. */
  code?: boolean;
  /** Hyperlink target when this run carries a (safe) `link` mark. */
  href?: string;
}

/** A paragraph or a heading (H1–H3): a single alignable line of styled runs. */
export interface ExportTextBlock {
  type: 'paragraph' | 'heading';
  /** Present only for headings (1–3). */
  level?: 1 | 2 | 3;
  align: ExportAlign;
  /** Left indent LEVEL (0..N), from the shared `indent` attribute. */
  indent: number;
  runs: ExportRun[];
}

/** One item of a list — its own runs and alignment. */
export interface ExportListItem {
  runs: ExportRun[];
  align: ExportAlign;
}

/** A bullet or numbered list (single level in the MVP schema). */
export interface ExportListBlock {
  type: 'bulletList' | 'orderedList';
  items: ExportListItem[];
}

/** One item of a task checklist — its checked state is document data (task §4). */
export interface ExportTaskItem {
  checked: boolean;
  runs: ExportRun[];
  align: ExportAlign;
}

/** A task checklist (TaskList/TaskItem). */
export interface ExportTaskListBlock {
  type: 'taskList';
  items: ExportTaskItem[];
}

/** A blockquote: one or more contained paragraphs, each an alignable line of runs. */
export interface ExportQuoteBlock {
  type: 'blockquote';
  paragraphs: { runs: ExportRun[]; align: ExportAlign }[];
}

/**
 * A media reference (ADR 0012). Carries ONLY the document-model reference (mediaId +
 * hints) — never the binary. Exporters fetch the bytes for the CURRENT document via the
 * authenticated endpoint; an unavailable image becomes a clear placeholder.
 */
export interface ExportMediaBlock {
  type: 'media';
  mediaId: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
  /**
   * Horizontal placement within the content column. Derived from the media node's
   * document-semantic `align`/`layout` attributes so export uses the SAME state
   * collaborators see (never a browser/DOM measurement). Wrap layouts collapse to their
   * float side (`wrap-left`→'left', `wrap-right`→'right') — the closest deterministic
   * representation, since true text-wrap isn't expressed in the page-flow exporters.
   */
  align: ExportAlign;
}

export type ExportBlock =
  ExportTextBlock | ExportListBlock | ExportTaskListBlock | ExportQuoteBlock | ExportMediaBlock;

/**
 * Narrow a block to a bullet/numbered list block. Written as a user-defined type
 * guard because `type` is a union-literal discriminant, which TypeScript cannot
 * narrow by negation across members.
 */
export function isListBlock(block: ExportBlock): block is ExportListBlock {
  return block.type === 'bulletList' || block.type === 'orderedList';
}

/** Narrow a block to a paragraph/heading text block (see {@link isListBlock}). */
export function isTextBlock(block: ExportBlock): block is ExportTextBlock {
  return block.type === 'paragraph' || block.type === 'heading';
}

/** Narrow a block to a task checklist block. */
export function isTaskListBlock(block: ExportBlock): block is ExportTaskListBlock {
  return block.type === 'taskList';
}

/** Narrow a block to a blockquote block. */
export function isQuoteBlock(block: ExportBlock): block is ExportQuoteBlock {
  return block.type === 'blockquote';
}

/** Narrow a block to a media block. */
export function isMediaBlock(block: ExportBlock): block is ExportMediaBlock {
  return block.type === 'media';
}

/** One logical page = the blocks between two page breaks (may be empty). */
export interface ExportPage {
  blocks: ExportBlock[];
}

/** Resolved bytes + type for one media object, as fetched by the exporter host. */
export interface ExportMediaResource {
  bytes: Uint8Array;
  mime: string;
}

/**
 * How the exporters obtain image bytes for the CURRENT document (ADR 0012). The host
 * supplies a fetcher bound to the document id and the authenticated endpoint; the
 * exporters never construct or fetch arbitrary URLs. Returning null (unavailable /
 * offline) makes the exporter draw a labeled placeholder instead of failing.
 */
export type ExportMediaFetcher = (mediaId: string) => Promise<ExportMediaResource | null>;

/** The whole document as a sequence of logical pages. Always ≥ 1 page. */
export interface ExportDocument {
  pages: ExportPage[];
}

function alignOf(node: JSONContent): ExportAlign {
  const a = node.attrs?.textAlign;
  return a === 'center' || a === 'right' || a === 'justify' ? a : 'left';
}

/** Read the shared `indent` LEVEL attribute (0..N) off a text block. */
function indentOf(node: JSONContent): number {
  const raw = node.attrs?.indent;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
}

/** Derive a media block's export alignment from its `align`/`layout` attributes. */
function mediaAlignOf(node: JSONContent): ExportAlign {
  const layout = node.attrs?.layout;
  if (layout === 'wrap-left') return 'left';
  if (layout === 'wrap-right') return 'right';
  const a = node.attrs?.align;
  return a === 'left' || a === 'right' ? a : 'center';
}

/** Collect the styled runs of a block's inline content (text nodes + hard breaks). */
function runsOf(node: JSONContent): ExportRun[] {
  const out: ExportRun[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      const marks = child.marks ?? [];
      const run: ExportRun = { text: child.text ?? '' };
      if (marks.some((m) => m.type === 'bold')) run.bold = true;
      if (marks.some((m) => m.type === 'italic')) run.italic = true;
      if (marks.some((m) => m.type === 'underline')) run.underline = true;
      if (marks.some((m) => m.type === 'strike')) run.strike = true;
      if (marks.some((m) => m.type === 'code')) run.code = true;
      const link = marks.find((m) => m.type === 'link');
      const href = link?.attrs?.href;
      // Only carry a link target we would ourselves store (fail-closed against a
      // dangerous scheme that somehow reached the document).
      if (typeof href === 'string' && isSafeLinkUrl(href)) run.href = href;
      out.push(run);
    } else if (child.type === 'hardBreak') {
      out.push({ text: '\n' });
    }
    // The MVP schema has no other inline node types; anything else is ignored so a
    // future/unknown inline node can never crash an export.
  }
  return out;
}

/** Flatten a list node into its items (single level; nested lists are inlined). */
function listItemsOf(listNode: JSONContent): ExportListItem[] {
  const items: ExportListItem[] = [];
  for (const li of listNode.content ?? []) {
    if (li.type !== 'listItem') continue;
    const runs: ExportRun[] = [];
    let align: ExportAlign = 'left';
    let first = true;
    for (const child of li.content ?? []) {
      if (child.type === 'paragraph' || child.type === 'heading') {
        if (first) {
          align = alignOf(child);
          first = false;
        } else {
          runs.push({ text: '\n' });
        }
        runs.push(...runsOf(child));
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        // Nested list (not part of the MVP formatting set): inline each nested item
        // on its own line so no content is lost and nothing crashes.
        for (const sub of listItemsOf(child)) {
          runs.push({ text: '\n' });
          runs.push(...sub.runs);
        }
      }
    }
    items.push({ runs, align });
  }
  return items;
}

/** Flatten a task list into its items, preserving each item's `checked` state. */
function taskItemsOf(listNode: JSONContent): ExportTaskItem[] {
  const items: ExportTaskItem[] = [];
  for (const ti of listNode.content ?? []) {
    if (ti.type !== 'taskItem') continue;
    const runs: ExportRun[] = [];
    let align: ExportAlign = 'left';
    let first = true;
    for (const child of ti.content ?? []) {
      if (child.type === 'paragraph' || child.type === 'heading') {
        if (first) {
          align = alignOf(child);
          first = false;
        } else {
          runs.push({ text: '\n' });
        }
        runs.push(...runsOf(child));
      } else if (child.type === 'taskList') {
        // Nested sub-tasks: inline each on its own line so no content is lost.
        for (const sub of taskItemsOf(child)) {
          runs.push({ text: '\n' });
          runs.push(...sub.runs);
        }
      }
    }
    items.push({ checked: ti.attrs?.checked === true, runs, align });
  }
  return items;
}

/** Collect a blockquote's contained paragraphs (each an alignable line of runs). */
function quoteParagraphsOf(node: JSONContent): { runs: ExportRun[]; align: ExportAlign }[] {
  const paras: { runs: ExportRun[]; align: ExportAlign }[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'paragraph' || child.type === 'heading') {
      paras.push({ runs: runsOf(child), align: alignOf(child) });
    }
    // The MVP blockquote holds paragraphs; any other child is skipped defensively.
  }
  // A blockquote is never empty in the schema, but guard so exporters always have ≥1.
  if (paras.length === 0) paras.push({ runs: [], align: 'left' });
  return paras;
}

/** Convert a single top-level ProseMirror node into an export block (or null). */
function blockOf(node: JSONContent): ExportBlock | null {
  switch (node.type) {
    case 'heading': {
      const raw = node.attrs?.level;
      const level = (raw === 1 || raw === 2 || raw === 3 ? raw : 1) as 1 | 2 | 3;
      return {
        type: 'heading',
        level,
        align: alignOf(node),
        indent: indentOf(node),
        runs: runsOf(node),
      };
    }
    case 'paragraph':
      return {
        type: 'paragraph',
        align: alignOf(node),
        indent: indentOf(node),
        runs: runsOf(node),
      };
    case 'bulletList':
    case 'orderedList':
      return { type: node.type, items: listItemsOf(node) };
    case 'taskList':
      return { type: 'taskList', items: taskItemsOf(node) };
    case 'blockquote':
      return { type: 'blockquote', paragraphs: quoteParagraphsOf(node) };
    case 'media': {
      const mediaId = node.attrs?.mediaId;
      if (typeof mediaId !== 'string' || mediaId.length === 0) return null;
      const w = node.attrs?.width;
      const h = node.attrs?.height;
      return {
        type: 'media',
        mediaId,
        mime: typeof node.attrs?.mime === 'string' ? node.attrs.mime : null,
        width: typeof w === 'number' ? w : null,
        height: typeof h === 'number' ? h : null,
        alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt : null,
        align: mediaAlignOf(node),
      };
    }
    default:
      // pageBreak is handled by the caller; any other unknown block is skipped.
      return null;
  }
}

/**
 * Normalize a ProseMirror document (as returned by `editor.getJSON()`) into the
 * page-split export model. This is read-only: it never mutates `doc`.
 *
 * A `pageBreak` top-level node closes the current page and opens the next, so N page
 * breaks yield N+1 pages. The result always has at least one page (an empty document
 * exports as a single blank page).
 */
export function toExportDocument(doc: JSONContent | null | undefined): ExportDocument {
  const pages: ExportPage[] = [];
  let current: ExportBlock[] = [];
  const flush = () => {
    pages.push({ blocks: current });
    current = [];
  };

  for (const node of doc?.content ?? []) {
    if (node.type === 'pageBreak') {
      flush();
      continue;
    }
    const block = blockOf(node);
    if (block) current.push(block);
  }
  flush();

  return { pages };
}

/**
 * Turn a document title into a safe download filename base (no extension).
 *
 * Strips control characters and the characters illegal in Windows/macOS/Linux
 * filenames, collapses whitespace, and removes leading/trailing dots so the result
 * can never be a hidden file, a path, or a traversal sequence (`..`) — the title is
 * user-controlled (task §11). Falls back to `document` when nothing usable remains.
 */
export function sanitizeFilename(title: string | null | undefined, fallback = 'document'): string {
  const cleaned = (title ?? '')
    .normalize('NFC')
    // Strip control characters, but keep the whitespace controls (0x09–0x0d) so the
    // whitespace-collapse below turns a tab/newline into a single space.
    // eslint-disable-next-line no-control-regex
    .replace(/[ --]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    // Strip any leading/trailing run of dots and spaces so the name can never be a
    // hidden file (`.foo`), a bare `.`/`..` entry, or end in a Windows-invalid dot.
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 200)
    .replace(/[.\s]+$/, '');
  return cleaned.length > 0 ? cleaned : fallback;
}
