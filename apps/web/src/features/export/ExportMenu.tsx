import { useEffect, useRef, useState } from 'react';
import { sanitizeFilename, type ExportMediaFetcher } from '@scribe/shared';
import { fetchMediaBlob } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useExportStore } from './exportStore.js';
import { exportDocumentToPdfBlob } from './pdf.js';
import { exportDocumentToDocxBlob } from './docx.js';
import { triggerDownload } from './download.js';

type Format = 'pdf' | 'docx';

const LABEL: Record<Format, { busy: string; ext: string; icon: string; menu: string }> = {
  pdf: { busy: 'Generating PDF…', ext: 'pdf', icon: 'picture_as_pdf', menu: 'PDF' },
  docx: { busy: 'Generating Word…', ext: 'docx', icon: 'description', menu: 'Word (.docx)' },
};

/**
 * Header Export control (task §3/§12): a small dropdown offering PDF and Word.
 *
 * Export is a READ operation, so it is available to every role that can open the
 * document (owner, editor, viewer). It serializes the current editor state
 * (`editor.getJSON()`) — a read-only snapshot of the collaborative document — entirely
 * client-side and hands the user a download. It never mutates the editor or Y.Doc, so
 * it cannot disturb collaborators. A generation in progress disables both items to
 * prevent duplicate exports; failures surface as inline text, never a blocking alert.
 */
export function ExportMenu() {
  const editor = useExportStore((s) => s.editor);
  const activeDocument = useUiStore((s) => s.activeDocument);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside pointer press / Escape (mirrors the profile menu).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!activeDocument) return null;

  const filenameBase = sanitizeFilename(activeDocument.title);
  const docId = activeDocument.id;

  async function runExport(format: Format) {
    if (busy || !editor) return;
    setError(null);
    setBusy(format);
    try {
      // A read-only snapshot of the current document — no setContent, no mutation.
      const json = editor.getJSON();
      // Media fetcher bound to THIS document + the authenticated endpoint (ADR 0012):
      // export only ever fetches the current document's authorized media, never
      // arbitrary URLs. Text/formatting export is still fully offline; only images
      // require the network, and an unavailable image degrades to a placeholder.
      const fetchMedia: ExportMediaFetcher = async (mediaId) => {
        try {
          const blob = await fetchMediaBlob(docId, mediaId);
          return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
        } catch {
          return null;
        }
      };
      const blob =
        format === 'pdf'
          ? await exportDocumentToPdfBlob(json, fetchMedia)
          : await exportDocumentToDocxBlob(json, fetchMedia);
      triggerDownload(blob, `${filenameBase}.${LABEL[format].ext}`);
      setOpen(false);
    } catch {
      // No stack traces to the user; the editor and document are untouched.
      setError(`Could not generate ${format === 'pdf' ? 'PDF' : 'Word'}. Please try again.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={!editor}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? <Spinner size={16} /> : <Icon name="download" size={18} />}
        {busy ? LABEL[busy].busy : 'Export'}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Export document"
          // z-40: above the sticky format toolbar (z-30), whose full-width container
          // would otherwise intercept clicks on the lower menu items.
          className="absolute right-0 top-11 z-40 w-56 rounded-md border border-border bg-sheet p-1.5 shadow-overlay"
        >
          {(['pdf', 'docx'] as Format[]).map((format) => (
            <button
              key={format}
              role="menuitem"
              onClick={() => void runExport(format)}
              disabled={busy !== null}
              className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-body-default text-ink-2 hover:bg-subtle disabled:opacity-50"
            >
              <Icon name={LABEL[format].icon} size={18} />
              {busy === format ? LABEL[format].busy : LABEL[format].menu}
            </button>
          ))}
          {error && (
            <p role="alert" className="px-2 py-1.5 text-body-sm text-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
