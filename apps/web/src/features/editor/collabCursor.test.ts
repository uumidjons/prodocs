import { describe, expect, it } from 'vitest';
import { renderCollaborationCaret, renderCollaborationSelection } from './collabCursor.js';

/**
 * Unit tests for the remote-cursor / remote-selection presentation builders. These
 * assert the identity + color wiring (name label, per-collaborator inline color,
 * translucent selection) without a live provider — the awareness → position wiring
 * is Tiptap/Yjs and is covered by the E2E collaboration suite.
 */

describe('renderCollaborationCaret', () => {
  it('renders a caret bar carrying a name label in the collaborator color', () => {
    const el = renderCollaborationCaret({ id: 'u1', name: 'John Smith', color: '#10B981' });
    expect(el.classList.contains('collaboration-cursor__caret')).toBe(true);
    expect(el.getAttribute('style')).toContain('background-color: #10B981');

    const label = el.querySelector('.collaboration-cursor__label') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('John Smith');
    // Label background is the collaborator color; text color is a readable contrast.
    expect(label.getAttribute('style')).toContain('background-color: #10B981');
    expect(label.getAttribute('style')).toContain('color: #FFFFFF');
  });

  it('uses a dark, readable label text color on a light collaborator color', () => {
    const el = renderCollaborationCaret({ id: 'u2', name: 'Sarah Lee', color: '#F59E0B' });
    const label = el.querySelector('.collaboration-cursor__label') as HTMLElement;
    expect(label.getAttribute('style')).toContain('color: #0F172A');
  });

  it('gives different collaborators different caret colors', () => {
    const a = renderCollaborationCaret({ id: 'a', name: 'A', color: '#10B981' });
    const b = renderCollaborationCaret({ id: 'b', name: 'B', color: '#F43F5E' });
    expect(a.getAttribute('style')).not.toBe(b.getAttribute('style'));
  });

  it('falls back gracefully when identity fields are missing', () => {
    const el = renderCollaborationCaret({});
    const label = el.querySelector('.collaboration-cursor__label') as HTMLElement;
    expect(label.textContent).toBe('Collaborator');
    expect(el.getAttribute('style')).toMatch(/background-color: #[0-9A-Fa-f]{6}/);
  });

  it('does not expose any identity beyond the display name (no email/tokens)', () => {
    const el = renderCollaborationCaret({
      id: 'u3',
      name: 'Ada Lovelace',
      color: '#8B5CF6',
    });
    expect(el.textContent).toBe('Ada Lovelace');
    expect(el.outerHTML).not.toMatch(/@|token|password/i);
  });
});

describe('renderCollaborationSelection', () => {
  it('is translucent (14% wash) with a solid underline in the collaborator color', () => {
    const deco = renderCollaborationSelection({ id: 'u1', name: 'John', color: '#10B981' });
    expect(deco.class).toBe('collaboration-selection');
    // 0x24 ≈ 14% alpha wash so underlying text stays readable.
    expect(deco.style).toContain('background-color: #10B98124');
    expect(deco.style).toContain('border-bottom: 2px solid #10B981');
  });

  it('keeps each collaborator selection independent (distinct colors)', () => {
    const a = renderCollaborationSelection({ color: '#10B981' });
    const b = renderCollaborationSelection({ color: '#F43F5E' });
    expect(a.style).not.toBe(b.style);
  });
});
