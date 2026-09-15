import { cn } from './cn.js';

interface AvatarProps {
  name: string;
  color: string;
  size?: number;
  /** Renders a thin ring — used for presence stacks. */
  ring?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Circular identity avatar. Background is the user's presence color (UI/DESIGN.md). */
export function Avatar({ name, color, size = 28, ring = false }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-sans font-semibold text-white select-none',
        ring && 'ring-2 ring-white',
      )}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.4 }}
      title={name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}
