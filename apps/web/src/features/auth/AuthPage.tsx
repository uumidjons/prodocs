import { type FormEvent, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import { useAuthStore } from '../../stores/authStore.js';

type Mode = 'login' | 'register';

/** Combined sign-in / sign-up screen styled to the Scribe design system. */
export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    clearError();
    try {
      if (mode === 'login') await login({ email, password });
      else await register({ email, password, displayName });
    } catch {
      // Error surfaced via the store.
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-input-border bg-sheet px-3 py-2.5 text-body-default ' +
    'text-ink placeholder:text-ink-3 focus:border-primary focus:shadow-focus-ring focus:outline-none';

  return (
    <div className="flex min-h-full items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
            <Icon name="edit_note" size={22} filled />
          </span>
          <span className="font-display text-2xl text-ink">Scribe</span>
        </div>

        <div className="rounded-lg border border-border bg-sheet p-6 shadow-card">
          <h1 className="mb-1 font-display text-headline-md text-ink">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mb-6 text-body-default text-ink-2">
            {mode === 'login'
              ? 'Sign in to your workspace.'
              : 'Start writing and collaborating in Scribe.'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-label-md font-semibold text-ink-2">Display name</span>
                <input
                  className={inputClass}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Maya Lin"
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-label-md font-semibold text-ink-2">Email</span>
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-label-md font-semibold text-ink-2">Password</span>
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                required
              />
            </label>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-body-sm text-error">
                <Icon name="error" size={16} />
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="mt-1 w-full">
              {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-body-default text-ink-2">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="font-semibold text-primary hover:underline"
            onClick={() => {
              clearError();
              setMode(mode === 'login' ? 'register' : 'login');
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
