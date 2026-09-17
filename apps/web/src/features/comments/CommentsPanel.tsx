import type { Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import { type EditorUser } from '../editor/extensions.js';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';
import {
  deleteCommentThread,
  findCommentRange,
  scrollToComment,
  setCommentResolved,
  useComments,
} from './commentsStore.js';

interface CommentsPanelProps {
  editor: Editor;
  ydoc: Y.Doc;
  user?: EditorUser;
  onClose: () => void;
}

/**
 * Comments side panel (ADR 0013): lists every comment thread from the Yjs comments map
 * (live), lets an editor resolve/reopen/delete, shows the author, and navigates to a
 * comment's anchored text. It is a pure view over CRDT state — it never stores comment
 * data in React/local storage. Read-only for viewers (mutations are also rejected
 * server-side because a viewer's collaboration connection is read-only).
 */
export function CommentsPanel({ editor, ydoc, user, onClose }: CommentsPanelProps) {
  const threads = useComments(ydoc);
  const canMutate = editor.isEditable;

  return (
    <aside className="scribe-comments-panel" aria-label="Comments" role="complementary">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">
          Comments {threads.length > 0 && <span className="text-ink-3">({threads.length})</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comments"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-subtle hover:text-ink focus:outline-none focus-visible:shadow-focus-ring"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      {threads.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">
          No comments yet. Select text and choose the comment action to add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto p-3">
          {threads.map((t) => {
            const hasAnchor = findCommentRange(editor, t.id) !== null;
            return (
              <li
                key={t.id}
                className={cn(
                  'rounded-md border border-border bg-sheet p-3 shadow-sheet',
                  t.resolved && 'opacity-60',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{t.authorName}</span>
                  <time className="text-[11px] text-ink-3" dateTime={t.createdAt}>
                    {new Date(t.createdAt).toLocaleDateString()}
                  </time>
                </div>
                <button
                  type="button"
                  onClick={() => scrollToComment(editor, t.id)}
                  disabled={!hasAnchor}
                  className="mb-2 block w-full text-left text-sm text-ink-2 hover:text-ink disabled:cursor-default disabled:text-ink-3"
                  title={hasAnchor ? 'Go to commented text' : 'The commented text was removed'}
                >
                  {t.text}
                  {!hasAnchor && (
                    <span className="ml-1 text-[11px] italic text-ink-3">(anchor removed)</span>
                  )}
                </button>

                {canMutate && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setCommentResolved(ydoc, editor, t.id, !t.resolved, user?.name ?? null)
                      }
                      className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft focus:outline-none focus-visible:shadow-focus-ring"
                    >
                      {t.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCommentThread(ydoc, editor, t.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-error hover:bg-subtle focus:outline-none focus-visible:shadow-focus-ring"
                    >
                      Delete
                    </button>
                    {t.resolved && (
                      <span className="ml-auto text-[11px] text-ink-3">
                        Resolved{t.resolvedBy ? ` by ${t.resolvedBy}` : ''}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
