/**
 * Tailwind theme = the Scribe design system (UI/DESIGN.md, "Editorial Precision").
 * Components reference these tokens (bg-surface, text-ink, font-display, …) rather
 * than ad-hoc hex/px values, which is what keeps the UI systematic. This is
 * deliberately NOT the default Tailwind theme.
 *
 * Colors are expressed as `rgb(var(--color-*) / <alpha-value>)` so the SAME tokens
 * drive both light and dark themes: the RGB channels live in CSS variables defined
 * in index.css (:root = light, :root[data-theme="dark"] = dark), toggled at runtime
 * by the theme store (task §6). Alpha utilities (e.g. bg-primary/20) still work.
 */
/** A token backed by a CSS variable holding space-separated RGB channels. */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface architecture
        surface: v('--color-surface'), // workspace background
        sheet: v('--color-sheet'), // elevated chrome surface / document page
        subtle: v('--color-subtle'), // inactive containers, code fences
        border: v('--color-border'), // structural micro-borders
        'input-border': v('--color-input-border'),

        // Accent / identity
        primary: {
          DEFAULT: v('--color-primary'),
          hover: v('--color-primary-hover'),
          active: v('--color-primary-active'),
          soft: v('--color-primary-soft'), // toggled/active icon background
        },

        // Typography ink
        ink: {
          DEFAULT: v('--color-ink'), // text primary
          2: v('--color-ink-2'), // secondary
          3: v('--color-ink-3'), // muted
        },

        // Collaborative presence (jewel tones — identical in both themes)
        presence: {
          1: '#10B981',
          2: '#F43F5E',
          3: '#F59E0B',
          4: '#8B5CF6',
        },

        // Status
        error: { DEFAULT: v('--color-error'), bg: v('--color-error-bg') },
        success: '#10B981',
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['48px', { lineHeight: '56px', letterSpacing: '-0.02em' }],
        'headline-lg': ['36px', { lineHeight: '44px', letterSpacing: '-0.015em' }],
        'headline-md': ['26px', { lineHeight: '34px', letterSpacing: '-0.01em' }],
        'headline-sm': ['18px', { lineHeight: '26px', letterSpacing: '-0.005em' }],
        'body-editorial': ['18px', { lineHeight: '30px' }],
        'body-default': ['15px', { lineHeight: '24px', letterSpacing: '-0.005em' }],
        'body-sm': ['13px', { lineHeight: '20px' }],
        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '0.01em' }],
        'label-sm': ['11px', { lineHeight: '14px', letterSpacing: '0.03em' }],
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
      },
      boxShadow: {
        // Elevation tiers from UI/DESIGN.md
        sheet: '0 1px 3px rgba(15,23,42,0.03), 0 12px 32px -4px rgba(15,23,42,0.04)',
        card: '0 2px 6px rgba(15,23,42,0.04), 0 8px 16px -2px rgba(15,23,42,0.03)',
        overlay: '0 4px 12px rgba(15,23,42,0.06), 0 20px 36px -6px rgba(15,23,42,0.08)',
        modal: '0 16px 48px -8px rgba(15,23,42,0.14)',
        'focus-ring': '0 0 0 3px rgba(59,73,223,0.12)',
      },
      spacing: {
        gutter: '1.5rem',
        margin: '2rem',
      },
      maxWidth: {
        sheet: '760px', // default reading width
        'sheet-wide': '980px',
      },
    },
  },
  plugins: [],
};
