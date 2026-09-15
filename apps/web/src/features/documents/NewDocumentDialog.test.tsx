import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouter from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * New Document dialog (task §1/§3). It must offer Blank + the SYSTEM templates only —
 * never the user's own documents — and route each choice to the correct create call.
 */

const listTemplatesMock = vi.fn();
const createMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../../api/index.js', () => ({
  api: {
    templates: { list: () => listTemplatesMock() },
    documents: { create: (input: unknown) => createMock(input) },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const { NewDocumentDialog } = await import('./NewDocumentDialog.js');

function renderDialog() {
  return render(
    <MemoryRouter>
      <NewDocumentDialog onClose={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listTemplatesMock.mockReset();
  createMock.mockReset();
  navigateMock.mockReset();
  listTemplatesMock.mockResolvedValue([
    { id: 'tpl-1', title: 'Meeting Notes' },
    { id: 'tpl-2', title: 'Project Brief' },
  ]);
  createMock.mockResolvedValue({ id: 'new-doc' });
});

afterEach(() => vi.restoreAllMocks());

describe('NewDocumentDialog', () => {
  it('lists the system templates (from the templates API, not documents)', async () => {
    renderDialog();
    expect(await screen.findByText('Meeting Notes')).toBeInTheDocument();
    expect(screen.getByText('Project Brief')).toBeInTheDocument();
    // It fetches templates, never the user's document list.
    expect(listTemplatesMock).toHaveBeenCalledTimes(1);
  });

  it('Blank document creates an empty document (no source)', async () => {
    renderDialog();
    fireEvent.click(await screen.findByText('Blank document'));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({}));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/d/new-doc'));
  });

  it('choosing a template creates from that template id', async () => {
    renderDialog();
    fireEvent.click(await screen.findByText('Meeting Notes'));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ fromTemplateId: 'tpl-1' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/d/new-doc'));
  });
});
