import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';

/** The alignments the MVP supports (paragraphs + headings). */
export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

const ALIGN_OPTIONS: { value: TextAlignment; icon: string; label: string }[] = [
  { value: 'left', icon: 'format_align_left', label: 'Align left' },
  { value: 'center', icon: 'format_align_center', label: 'Align center' },
  { value: 'right', icon: 'format_align_right', label: 'Align right' },
  { value: 'justify', icon: 'format_align_justify', label: 'Justify' },
];

const ICON_BY_ALIGN: Record<TextAlignment, string> = {
  left: 'format_align_left',
  center: 'format_align_center',
  right: 'format_align_right',
  justify: 'format_align_justify',
};

interface AlignSelectProps {
  editor: Editor;
  /** The alignment reflected by the current selection (defaults to 'left'). */
  current: TextAlignment;
  disabled?: boolean;
}

/**
 * Compact alignment control for the format ribbon. A single trigger showing the
 * current alignment opens a small popover of the four alignment options — chosen
 * over four permanently-visible buttons to keep the ribbon balanced (task §5/§15).
 * Each option runs a real `setTextAlign` command, so alignment lives in the
 * ProseMirror/Yjs document (persists, collaborates, undoes). Keyboard-accessible
 * (Escape / outside-click to close), matching HeadingSelect.
 */
export function AlignSelect({ editor, current, disabled = false }: AlignSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function apply(value: TextAlignment) {
    editor.chain().focus().setTextAlign(value).run();
    setOpen(false);
  }

  const currentLabel = ALIGN_OPTIONS.find((o) => o.value === current)?.label ?? 'Align left';

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Alignment: ${currentLabel}`}
        title={currentLabel}
        className={cn(
          'flex h-8 items-center gap-0.5 rounded-md px-1.5 transition-colors',
          'focus:outline-none focus-visible:shadow-focus-ring',
          'text-ink-2 hover:bg-subtle hover:text-ink',
          'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-60 disabled:hover:bg-transparent',
        )}
      >
        <Icon name={ICON_BY_ALIGN[current]} size={20} />
        <Icon name="expand_more" size={14} className="text-ink-3" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Text alignment"
          className="absolute left-0 top-10 z-40 flex gap-0.5 rounded-md border border-input-border bg-sheet p-1 shadow-overlay"
        >
          {ALIGN_OPTIONS.map((opt) => {
            const selected = opt.value === current;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={opt.label}
                title={opt.label}
                onClick={() => apply(opt.value)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                  'focus:outline-none focus-visible:shadow-focus-ring',
                  selected
                    ? 'bg-primary-soft text-primary'
                    : 'text-ink-2 hover:bg-subtle hover:text-ink',
                )}
              >
                <Icon name={opt.icon} size={20} filled={selected} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
