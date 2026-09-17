import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * COMMENT mark — the ANCHOR for an inline comment (ADR 0013).
 *
 * A comment is NOT document text: this mark only tints a range and records a
 * `commentId`; it adds/removes no characters. Because it is an ordinary ProseMirror
 * mark inside the collaborative Yjs document, ProseMirror transaction mapping moves the
 * anchor automatically as surrounding text changes — we never store raw absolute
 * offsets. The thread data (author, text, resolved, …) lives in a `Y.Map` in the SAME
 * Y.Doc (see the web comments store), so anchor + data are one CRDT with one source of
 * truth. Export ignores this mark, so comments never leak into PDF/DOCX.
 *
 * Part of the SHARED schema so client and server (seeding schema) agree.
 */

export const COMMENTS_MAP_KEY = 'comments';

/** One comment thread's data, stored in the Yjs comments map (source of truth). */
export interface CommentThread {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  resolvedBy?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Apply a comment mark carrying `commentId` to the current selection. */
      setComment: (commentId: string) => ReturnType;
      /** Remove the comment mark with `commentId` from the range it covers. */
      unsetComment: (commentId: string) => ReturnType;
    };
  }
}

export const Comment = Mark.create({
  name: 'comment',
  // Comments should not be inclusive at the edges: typing right after a commented word
  // must NOT extend the comment onto the new text.
  inclusive: false,
  // Multiple comments can coexist with other marks (bold, links, …).
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) =>
          attrs.commentId ? { 'data-comment-id': attrs.commentId as string } : {},
      },
      /** Purely presentational: whether the thread is resolved (dims the highlight). */
      resolved: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-comment-resolved') === 'true',
        renderHTML: (attrs) => (attrs.resolved ? { 'data-comment-resolved': 'true' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'scribe-comment' }), 0];
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId, resolved: false }),
      unsetComment:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          // Remove only the mark instances carrying this commentId, across the doc.
          const markType = state.schema.marks[this.name];
          if (!markType) return false;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            node.marks.forEach((m) => {
              if (m.type === markType && m.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, m);
                changed = true;
              }
            });
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
