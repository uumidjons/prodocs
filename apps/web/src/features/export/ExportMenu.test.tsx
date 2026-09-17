import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { useUiStore } from '../../stores/uiStore.js';
import { useExportStore } from './exportStore.js';

// Mock the heavy generators + the download side effect so the test stays fast and
// focuses on the menu's behavior (availability, filename, duplicate prevention).
const triggerDownload = vi.fn();
const pdfBlob = new Blob(['pdf'], { type: 'application/pdf' });
const docxBlob = new Blob(['docx']);
vi.mock('./download.js', () => ({ triggerDownload: (...a: unknown[]) => triggerDownload(...a) }));
vi.mock('./pdf.js', () => ({ exportDocumentToPdfBlob: vi.fn(async () => pdfBlob) }));
vi.mock('./docx.js', () => ({ exportDocumentToDocxBlob: vi.fn(async () => docxBlob) }));

// Imported after the mocks so the component picks up the mocked modules.
const { ExportMenu } = await import('./ExportMenu.js');

const fakeEditor = { getJSON: () => ({ type: 'doc', content: [] }) } as unknown as Editor;

function setup(title = 'My Notes') {
  useUiStore.setState({ activeDocument: { id: 'd1', role: 'viewer', title } });
  useExportStore.setState({ editor: fakeEditor });
  return render(<ExportMenu />);
}

afterEach(() => {
  triggerDownload.mockClear();
  useUiStore.setState({ activeDocument: null });
  useExportStore.setState({ editor: null });
});

describe('ExportMenu', () => {
  it('renders nothing when no document is open', () => {
    useUiStore.setState({ activeDocument: null });
    const { container } = render(<ExportMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is available to a viewer and offers PDF and Word', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByRole('menuitem', { name: /PDF/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Word/i })).toBeInTheDocument();
  });

  it('downloads a PDF named from the document title', async () => {
    setup('My Notes');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /PDF/i }));
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
    expect(triggerDownload).toHaveBeenCalledWith(pdfBlob, 'My Notes.pdf');
  });

  it('sanitizes an unsafe title into the filename', async () => {
    setup('a/b:c');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Word/i }));
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
    expect(triggerDownload).toHaveBeenCalledWith(docxBlob, 'a b c.docx');
  });

  it('disables the button when no editor handle is available', () => {
    useUiStore.setState({ activeDocument: { id: 'd1', role: 'owner', title: 'X' } });
    useExportStore.setState({ editor: null });
    render(<ExportMenu />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });
});
