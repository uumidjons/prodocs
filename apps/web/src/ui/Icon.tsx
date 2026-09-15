interface IconProps {
  /** Material Symbols Outlined ligature name, e.g. "description", "share". */
  name: string;
  /** Optical size in px (also used as font-size). Defaults to 20. */
  size?: number;
  className?: string;
  filled?: boolean;
}

/**
 * Single iconography primitive so every icon shares one family, weight, and
 * sizing (UI/DESIGN.md: consistent 1.5px-stroke vector set). All icons in the
 * app go through this — no ad-hoc SVGs.
 */
export function Icon({ name, size = 20, className, filled = false }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className ?? ''}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
      }}
    >
      {name}
    </span>
  );
}
