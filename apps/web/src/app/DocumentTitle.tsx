import { type FocusEvent, type KeyboardEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../api/index.js';
import { useUiStore } from '../stores/uiStore.js';
import type { ActiveDocument } from '../stores/uiStore.js';

/**
 * The document's identity in the application header (task §1). The title is ordinary
 * document METADATA (persisted via the existing PATCH endpoint) — it is deliberately
 * NOT part of the collaborative Y.Doc body, so editing it can never corrupt or
 * interfere with document content.
 *
 * The title displayed here is the single source of truth (`uiStore.activeDocument`,
 * populated by DocumentView from server metadata). Renames update the store
 * optimistically and persist on blur/Enter; a failed save reverts to the last known
 * good title and surfaces a message. Viewers see it read-only.
 */
export function DocumentTitle({ document }: { document: ActiveDocument }) {
  const setActiveDocumentTitle = useUiStore((s) => s.setActiveDocumentTitle);
  const [draft, setDraft] = useState(document.title);
  const [error, setError] = useState<string | null>(null);

  // Keep the local draft in sync when the active document (or its title) changes
  // from outside — e.g. document switch or a store-level update.
  useEffect(() => {
    setDraft(document.title);
  }, [document.id, document.title]);

  const readOnly = document.role === 'viewer';

  async function save(next: string) {
    const trimmed = next.trim();
    // Titles cannot be empty — revert to the last known good value.
    if (!trimmed) {
      setDraft(document.title);
      return;
    }
    if (trimmed === document.title) return;
    setError(null);
    // Optimistic: reflect immediately, roll back on failure.
    setActiveDocumentTitle(trimmed);
    try {
      await api.documents.updateTitle(document.id, { title: trimmed });
    } catch (err) {
      setActiveDocumentTitle(document.title);
      setDraft(document.title);
      setError(err instanceof ApiError ? err.message : 'Could not save the title');
    }
  }

  function onBlur(e: FocusEvent<HTMLInputElement>) {
    void save(e.target.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(document.title);
      e.currentTarget.blur();
    }
  }

  // Intrinsic sizing: the input's `size` tracks the content length so a short title
  // takes only the space it needs (no giant flex element), while `max-w-*` caps it so
  // a long title truncates with an ellipsis instead of pushing the header actions off
  // screen. `min` keeps a comfortable editing width even for short/empty names.
  const contentLength = draft.length || 'Untitled document'.length;
  const inputSize = Math.min(Math.max(contentLength, 12), 60);

  return (
    <div className="flex min-w-0 flex-col justify-center">
      <input
        // Steady horizontal padding (not focus-only) so focusing never nudges the
        // header layout; only the background changes to signal editability.
        className="min-w-0 max-w-full truncate rounded-sm bg-transparent px-1.5 py-0.5 font-display text-headline-sm text-ink outline-none hover:bg-subtle focus:bg-subtle placeholder:text-ink-3"
        size={inputSize}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.select()}
        placeholder="Untitled document"
        readOnly={readOnly}
        aria-label="Document title"
        title={draft}
      />
      {error && <span className="truncate text-label-sm text-error">{error}</span>}
    </div>
  );
}
