import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import type { CommentThread } from '@scribe/shared';
import { type EditorUser } from '../editor/extensions.js';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';
import { addCommentThread } from './commentsStore.js';

interface CommentButtonProps {
  editor: Editor;
  ydoc?: Y.Doc | null;
  user?: EditorUser;
  /** True when the selection currently sits inside a comment (highlights the button). */
  active: boolean;
  /** Whether a non-empty range is selected (a comment needs an anchor range). */
  hasRange: boolean;
  disabled?: boolean;
  /** Called after a comment is created so the host can open the comments panel. */
  onCreated: () => void;
}

/**
 * Add-comment toolbar control (ADR 0013). Requires a non-empty selection (the anchor
 * range). On submit it applies the `comment` mark to the selection and writes the thread
 * data into the Yjs comments map — one CRDT transaction path, so it collaborates, works
 * offline, and undoes like any edit. Disabled for viewers and when nothing is selected.
 */
export function CommentButton({
  editor,
  ydoc,
  user,
  active,
  hasRange,
  disabled = false,
  onCreated,
}: CommentButtonProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(id);
    };
  }, [open]);

  const canComment = !disabled && hasRange && !!ydoc;

  function submit() {
    const body = text.trim();
    if (!body || !ydoc) return;
    const commentId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const thread: CommentThread = {
      id: commentId,
      authorId: user?.id ?? 'unknown',
      authorName: user?.name ?? 'Unknown',
      text: body,
      createdAt: new Date().toISOString(),
      resolved: false,
      resolvedBy: null,
    };
    // Anchor mark first (on the current selection), then the thread data — both are Yjs.
    editor.chain().focus().setComment(commentId).run();
    addCommentThread(ydoc, thread);
    setText('');
    setOpen(false);
    onCreated();
  }

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={() => canComment && setOpen((v) => !v)}
        disabled={!canComment}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={active}
        aria-label="Add comment"
        title={hasRange ? 'Add comment' : 'Select text to comment on'}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          'focus:outline-none focus-visible:shadow-focus-ring',
          active
            ? 'bg-primary-soft text-primary'
            : 'text-ink-2 hover:bg-subtle hover:text-ink disabled:hover:bg-transparent',
          'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-60',
        )}
      >
        <Icon name="add_comment" size={20} filled={active} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Add comment"
          className="absolute left-0 top-10 z-40 w-72 rounded-md border border-input-border bg-sheet p-2 shadow-overlay"
        >
          <label htmlFor={fieldId} className="sr-only">
            Comment
          </label>
          <textarea
            id={fieldId}
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Add a comment…"
            className="w-full resize-none rounded-md border border-input-border bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus-visible:shadow-focus-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-ink-2 hover:bg-subtle hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
