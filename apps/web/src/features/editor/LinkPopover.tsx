import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { normalizeLinkHref } from '@scribe/shared';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';

interface LinkPopoverProps {
  editor: Editor;
  disabled?: boolean;
  /** True when the current selection already sits inside a link mark. */
  active: boolean;
}

/**
 * Insert-link control for the format ribbon (task §6/§7). A trigger button opens a
 * small popover — NOT a native `window.prompt` — with a URL field, Apply, Cancel, and
 * (when a link is present) Remove.
 *
 * The popover is pure editor UI chrome: it holds only the in-progress URL string in
 * React state and never stores document formatting outside the editor. Applying a link
 * runs a normal ProseMirror command (`setLink`/`unsetLink`) over the current
 * selection, so the link lives in the ProseMirror/Yjs document — it persists,
 * collaborates, works offline, and undoes like any other mark.
 *
 * Selection safety: opening the popover does NOT change the editor selection. We read
 * the existing href from `editor.getAttributes('link')` and, on Apply/Remove, use
 * `extendMarkRange('link')` so an edit covers the whole link even when the caret is
 * merely inside it. Focus returns to the editor after a successful action.
 *
 * URL policy: input is run through the shared {@link normalizeLinkHref} allow-list
 * (http/https/mailto/tel; a bare host is upgraded to https://). Dangerous schemes
 * (javascript:, data:, …) are rejected with an inline message and never applied.
 */
export function LinkPopover({ editor, disabled = false, active }: LinkPopoverProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // Outside-click / Escape close, matching AlignSelect + HeadingSelect.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        editor.commands.focus();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, editor]);

  // Seed the field from the current link (if any) and focus it whenever we open.
  useLayoutEffect(() => {
    if (!open) return;
    const existing = (editor.getAttributes('link').href as string | undefined) ?? '';
    setValue(existing);
    setError(null);
    // Focus after the field has its value so the text is selectable for quick edits.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, editor]);

  function close() {
    setOpen(false);
    setError(null);
  }

  function apply() {
    const href = normalizeLinkHref(value);
    if (!href) {
      setError('Enter a valid http(s), mailto: or tel: URL.');
      return;
    }
    const { selection } = editor.state;
    if (selection.empty && !active) {
      // No text selected and not inside a link → insert the URL as its own linked text
      // so there is something visible to click.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    close();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close();
  }

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={active}
        aria-label={active ? 'Edit link' : 'Insert link'}
        title={active ? 'Edit link' : 'Insert link'}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          'focus:outline-none focus-visible:shadow-focus-ring',
          active
            ? 'bg-primary-soft text-primary'
            : 'text-ink-2 hover:bg-subtle hover:text-ink disabled:hover:bg-transparent',
          'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-60',
        )}
      >
        <Icon name="link" size={20} filled={active} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Link"
          className="absolute left-0 top-10 z-40 w-72 rounded-md border border-input-border bg-sheet p-2 shadow-overlay"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <label htmlFor={`${errorId}-url`} className="sr-only">
              Link URL
            </label>
            <input
              id={`${errorId}-url`}
              ref={inputRef}
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                'w-full rounded-md border bg-surface px-2 py-1.5 text-sm text-ink',
                'focus:outline-none focus-visible:shadow-focus-ring',
                error ? 'border-error' : 'border-input-border',
              )}
            />
            {error && (
              <p id={errorId} role="alert" className="mt-1 text-xs text-error">
                {error}
              </p>
            )}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              {active && (
                <button
                  type="button"
                  onClick={remove}
                  className="mr-auto rounded-md px-2 py-1 text-xs font-medium text-error hover:bg-subtle focus:outline-none focus-visible:shadow-focus-ring"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  close();
                  editor.commands.focus();
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-ink-2 hover:bg-subtle hover:text-ink focus:outline-none focus-visible:shadow-focus-ring"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:shadow-focus-ring"
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
