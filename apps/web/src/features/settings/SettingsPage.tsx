import type { ThemePreference } from '../../stores/themeStore.js';
import { useThemeStore } from '../../stores/themeStore.js';
import { Icon } from '../../ui/Icon.js';
import { cn } from '../../ui/cn.js';

/**
 * Settings (task §6). A deliberately small settings surface: the theme preference
 * (Light / Dark / System). The choice is a per-browser UI preference persisted in
 * localStorage (not document content) and applied through the design system's CSS
 * variables, so it survives reload and affects the application chrome while leaving
 * the A4 document sheet a readable light surface.
 */
const OPTIONS: { value: ThemePreference; label: string; icon: string; hint: string }[] = [
  { value: 'light', label: 'Light', icon: 'light_mode', hint: 'Bright workspace chrome.' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode', hint: 'Dim workspace chrome.' },
  {
    value: 'system',
    label: 'System',
    icon: 'contrast',
    hint: 'Match your operating system setting.',
  },
];

export function SettingsPage() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <div className="mx-auto max-w-3xl px-margin py-10">
      <h1 className="font-display text-headline-lg text-ink">Settings</h1>
      <p className="mt-1 text-body-default text-ink-2">Personalize your ProDocs workspace.</p>

      <section className="mt-8 rounded-lg border border-border bg-sheet p-6 shadow-sm">
        <h2 className="font-display text-headline-sm text-ink">Appearance</h2>
        <p className="mt-1 text-body-sm text-ink-2">
          Choose how ProDocs looks. This preference is saved on this browser.
        </p>

        <div
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Theme"
        >
          {OPTIONS.map((opt) => {
            const active = preference === opt.value;
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                onClick={() => setPreference(opt.value)}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-md border px-4 py-3 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary-soft'
                    : 'border-border bg-sheet hover:bg-subtle',
                )}
              >
                <span
                  className={cn(
                    'flex items-center gap-2 font-semibold',
                    active ? 'text-primary' : 'text-ink',
                  )}
                >
                  <Icon name={opt.icon} size={18} />
                  {opt.label}
                  {active && <Icon name="check_circle" size={16} filled />}
                </span>
                <span className="text-body-sm text-ink-2">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
