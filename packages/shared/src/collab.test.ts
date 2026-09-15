import { describe, expect, it } from 'vitest';
import { collaborationColor, readableTextColor } from './collab.js';
import { PRESENCE_COLORS } from './roles.js';

describe('collaborationColor', () => {
  it('returns a color from the presence palette', () => {
    const color = collaborationColor('user-123');
    expect(PRESENCE_COLORS).toContain(color);
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('is deterministic — the same id always maps to the same color', () => {
    const id = '9f1c2b3a-1111-2222-3333-444455556666';
    expect(collaborationColor(id)).toBe(collaborationColor(id));
  });

  it('distributes distinct ids across the palette (distinguishable collaborators)', () => {
    // A handful of distinct ids should not all collapse to one color.
    const ids = Array.from({ length: 12 }, (_, i) => `user-${i}-abcdef`);
    const distinct = new Set(ids.map(collaborationColor));
    expect(distinct.size).toBeGreaterThan(1);
    // With 12 ids over a 6-color palette we expect good spread.
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });
});

describe('readableTextColor', () => {
  it('uses white text on dark colors and dark text on light colors', () => {
    expect(readableTextColor('#3B49DF')).toBe('#FFFFFF'); // indigo (dark)
    expect(readableTextColor('#F59E0B')).toBe('#0F172A'); // amber (light)
  });

  it('returns a valid contrast color for every palette color', () => {
    for (const c of PRESENCE_COLORS) {
      expect(['#0F172A', '#FFFFFF']).toContain(readableTextColor(c));
    }
  });
});
