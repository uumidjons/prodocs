import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Header document-title tests (task §1). The title is document METADATA edited in the
 * application header and persisted via the existing PATCH endpoint — never part of
 * the collaborative body. These assert it renders in the header, persists on
 * blur/Enter, and is read-only for viewers.
 */

const updateTitleMock = vi.fn();

vi.mock('../api/index.js', () => ({
  api: { documents: { updateTitle: (id: string, input: unknown) => updateTitleMock(id, input) } },
  ApiError: class ApiError extends Error {},
}));

const { DocumentTitle } = await import('./DocumentTitle.js');
const { useUiStore } = await import('../stores/uiStore.js');

beforeEach(() => {
  updateTitleMock.mockReset();
  updateTitleMock.mockResolvedValue({});
  useUiStore.getState().setActiveDocument(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocumentTitle (header)', () => {
  it('renders the document title in the header', async () => {
    render(<DocumentTitle document={{ id: 'd1', role: 'owner', title: 'Strategy Doc' }} />);
    const input = (await screen.findByLabelText('Document title')) as HTMLInputElement;
    expect(input.value).toBe('Strategy Doc');
  });

  it('persists a rename via the metadata API on blur', async () => {
    render(<DocumentTitle document={{ id: 'd1', role: 'owner', title: 'Old' }} />);
    const input = (await screen.findByLabelText('Document title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateTitleMock).toHaveBeenCalledWith('d1', { title: 'New Title' }));
  });

  it('does not persist when the title is unchanged', async () => {
    render(<DocumentTitle document={{ id: 'd1', role: 'owner', title: 'Same' }} />);
    const input = await screen.findByLabelText('Document title');
    fireEvent.blur(input);
    expect(updateTitleMock).not.toHaveBeenCalled();
  });

  it('is read-only for viewers', async () => {
    render(<DocumentTitle document={{ id: 'd1', role: 'viewer', title: 'Read Only' }} />);
    const input = (await screen.findByLabelText('Document title')) as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
  });

  it('reverts the draft when Escape is pressed (task §3)', async () => {
    render(<DocumentTitle document={{ id: 'd1', role: 'owner', title: 'Keep Me' }} />);
    const input = (await screen.findByLabelText('Document title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'discarded edit' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(input.value).toBe('Keep Me');
    expect(updateTitleMock).not.toHaveBeenCalled();
  });

  it('sizes to its content and caps long titles so it never fills the header (task §3)', async () => {
    const { rerender } = render(
      <DocumentTitle document={{ id: 'd1', role: 'owner', title: 'Short' }} />,
    );
    const input = (await screen.findByLabelText('Document title')) as HTMLInputElement;
    // Short titles keep a comfortable minimum width rather than collapsing.
    expect(input.size).toBe(12);

    rerender(
      <DocumentTitle
        document={{ id: 'd1', role: 'owner', title: 'A moderately descriptive title here' }}
      />,
    );
    expect(input.size).toBe('A moderately descriptive title here'.length);

    rerender(<DocumentTitle document={{ id: 'd1', role: 'owner', title: 'x'.repeat(200) }} />);
    // Very long titles are capped (then truncate via CSS) instead of growing.
    expect(input.size).toBe(60);
  });
});
