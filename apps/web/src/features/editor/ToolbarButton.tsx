import type { ButtonHTMLAttributes } from 'react';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';

interface ToolbarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Material Symbols ligature name. */
  icon: string;
  /** Accessible name + tooltip (e.g. "Bold (⌘B)"). */
  label: string;
  /** Toggle state — drives the active styling and `aria-pressed`. */
  active?: boolean;
}

/**
 * A single 32×32 icon action button for the floating format ribbon
 * (UI/DESIGN.md → "Icon Action Buttons"). Active state uses the design-system
 * `primary-soft` fill with a `primary` icon tint; state is conveyed by both
 * color and `aria-pressed` (never color alone). Buttons whose feature is not in
 * Phase 1 pass `disabled` and read as unavailable rather than faking a result.
 */
export function ToolbarButton({
  icon,
  label,
  active = false,
  disabled = false,
  className,
  ...rest
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        'focus:outline-none focus-visible:shadow-focus-ring',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-ink-2 hover:bg-subtle hover:text-ink disabled:hover:bg-transparent',
        'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-60',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={20} filled={active} />
    </button>
  );
}
