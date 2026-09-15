import type { ReactNode } from 'react';
import type { DocumentDto } from '@scribe/shared';
import { Icon } from '../../ui/Icon.js';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface DocumentCardProps {
  doc: DocumentDto;
  /** Opens the document. When omitted the card is non-interactive (e.g. Trash). */
  onOpen?: () => void;
  /** Show the owner's name (used by "Shared with me"). */
  showOwner?: boolean;
  /** Which timestamp to surface in the footer. */
  timestamp?: 'updated' | 'opened' | 'deleted';
  /** Optional action row rendered at the bottom of the card (e.g. Restore/Delete). */
  actions?: ReactNode;
}

/**
 * One document tile, shared by every sidebar section (Documents, Recent, Shared,
 * Trash) so they read as one system. The card is a button when `onOpen` is given;
 * Trash cards omit it (a trashed document cannot be opened) and instead render
 * restore/delete actions.
 */
export function DocumentCard({
  doc,
  onOpen,
  showOwner,
  timestamp = 'updated',
  actions,
}: DocumentCardProps) {
  const footer =
    timestamp === 'opened' && doc.lastOpenedAt
      ? `Opened ${formatDate(doc.lastOpenedAt)}`
      : timestamp === 'deleted' && doc.deletedAt
        ? `Deleted ${formatDate(doc.deletedAt)}`
        : `Edited ${formatDate(doc.updatedAt)}`;

  const body = (
    <>
      <span className="flex items-center gap-2 text-primary">
        <Icon name="description" size={20} />
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-label-sm font-semibold uppercase text-primary">
          {doc.role}
        </span>
      </span>
      <span className="mt-3 line-clamp-2 font-display text-headline-sm text-ink">{doc.title}</span>
      {showOwner && (
        <span className="mt-1 flex items-center gap-1 text-body-sm text-ink-2">
          <Icon name="person" size={14} /> {doc.ownerName}
        </span>
      )}
      <span className="mt-auto pt-4 text-body-sm text-ink-3">{footer}</span>
    </>
  );

  return (
    <li>
      <div className="flex h-full flex-col rounded-lg border border-border bg-sheet shadow-sm">
        {onOpen ? (
          <button
            onClick={onOpen}
            className="group flex flex-1 flex-col rounded-t-lg p-5 text-left transition-shadow hover:shadow-card focus:outline-none focus-visible:shadow-focus-ring"
          >
            {body}
          </button>
        ) : (
          <div className="flex flex-1 flex-col p-5 text-left">{body}</div>
        )}
        {actions && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            {actions}
          </div>
        )}
      </div>
    </li>
  );
}

/** A responsive grid wrapper matching the Documents layout. */
export function DocumentGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}
