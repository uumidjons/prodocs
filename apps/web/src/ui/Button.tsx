import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn.js';

type Variant = 'primary' | 'ghost' | 'secondary';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded font-sans font-semibold ' +
  'transition-colors focus:outline-none focus-visible:shadow-focus-ring disabled:opacity-50 ' +
  'disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover active:bg-primary-active',
  secondary: 'bg-subtle text-ink hover:bg-border',
  ghost: 'bg-transparent text-ink hover:bg-subtle',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-body-sm',
  md: 'h-10 px-4 text-body-default',
};

/** Primary/secondary/ghost button per UI/DESIGN.md button spec (8px radius, 36/40px). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...rest} />
  );
});
