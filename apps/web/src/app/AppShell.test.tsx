import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { AppShell } from './AppShell.js';

/**
 * Browser tab title (task §12): "<title> - Scribe" while a document is open, and just
 * "Scribe" otherwise — following the live active-document title.
 */
beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'a@example.com',
      displayName: 'Ada',
      color: '#3B49DF',
      createdAt: new Date().toISOString(),
    },
    status: 'authenticated',
  });
  useUiStore.setState({ activeDocument: null, connectionStatus: null, presence: [] });
});
afterEach(() => vi.restoreAllMocks());

function renderShell() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell browser title', () => {
  it('is just the app name with no document open', async () => {
    renderShell();
    await waitFor(() => expect(document.title).toBe('ProDocs'));
  });

  it('reflects the active document title and updates when it changes', async () => {
    renderShell();
    useUiStore.getState().setActiveDocument({ id: 'd1', role: 'owner', title: 'Project Brief' });
    await waitFor(() => expect(document.title).toBe('Project Brief - ProDocs'));

    useUiStore.getState().setActiveDocumentTitle('Renamed');
    await waitFor(() => expect(document.title).toBe('Renamed - ProDocs'));

    useUiStore.getState().setActiveDocument(null);
    await waitFor(() => expect(document.title).toBe('ProDocs'));
  });

  it('falls back to "Untitled document" for an empty title', async () => {
    renderShell();
    useUiStore.getState().setActiveDocument({ id: 'd1', role: 'owner', title: '' });
    await waitFor(() => expect(document.title).toBe('Untitled document - ProDocs'));
  });
});
