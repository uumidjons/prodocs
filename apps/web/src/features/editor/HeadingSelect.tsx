import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';
import { HEADING_LEVELS, type HeadingLevel } from './extensions.js';

/** The current block type, as reflected by the editor selection. */
export type BlockType = 'paragraph' | HeadingLevel;

const OPTION_LABELS: Record<string, string> = {
  paragraph: 'Paragraph',
  1: 'Heading 1',
  2: 'Heading 2',
  3: 'Heading 3',
};

interface HeadingSelectProps {
  editor: Editor;
  current: BlockType;
  disabled?: boolean;
}

/**
 * Block-style selector for the format ribbon. Reflects the current block type at
 * the cursor and applies a real editor command on selection. Keyboard-accessible
 * menu (Escape / outside-click to close).
 */
export function HeadingSelect({ editor, current, disabled = false }: HeadingSelectProps) {
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

  function apply(type: BlockType) {
    if (type === 'paragraph') {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().setHeading({ level: type }).run();
    }
    setOpen(false);
  }

  const currentLabel = OPTION_LABELS[String(current)];
  const options: BlockType[] = ['paragraph', ...HEADING_LEVELS];

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Text style: ${currentLabel}`}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-body-sm font-medium text-ink',
          'transition-colors hover:bg-subtle focus:outline-none focus-visible:shadow-focus-ring',
          'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-60',
        )}
      >
        <span className="min-w-[68px] text-left">{currentLabel}</span>
        <Icon name="expand_more" size={16} className="text-ink-3" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-10 z-40 w-44 rounded-md border border-input-border bg-sheet p-1 shadow-overlay"
        >
          {options.map((type) => {
            const selected = type === current;
            return (
              <button
                key={String(type)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => apply(type)}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors',
                  selected ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-subtle',
                )}
              >
                <span
                  className={cn(
                    type === 'paragraph'
                      ? 'font-sans text-body-default'
                      : 'font-display text-headline-sm',
                  )}
                >
                  {OPTION_LABELS[String(type)]}
                </span>
                {selected && <Icon name="check" size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
