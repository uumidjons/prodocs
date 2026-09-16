import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { PAGE_CONTENT_HEIGHT, PAGE_GUTTER } from './pageGeometry.js';

/**
 * A4 PAGINATION — a pure PRESENTATION layer (task §4/§5).
 *
 * The collaborative document remains ONE logical ProseMirror/Yjs document. This
 * extension never mutates the document and never writes pagination state into Yjs;
 * it only measures the rendered top-level blocks and emits client-local ProseMirror
 * *decorations* that render the visual gaps between A4 pages:
 *
 *   - an AUTOMATIC gap before any block that would overflow the current page's
 *     content area (content "flows" onto the next sheet, breaking only BETWEEN
 *     blocks so no node is ever split and no invalid structure is produced);
 *   - a sized gap on each explicit `pageBreak` node so the content after it starts
 *     at the top of the next sheet.
 *
 * The gaps are TRANSPARENT spacers: the white A4 sheets and the gray gutter between
 * them are drawn by a separate backdrop layer (DocumentEditor + index.css), sized
 * from the SAME geometry (pageGeometry.ts). Because the backdrop always renders full
 * A4 sheets regardless of content, an empty page, a list-only page, or the page
 * after a manual break all keep a stable full A4 height — content amount never
 * determines a page's outer size.
 *
 * The plugin reports the derived page COUNT to the host via `options.onPagesChange`
 * so the backdrop can render exactly that many sheets. The count is derived from
 * layout, never stored in the document.
 *
 * All px geometry comes from pageGeometry.ts — the single source of truth shared
 * with the CSS — so TypeScript and CSS can never disagree about A4 dimensions.
 */

const paginationKey = new PluginKey<DecorationSet>('scribe-pagination');

interface PageBoundary {
  /** Document position immediately before the block that starts a new page. */
  pos: number;
  /** Pixel height the inserted gap should occupy to reach the next sheet's top. */
  gapHeight: number;
  /** True when the boundary is an explicit pageBreak node (decorate the node itself). */
  isExplicit: boolean;
  /** For explicit breaks: the node's end position. */
  end: number;
}

/** Height a top-level block contributes to page flow, including its top margin. */
function blockFlowHeight(dom: HTMLElement): number {
  const rect = dom.getBoundingClientRect();
  let marginTop = 0;
  try {
    marginTop = parseFloat(getComputedStyle(dom).marginTop) || 0;
  } catch {
    marginTop = 0;
  }
  return rect.height + marginTop;
}

/** Measure the document and compute where page boundaries fall. */
function computeBoundaries(view: EditorView): PageBoundary[] {
  const boundaries: PageBoundary[] = [];
  const { doc } = view.state;
  let used = 0; // content height consumed on the current page

  doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);

    if (node.type.name === 'pageBreak') {
      // Explicit break: fill the rest of the current page, then the gutter.
      const remaining = Math.max(0, PAGE_CONTENT_HEIGHT - used);
      boundaries.push({
        pos: offset,
        end: offset + node.nodeSize,
        gapHeight: remaining + PAGE_GUTTER,
        isExplicit: true,
      });
      used = 0;
      return;
    }

    if (!(dom instanceof HTMLElement)) return;
    const h = blockFlowHeight(dom);

    // Break BEFORE this block when it would overflow the current page (but never
    // for the first block on a page — a single over-tall block just overflows,
    // which is the documented limitation of block-granularity pagination).
    if (used > 0 && used + h > PAGE_CONTENT_HEIGHT) {
      const remaining = Math.max(0, PAGE_CONTENT_HEIGHT - used);
      boundaries.push({
        pos: offset,
        end: offset,
        gapHeight: remaining + PAGE_GUTTER,
        isExplicit: false,
      });
      used = h;
    } else {
      used += h;
    }
  });

  return boundaries;
}

function buildDecorations(view: EditorView): DecorationSet {
  const boundaries = computeBoundaries(view);
  const decorations = boundaries.map((b) => {
    if (b.isExplicit) {
      // Size the explicit break node so it fills to the next sheet's top.
      return Decoration.node(b.pos, b.end, {
        class: 'scribe-page-gap scribe-page-gap--explicit',
        style: `height:${b.gapHeight}px`,
      });
    }
    // Automatic gap: a widget rendered immediately before the overflowing block.
    return Decoration.widget(
      b.pos,
      () => {
        const el = document.createElement('div');
        el.className = 'scribe-page-gap';
        el.style.height = `${b.gapHeight}px`;
        el.setAttribute('aria-hidden', 'true');
        el.contentEditable = 'false';
        return el;
      },
      { side: -1, key: `page-gap-${b.pos}-${b.gapHeight}` },
    );
  });
  return DecorationSet.create(view.state.doc, decorations);
}

