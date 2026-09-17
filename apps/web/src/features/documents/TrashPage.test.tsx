import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDto } from '@scribe/shared';

/**
 * Trash page (task §5/§9): lists soft-deleted documents with Restore + permanent
 * Delete (two-step), and shows a proper empty state.
 */
const listMock = vi.fn();
const restoreMock = vi.fn();
const purgeMock = vi.fn();

vi.mock('../../api/index.js', () => ({
  api: {
    documents: {
      list: (view: string) => listMock(view),
      restore: (id: string) => restoreMock(id),
      purge: (id: string) => purgeMock(id),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const { TrashPage } = await import('./TrashPage.js');

const trashedDoc: DocumentDto = {
  id: 'd1',
  title: 'Deleted Doc',
  ownerId: 'u1',
  ownerName: 'Me',
  role: 'owner',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: null,
  deletedAt: new Date().toISOString(),
};

function renderPage() {
  return render(
    <MemoryRouter>
      <TrashPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  restoreMock.mockReset();
  purgeMock.mockReset();
  restoreMock.mockResolvedValue(undefined);
  purgeMock.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('TrashPage', () => {
  it('shows the empty state when Trash is empty', async () => {
    listMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
  });

  it('lists trashed documents and restores one', async () => {
    listMock.mockResolvedValue([trashedDoc]);
    renderPage();
    expect(await screen.findByText('Deleted Doc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith('d1'));
  });

  it('requires a confirm step before permanently deleting', async () => {
    listMock.mockResolvedValue([trashedDoc]);
    renderPage();
    await screen.findByText('Deleted Doc');
    // First click reveals the confirm step; it does not purge yet.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(purgeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(purgeMock).toHaveBeenCalledWith('d1'));
  });
});
