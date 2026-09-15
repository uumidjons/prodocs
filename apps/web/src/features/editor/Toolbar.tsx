import { type Editor, useEditorState } from '@tiptap/react';
import type * as Y from 'yjs';
import { HeadingSelect, type BlockType } from './HeadingSelect.js';
import { AlignSelect, type TextAlignment } from './AlignSelect.js';
import { ToolbarButton } from './ToolbarButton.js';
import { LinkPopover } from './LinkPopover.js';
import { MediaButton } from './MediaButton.js';
import { type EditorUser } from './extensions.js';
import { CommentButton } from '../comments/CommentButton.js';

/** Thin vertical divider between segments (UI/code.html format ribbon). */
function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />;
}

/**
 * Floating format ribbon (UI/DESIGN.md → "Floating Text Format Ribbon"). It is a
 * pure view over editor state: `useEditorState` recomputes the active flags on
 * each transaction and re-renders only this bar. Every enabled control runs a
 * real editor command; controls for later-phase features are rendered per the
 * design but disabled, so nothing pretends to work.
 *
 * The toolbar talks ONLY to editor commands — it has no knowledge of transport,
 * persistence, or the Yjs binding that will sit under the editor in Phase 2.
 */
interface ToolbarProps {
  editor: Editor;
  /** Enables the media button (needs the document id for authenticated upload). */
  documentId?: string;
  /** The collaborative doc + current user, for creating inline comments. */
  ydoc?: Y.Doc | null;
  user?: EditorUser;
  /** Comments side-panel visibility + toggle. */
  commentsOpen?: boolean;
  onToggleComments?: () => void;
}

export function Toolbar({
  editor,
  documentId,
  ydoc,
  user,
  commentsOpen = false,
  onToggleComments,
}: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      editable: ed.isEditable,
      canUndo: ed.can().undo(),
      canRedo: ed.can().redo(),
      isComment: ed.isActive('comment'),
      hasRange: !ed.state.selection.empty,
      isBold: ed.isActive('bold'),
      isItalic: ed.isActive('italic'),
      isUnderline: ed.isActive('underline'),
      isStrike: ed.isActive('strike'),
      isCode: ed.isActive('code'),
      isLink: ed.isActive('link'),
      isBulletList: ed.isActive('bulletList'),
      isOrderedList: ed.isActive('orderedList'),
      isTaskList: ed.isActive('taskList'),
      isBlockquote: ed.isActive('blockquote'),
      blockType: (ed.isActive('heading', { level: 1 })
        ? 1
        : ed.isActive('heading', { level: 2 })
          ? 2
          : ed.isActive('heading', { level: 3 })
            ? 3
            : 'paragraph') as BlockType,
      // Alignment reflected by the selection; no explicit alignment reads as left.
      align: (ed.isActive({ textAlign: 'center' })
        ? 'center'
        : ed.isActive({ textAlign: 'right' })
          ? 'right'
          : ed.isActive({ textAlign: 'justify' })
            ? 'justify'
            : 'left') as TextAlignment,
    }),
  });

  const disabled = !state.editable;

  return (
    <div className="sticky top-4 z-30 mb-6 flex justify-center">
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="surface-frost flex items-center gap-0.5 rounded-md border border-input-border px-2 py-1 shadow-overlay"
      >
        {/* History */}
        <ToolbarButton
          icon="undo"
          label="Undo (⌘Z)"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !state.canUndo}
        />
        <ToolbarButton
          icon="redo"
          label="Redo (⌘⇧Z)"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !state.canRedo}
        />

        <Divider />

        {/* Block style */}
        <HeadingSelect editor={editor} current={state.blockType} disabled={disabled} />

        <Divider />

        {/* Inline emphasis */}
        <ToolbarButton
          icon="format_bold"
          label="Bold (⌘B)"
          active={state.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={disabled}
        />
        <ToolbarButton
          icon="format_italic"
          label="Italic (⌘I)"
          active={state.isItalic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={disabled}
        />
        <ToolbarButton
          icon="format_underlined"
          label="Underline (⌘U)"
          active={state.isUnderline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          disabled={disabled}
        />
        <ToolbarButton
          icon="format_strikethrough"
          label="Strikethrough (⌘⇧S)"
          active={state.isStrike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={disabled}
        />
        <ToolbarButton
          icon="code"
          label="Inline code (⌘E)"
          active={state.isCode}
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={disabled}
        />

        <Divider />

        {/* Lists */}
        <ToolbarButton
          icon="format_list_bulleted"
          label="Bullet list"
          active={state.isBulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={disabled}
        />
        <ToolbarButton
          icon="format_list_numbered"
          label="Numbered list"
          active={state.isOrderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={disabled}
        />
        <ToolbarButton
          icon="check_box"
          label="Task checklist"
          active={state.isTaskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          disabled={disabled}
        />

        <Divider />

        {/* Manual page break (Ctrl/⌘+Enter) — inserts a real block-level break node. */}
        <ToolbarButton
          icon="insert_page_break"
          label="Page break (⌘/Ctrl+Enter)"
          onClick={() => editor.chain().focus().setPageBreak().run()}
          disabled={disabled}
        />

        <Divider />

        {/* Text alignment — compact dropdown (left / center / right / justify). */}
        <AlignSelect editor={editor} current={state.align} disabled={disabled} />

        <Divider />

        {/* Blockquote — a real ProseMirror block node (StarterKit). */}
        <ToolbarButton
          icon="format_quote"
          label="Blockquote"
          active={state.isBlockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          disabled={disabled}
        />
        {/* Insert/edit link — opens a small popover (never a native prompt). */}
        <LinkPopover editor={editor} active={state.isLink} disabled={disabled} />

        {/* Insert image — real upload to authenticated object storage (ADR 0012). */}
        <MediaButton editor={editor} documentId={documentId} disabled={disabled} />

        <Divider />

        {/* Inline comment — anchors a comment mark + Yjs thread on the selection. */}
        <CommentButton
          editor={editor}
          ydoc={ydoc}
          user={user}
          active={state.isComment}
          hasRange={state.hasRange}
          disabled={disabled}
          onCreated={() => {
            if (!commentsOpen) onToggleComments?.();
          }}
        />
        {/* Toggle the comments side panel (viewers may read comments too). */}
        <ToolbarButton
          icon="forum"
          label={commentsOpen ? 'Hide comments' : 'Show comments'}
          active={commentsOpen}
          onClick={() => onToggleComments?.()}
        />
      </div>
    </div>
  );
}
