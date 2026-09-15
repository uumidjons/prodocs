import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../ui/Icon.js';
import { cn } from '../ui/cn.js';
import { NewDocumentDialog } from '../features/documents/NewDocumentDialog.js';

interface NavItem {
  label: string;
  icon: string;
  to: string;
  /** Exact-match active state (only the Documents root needs it). */
  end?: boolean;
}

const NAV: NavItem[] = [
  { label: 'Documents', icon: 'description', to: '/', end: true },
  { label: 'Recent', icon: 'schedule', to: '/recent' },
  { label: 'Templates', icon: 'dashboard', to: '/templates' },
  { label: 'Shared with Me', icon: 'group', to: '/shared' },
  { label: 'Trash', icon: 'delete', to: '/trash' },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-body-default transition-colors',
    isActive ? 'bg-primary-soft font-semibold text-primary' : 'text-ink-2 hover:bg-subtle',
  );

export function Sidebar() {
  // "New Document" opens the creation dialog (Blank vs. from a template) rather
  // than immediately creating a document (task §4).
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface">
      {/* Workspace identity */}
      <div className="flex items-center gap-3 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white font-display text-lg">
          ES
        </span>
        <div className="min-w-0">
          <div className="truncate text-body-default font-semibold text-ink">Editorial Studio</div>
          <div className="truncate text-body-sm text-ink-3">Personal Cloud</div>
        </div>
      </div>

      {/* New document */}
      <div className="px-3">
        <button
          onClick={() => setDialogOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md border border-border bg-sheet',
            'px-3 py-2.5 text-body-default font-semibold text-ink shadow-sm transition-colors',
            'hover:bg-subtle',
          )}
        >
          <Icon name="add" size={18} />
          New Document
        </button>
      </div>

      {/* Primary navigation */}
      <nav className="mt-4 flex flex-col gap-0.5 px-3">
        {NAV.map((item) => (
          <NavLink key={item.label} to={item.to} end={item.end} className={navLinkClass}>
            <Icon name={item.icon} size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-border px-3 py-3">
        <NavLink to="/settings" className={navLinkClass}>
          <Icon name="settings" size={20} />
          Settings
        </NavLink>
      </div>

      {dialogOpen && <NewDocumentDialog onClose={() => setDialogOpen(false)} />}
    </aside>
  );
}
