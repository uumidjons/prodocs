import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import { COMMENTS_MAP_KEY, type CommentThread } from '@scribe/shared';

/**
 * COMMENTS store (ADR 0013). The source of truth is a `Y.Map` in the SAME Y.Doc as the
 * document text, so comment thread data is CRDT state: it converges across
 * collaborators, works offline, and persists through the existing collaboration
 * persistence — no second sync engine, no database table.
 *
 * The ANCHOR is the `comment` mark in the document (moves via ProseMirror mapping); this
 * module owns the thread DATA (author, text, resolved) plus helpers to locate/navigate
 * the anchor. Thread objects are stored as whole values per comment id; concurrent edits
 * to the SAME comment resolve last-writer-per-key (documented), while different comments
 * are fully independent.
 */

export function getCommentsMap(ydoc: Y.Doc): Y.Map<CommentThread> {
  return ydoc.getMap<CommentThread>(COMMENTS_MAP_KEY);
}

/** React hook: the current comment threads (sorted oldest-first), live over Yjs. */
export function useComments(ydoc: Y.Doc | null): CommentThread[] {
  const [threads, setThreads] = useState<CommentThread[]>([]);

  useEffect(() => {
    if (!ydoc) return;
    const map = getCommentsMap(ydoc);
    const read = () =>
      setThreads([...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)));
    read();
    map.observe(read);
    return () => map.unobserve(read);
  }, [ydoc]);

  return threads;
}

/** Write a new comment thread (the caller has already applied the anchor mark). */
export function addCommentThread(ydoc: Y.Doc, thread: CommentThread): void {
  getCommentsMap(ydoc).set(thread.id, thread);
}

/** Set/clear the resolved state of a thread (and mirror it on the anchor mark). */
export function setCommentResolved(
  ydoc: Y.Doc,
  editor: Editor,
  commentId: string,
  resolved: boolean,
  resolvedBy: string | null,
): void {
  const map = getCommentsMap(ydoc);
  const thread = map.get(commentId);
  if (thread) map.set(commentId, { ...thread, resolved, resolvedBy: resolved ? resolvedBy : null });
  // Mirror onto the mark so the highlight can dim without reading the map in CSS.
  updateMarkResolved(editor, commentId, resolved);
}

/** Delete a comment: remove its thread data AND its anchor mark from the document. */
export function deleteCommentThread(ydoc: Y.Doc, editor: Editor, commentId: string): void {
  getCommentsMap(ydoc).delete(commentId);
  editor.chain().focus().unsetComment(commentId).run();
}

/** Find the document range covered by a comment's anchor mark, or null if gone. */
export function findCommentRange(
  editor: Editor,
  commentId: string,
): { from: number; to: number } | null {
  const markType = editor.schema.marks.comment;
  if (!markType) return null;
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const has = node.marks.some((m) => m.type === markType && m.attrs.commentId === commentId);
    if (has) {
      if (from === -1) from = pos;
      to = pos + node.nodeSize;
    }
  });
  return from === -1 ? null : { from, to };
}

/** Select and scroll to a comment's anchored text (navigation between comments). */
export function scrollToComment(editor: Editor, commentId: string): void {
  const range = findCommentRange(editor, commentId);
  if (!range) return;
  editor.chain().focus().setTextSelection(range).scrollIntoView().run();
}

/** Update the `resolved` attribute on every comment-mark instance for this id. */
function updateMarkResolved(editor: Editor, commentId: string, resolved: boolean): void {
  const markType = editor.schema.marks.comment;
  if (!markType) return;
  editor.commands.command(({ tr, state, dispatch }) => {
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      node.marks.forEach((m) => {
        if (m.type === markType && m.attrs.commentId === commentId) {
          tr.addMark(pos, pos + node.nodeSize, markType.create({ commentId, resolved }));
          changed = true;
        }
      });
    });
    if (changed && dispatch) dispatch(tr);
    return changed;
  });
}
