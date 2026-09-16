import { describe, expect, it } from 'vitest';
import {
  INTER_PAGE_GAP,
  PAGE_CONTENT_HEIGHT,
  PAGE_GUTTER,
  PAGE_HEIGHT,
  PAGE_MARGIN_Y,
  stackHeight,
} from './pageGeometry.js';

/**
 * The A4 geometry is the single source of truth shared by the pagination logic and
 * the CSS. These lock in the internal consistency the page layout relies on so a
 * short/empty page can never collapse and content aligns onto each backdrop sheet.
 */
describe('page geometry', () => {
  it('derives the content height from the page height and margins', () => {
    expect(PAGE_CONTENT_HEIGHT).toBe(PAGE_HEIGHT - 2 * PAGE_MARGIN_Y);
  });

  it('a boundary gap (remaining + gutter) advances exactly one page', () => {
    // Content used on a page + the gap that follows must equal one page-to-page step
    // (content height + gutter), so the next block lands at the next page's top.
    const used = 400;
    const remaining = PAGE_CONTENT_HEIGHT - used;
    expect(used + remaining + PAGE_GUTTER).toBe(PAGE_CONTENT_HEIGHT + PAGE_GUTTER);
    // And one page-to-page step equals a full sheet + the inter-sheet gutter gap.
    expect(PAGE_CONTENT_HEIGHT + PAGE_GUTTER).toBe(PAGE_HEIGHT + INTER_PAGE_GAP);
  });

  it('stackHeight matches N full sheets with (N-1) gutters', () => {
    expect(stackHeight(1)).toBe(PAGE_HEIGHT);
    expect(stackHeight(2)).toBe(2 * PAGE_HEIGHT + INTER_PAGE_GAP);
    expect(stackHeight(3)).toBe(3 * PAGE_HEIGHT + 2 * INTER_PAGE_GAP);
  });

  it('never returns less than one full page', () => {
    expect(stackHeight(0)).toBe(PAGE_HEIGHT);
    expect(stackHeight(-5)).toBe(PAGE_HEIGHT);
  });
});
