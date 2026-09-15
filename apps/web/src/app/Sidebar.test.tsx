import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './Sidebar.js';

/**
 * Sidebar navigation (task §8): every section is a real route, and the active section
 * is visually distinguished (NavLink sets aria-current="page").
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar navigation', () => {
  it('links every section to its route', () => {
    renderAt('/');
    const expectHref = (name: RegExp, href: string) =>
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    expectHref(/Documents/, '/');
    expectHref(/Recent/, '/recent');
    expectHref(/Templates/, '/templates');
    expectHref(/Shared with Me/, '/shared');
    expectHref(/Trash/, '/trash');
    expectHref(/Settings/, '/settings');
  });

  it('marks the current section active', () => {
    renderAt('/trash');
    expect(screen.getByRole('link', { name: /Trash/ })).toHaveAttribute('aria-current', 'page');
    // Documents (root) must NOT be active on /trash (exact-match `end`).
    expect(screen.getByRole('link', { name: /Documents/ })).not.toHaveAttribute('aria-current');
  });

  it('marks Documents active only on the exact root route', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /Documents/ })).toHaveAttribute('aria-current', 'page');
  });
});
