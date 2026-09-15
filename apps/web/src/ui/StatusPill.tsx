import { cn } from './cn.js';

/**
 * The sync state machine from docs/architecture/connection-states.md. Phase 0
 * has no real-time sync, so the shell drives this with a placeholder value; the
 * component is built to render the full set of states for later phases.
 */
export type SyncStatus = 'connecting' | 'syncing' | 'synced' | 'offline' | 'reconnecting' | 'error';

const MAP: Record<SyncStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: 'Connecting…', dot: 'bg-ink-3', text: 'text-ink-2' },
  syncing: { label: 'Syncing…', dot: 'bg-primary', text: 'text-ink-2' },
  synced: { label: 'Synced to cloud', dot: 'bg-success', text: 'text-ink-2' },
  offline: { label: 'Offline — saved locally', dot: 'bg-presence-3', text: 'text-ink-2' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-presence-3', text: 'text-ink-2' },
  error: { label: 'Sync error', dot: 'bg-error', text: 'text-error' },
};

export function StatusPill({ status }: { status: SyncStatus }) {
  const s = MAP[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full bg-subtle px-3 h-8 text-body-sm font-medium',
        s.text,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}