/** A stable signature so we only re-dispatch when the page layout actually changes. */
function signature(boundaries: PageBoundary[]): string {
  return boundaries
    .map((b) => `${b.pos}:${Math.round(b.gapHeight)}:${b.isExplicit ? 1 : 0}`)
    .join('|');
}

export interface PaginationOptions {
  /** Called with the derived page count whenever it changes (for the backdrop). */
  onPagesChange?: (pageCount: number) => void;
}

/**
 * Tiptap extension wrapper. The heavy lifting is a ProseMirror plugin whose
 * PluginView measures AFTER layout and pushes the resulting decorations back in via
 * a metadata-tagged transaction; `props.decorations` then renders them. It only
 * re-dispatches when the computed layout signature changes, so there is no update
 * loop and typing stays cheap (O(top-level blocks) per change). The derived page
 * count is reported to the host so the backdrop renders the matching sheets.
 */
export const Pagination = Extension.create<PaginationOptions>({
  name: 'scribePagination',

  addOptions() {
    return { onPagesChange: undefined };
  },

  addProseMirrorPlugins() {
    const notifyPages = this.options.onPagesChange;

    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const next = tr.getMeta(paginationKey) as DecorationSet | undefined;
            if (next) return next;
            return value.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state) ?? DecorationSet.empty;
          },
        },
        view(view) {
          let lastSignature = '';
          let lastPageCount = -1;
          let raf = 0;
          // Guards against work scheduled just before teardown running against a
          // destroyed view (rAF / fonts.ready callbacks) — which would throw
          // asynchronously. All deferred work checks this flag first.
          let destroyed = false;
          // Forces the next measure to re-dispatch even when the layout signature is
          // unchanged. Needed because when a node (e.g. a page break) arrives via a
          // REMOTE Yjs step, y-prosemirror re-renders that node's DOM and can drop a
          // node decoration applied in the same frame; the signature would otherwise
          // still match and we'd never re-apply it. Set on every doc-changing
          // transaction (awareness/cursor updates don't change the doc, so they don't
          // force a rebuild — keeping presence updates cheap).
          let forceNext = false;

          const measure = () => {
            if (destroyed) return;
            try {
              const boundaries = computeBoundaries(view);
              // Report page count first so the backdrop tracks layout even when the
              // decoration signature is unchanged (e.g. sheets re-rendered remotely).
              const pageCount = boundaries.length + 1;
              if (pageCount !== lastPageCount) {
                lastPageCount = pageCount;
                notifyPages?.(pageCount);
              }

              const sig = signature(boundaries);
              if (sig === lastSignature && !forceNext) return;
              forceNext = false;
              lastSignature = sig;
              view.dispatch(view.state.tr.setMeta(paginationKey, buildDecorations(view)));
            } catch {
              // Measurement is best-effort presentation; never break editing over it.
            }
          };

          const scheduleMeasure = () => {
            if (destroyed) return;
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
              raf = 0;
              measure();
            });
          };

          // Recompute when the sheet width changes (wrapping → heights change).
          const resizeObserver =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
          resizeObserver?.observe(view.dom);
          window.addEventListener('resize', scheduleMeasure);

          // Fonts loading after first paint change block heights — remeasure then.
          const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
          fonts?.ready
            ?.then(() => {
              if (!destroyed) scheduleMeasure();
            })
            .catch(() => {});

          // Initial pass once layout is available.
          scheduleMeasure();

          return {
            update(_view, prevState) {
              // A doc change (local OR remote) may have added/removed/re-rendered a
              // block a decoration depends on — force the next measure to re-apply.
              if (!prevState || !prevState.doc.eq(view.state.doc)) forceNext = true;
              scheduleMeasure();
            },
            destroy() {
              destroyed = true;
              if (raf) cancelAnimationFrame(raf);
              resizeObserver?.disconnect();
              window.removeEventListener('resize', scheduleMeasure);
            },
          };
        },
      }),
    ];
  },
});
