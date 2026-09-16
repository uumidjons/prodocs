import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon.js';
import { Spinner } from '../../ui/Spinner.js';

interface CollectionPageProps {
  title: string;
  subtitle?: string;
  /** Optional header-right control (e.g. a "New Document" button). */
  action?: ReactNode;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  /** True when the request finished and returned zero documents. */
  empty: boolean;
  emptyIcon?: string;
  emptyTitle: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  children?: ReactNode;
}

/**
 * Shared scaffold for every sidebar section page (task §9): a consistent header and
 * explicit loading / error / empty / populated states in the Scribe visual language.
 * Sections never render blank while loading, and empty states carry a useful message
 * (and, where relevant, a call to action) rather than a bare gap.
 */
export function CollectionPage({
  title,
  subtitle,
  action,
  loading,
  error,
  onRetry,
  empty,
  emptyIcon = 'draft',
  emptyTitle,
  emptyHint,
  emptyAction,
  children,
}: CollectionPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-margin py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-headline-lg text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-body-default text-ink-2">{subtitle}</p>}
        </div>
        {action}
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <Spinner size={28} />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-between rounded-md bg-error-bg px-4 py-3 text-body-default text-error">
          <span className="flex items-center gap-2">
            <Icon name="error" size={18} /> {error}
          </span>
          {onRetry && (
            <button className="font-semibold underline" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      {!loading && !error && empty && (
        <div className="rounded-lg border border-dashed border-border bg-sheet px-6 py-16 text-center">
          <Icon name={emptyIcon} size={40} className="text-ink-3" />
          <h2 className="mt-3 font-display text-headline-sm text-ink">{emptyTitle}</h2>
          {emptyHint && <p className="mt-1 text-body-default text-ink-2">{emptyHint}</p>}
          {emptyAction && <div className="mt-4 flex justify-center">{emptyAction}</div>}
        </div>
      )}

      {!loading && !error && !empty && children}
    </div>
  );
}
