import { describe, expect, it } from 'vitest';
import { roleAtLeast, PRESENCE_COLORS } from './roles.js';

describe('roleAtLeast', () => {
  it('owner satisfies every requirement', () => {
    expect(roleAtLeast('owner', 'owner')).toBe(true);
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('owner', 'viewer')).toBe(true);
  });

  it('editor can edit and view but not own', () => {
    expect(roleAtLeast('editor', 'owner')).toBe(false);
    expect(roleAtLeast('editor', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'viewer')).toBe(true);
  });

  it('viewer can only view', () => {
    expect(roleAtLeast('viewer', 'editor')).toBe(false);
    expect(roleAtLeast('viewer', 'viewer')).toBe(true);
  });
});

describe('presence palette', () => {
  it('exposes distinct hex colors', () => {
    expect(new Set(PRESENCE_COLORS).size).toBe(PRESENCE_COLORS.length);
    for (const c of PRESENCE_COLORS) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
