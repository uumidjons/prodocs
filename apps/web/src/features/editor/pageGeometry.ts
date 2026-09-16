/**
 * A4 PAGE GEOMETRY — the SINGLE source of truth for page dimensions (task §4/§7).
 *
 * Both the pagination logic (measuring blocks, sizing page gaps) and the CSS (sheet
 * size, padding, gutter) derive from THESE numbers, so there can be no conflicting
 * A4 measurements in TypeScript vs. CSS. The values are applied to the DOM as CSS
 * custom properties (see `pageGeometryVars`), and the CSS reads them via `var(--…)`.
 *
 * A4 at 96dpi is 794 × 1123 px. With comfortable print-like margins the usable
 * content column height is PAGE_HEIGHT − 2·PAGE_MARGIN_Y.
 */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;
export const PAGE_MARGIN_X = 72;
export const PAGE_MARGIN_Y = 72;
/** The visible gray gutter between two consecutive sheets. */
export const INTER_PAGE_GAP = 48;

/** Usable content height on one page (between the top and bottom margins). */
export const PAGE_CONTENT_HEIGHT = PAGE_HEIGHT - 2 * PAGE_MARGIN_Y;

/** Usable content WIDTH on one page (between the left/right margins) — the maximum an
 * image may be resized to, so media can never escape the page/content boundary. */
export const PAGE_CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN_X;

/**
 * Total vertical distance from the top of one page's content to the top of the
 * next page's content at a page boundary: this page's bottom margin + the gutter +
 * the next page's top margin. A boundary gap of `(PAGE_CONTENT_HEIGHT − used) +
 * PAGE_GUTTER` therefore lands the following block exactly at the next page's
 * content top.
 */
export const PAGE_GUTTER = PAGE_MARGIN_Y + INTER_PAGE_GAP + PAGE_MARGIN_Y;

/** Total rendered height of `pageCount` stacked A4 sheets with gutters between them. */
export function stackHeight(pageCount: number): number {
  const n = Math.max(1, pageCount);
  return n * PAGE_HEIGHT + (n - 1) * INTER_PAGE_GAP;
}

/**
 * The geometry as CSS custom properties, applied to the pages root so the CSS and
 * the TypeScript share one definition. Typed as a plain record for React's `style`.
 */
export const pageGeometryVars: Record<string, string> = {
  '--page-width': `${PAGE_WIDTH}px`,
  '--page-height': `${PAGE_HEIGHT}px`,
  '--page-margin-x': `${PAGE_MARGIN_X}px`,
  '--page-margin-y': `${PAGE_MARGIN_Y}px`,
  '--inter-page-gap': `${INTER_PAGE_GAP}px`,
};
