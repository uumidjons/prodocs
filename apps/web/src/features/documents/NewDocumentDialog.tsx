import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TemplateDto } from '@scribe/shared';
import { ApiError, api } from '../../api/index.js';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';
import { cn } from '../../ui/cn.js';

/**
 * The "New Document" creation flow (task §1/§3). Two distinct paths:
 *
 *   - Blank document — creates a genuinely EMPTY document (nothing copied from any
 *     other document); it opens as an empty A4 page.
 *   - From a system TEMPLATE — creates a NEW, independent document initialized from a
 *     product-provided template's content. The template is a source; the new document
 *     is a normal user document (its own id, the user is owner) that appears in
 *     Documents, never in this picker.
 *
 * The template list is the server's system templates (`GET /api/templates`) — it
 * NEVER contains the user's own documents, shared documents, recent documents, or
 * documents created from a template. The copy is performed server-side into the new
 * document's own Yjs state; the source template is never modified.
 */
/** The default a new document is given when the user doesn't choose a name. Must match
 * the server's own default so an unchanged/blank name is stored as this exact title. */
const DEFAULT_TITLE = 'Untitled document';
/** Mirrors documentTitleSchema.max in @scribe/shared (single source of truth for length). */
const TITLE_MAX = 200;

export function NewDocumentDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const nameRef = useRef<HTMLInputElement>(null);

  // Open focused on the name with the default pre-SELECTED, so the user can immediately
  // type a replacement without first selecting all (task §3 creation-name UX).
  useEffect(() => {
    const el = nameRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Close on Escape — standard modal behavior (mirrors ShareDialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // Load the SYSTEM TEMPLATES to offer (never the user's own documents).
  useEffect(() => {
    let cancelled = false;
    api.templates
      .list()
      .then((tpls) => {
        if (!cancelled) setTemplates(tpls);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setListError(err instanceof ApiError ? err.message : 'Could not load templates');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(fromTemplateId?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Single source of truth for the title: the creation request carries it. A blank /
    // whitespace-only / unchanged-default name is sent as undefined so the SERVER applies
    // its own default (DEFAULT_TITLE for a blank doc, the template's title for a template).
    // The title is stored as plain text (React escapes on render, the DB uses parameterized
    // queries), and the shared schema trims + caps its length — so no injection or stray
    // whitespace, and Unicode titles are preserved as typed.
    const trimmed = title.trim();
    const chosen = trimmed && trimmed !== DEFAULT_TITLE ? trimmed : undefined;
    try {
      const doc = await api.documents.create({
        ...(chosen ? { title: chosen } : {}),
        ...(fromTemplateId ? { fromTemplateId } : {}),
      });
      onClose();
      navigate(`/d/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the document');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.2)] px-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New document"
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg bg-sheet shadow-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
            <Icon name="note_add" size={18} className="text-primary" />
            New document
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1.5 text-ink-2 hover:bg-subtle disabled:opacity-50"
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {/* Document name (task §3). Defaults to "Untitled document", pre-selected on
              open so it is trivial to replace. Enter creates a blank document with this
              name; the busy guard prevents a double-create from a double Enter/click. */}
          <label
            htmlFor="new-doc-name"
            className="mb-1.5 block text-label-md font-semibold uppercase tracking-wide text-ink-3"
          >
            Name
          </label>
          <input
            id="new-doc-name"
            ref={nameRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
            maxLength={TITLE_MAX}
            disabled={busy}
            placeholder={DEFAULT_TITLE}
            aria-label="Document name"
            className="mb-4 w-full rounded-md border border-input-border bg-surface px-3 py-2 text-body-default text-ink outline-none focus-visible:shadow-focus-ring placeholder:text-ink-3 disabled:opacity-60"
          />

          {/* Blank */}
          <button
            onClick={() => void create()}
            disabled={busy}
            className={cn(
              'group flex w-full items-center gap-3 rounded-md border border-border bg-sheet px-4 py-3 text-left',
              'shadow-sm transition-shadow hover:shadow-card disabled:opacity-60',
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <Icon name="draft" size={22} />
            </span>
            <span className="min-w-0">
              <span className="block font-display text-headline-sm text-ink">Blank document</span>
              <span className="block text-body-sm text-ink-3">Start from an empty page.</span>
            </span>
          </button>

          {/* System templates */}
          <h3 className="mb-2 mt-6 text-label-md font-semibold uppercase tracking-wide text-ink-3">
            Templates
          </h3>

          {!templates && !listError && (
            <div className="flex justify-center py-8">
              <Spinner size={22} />
            </div>
          )}

          {listError && (
            <p className="rounded-md bg-error-bg px-3 py-2 text-body-sm text-error">{listError}</p>
          )}

          {templates && templates.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-body-sm text-ink-3">
              No templates are available yet.
            </p>
          )}

          {templates && templates.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    onClick={() => void create(tpl.id)}
                    disabled={busy}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left',
                      'transition-colors hover:border-border hover:bg-subtle disabled:opacity-60',
                    )}
                  >
                    <Icon name="dashboard" size={20} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-default font-medium text-ink">
                        {tpl.title}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer status */}
        {(busy || error) && (
          <div className="border-t border-border px-5 py-3">
            {busy && (
              <span className="flex items-center gap-2 text-body-sm text-ink-2">
                <Spinner size={16} /> Creating document…
              </span>
            )}
            {error && (
              <span className="flex items-center gap-2 text-body-sm text-error">
                <Icon name="error" size={16} /> {error}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
