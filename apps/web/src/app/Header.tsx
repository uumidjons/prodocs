import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../ui/Avatar.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { StatusPill } from '../ui/StatusPill.js';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { PresenceStack } from '../features/collaboration/PresenceStack.js';
import { ExportMenu } from '../features/export/index.js';
import { ShareDialog } from '../features/sharing/ShareDialog.js';
import { DocumentTitle } from './DocumentTitle.js';

/**
 * Top application header. The status pill shows the real collaborative sync state
 * (driven by the Hocuspocus provider) when a document is open, and the presence
 * stack shows live collaborators from Yjs awareness. Both are absent on the
 * document list, where there is no open document.
 */
export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const connectionStatus = useUiStore((s) => s.connectionStatus);
  const activeDocument = useUiStore((s) => s.activeDocument);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The button + popover share one wrapper so a click on either counts as "inside".
  const profileRef = useRef<HTMLDivElement>(null);

  // Accessible popover dismissal (task §7): close on an outside pointer press or
  // Escape. Listeners are attached ONLY while the menu is open and removed on close /
  // unmount, so nothing lingers. `pointerdown` covers mouse + touch + pen uniformly;
  // clicks inside the wrapper (including the toggle button) are ignored so the button
  // keeps its own toggle behavior instead of double-firing.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-sheet px-4">
      <button
        onClick={toggleSidebar}
        className="rounded-md p-1.5 text-ink-2 hover:bg-subtle"
        aria-label="Toggle sidebar"
      >
        <Icon name="menu" size={20} />
      </button>

      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 font-display text-xl text-ink"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white text-body-sm">
          <Icon name="edit_note" size={18} filled />
        </span>
        Scribe
      </button>

      {/* The open document's title lives in the header — its identity, not body
          content (task §1). Absent on the document list. */}
      {activeDocument && (
        <>
          <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
          {/* The title sizes to its content (see DocumentTitle) and is capped so it
              never grows into a giant flex element; `min-w-0` lets it truncate first
              on narrow widths. The `ml-auto` group below keeps the header actions
              pinned to the right regardless of the title's width. */}
          <div className="flex min-w-0 max-w-[42ch]">
            <DocumentTitle document={activeDocument} />
          </div>
          {/* The user's role on the open document (moved out of the canvas). */}
          <span className="hidden shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-label-sm font-semibold uppercase text-primary sm:inline-block">
            {activeDocument.role}
          </span>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {connectionStatus && <StatusPill status={connectionStatus} />}

        {/* Export is contextual to an open document and available to every role that
            can view it (owner/editor/viewer) — it is a read-only operation. */}
        {activeDocument && <ExportMenu />}

        {/* Share is contextual to an open document — hidden on the document list. */}
        {activeDocument && (
          <Button
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => setShareOpen(true)}
            aria-haspopup="dialog"
          >
            <Icon name="ios_share" size={18} />
            Share
          </Button>
        )}

        {/* OTHER collaborators (never the current user) live in the presence stack. */}
        <PresenceStack />

        {/* The CURRENT USER's own profile is persistent application chrome: it is always
            pinned to the top-right corner (document list AND inside any document, for
            owner/editor/viewer), kept visually distinct from the collaborator stack by a
            divider — never merged into it. */}
        {user && (
          <>
            <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full p-0.5 hover:bg-subtle focus:outline-none focus-visible:shadow-focus-ring"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Your account — ${user.displayName}`}
                data-testid="profile-button"
              >
                <Avatar name={user.displayName} color={user.color} size={30} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-10 w-56 rounded-md border border-border bg-sheet p-2 shadow-overlay"
                >
                  <div className="px-2 py-1.5">
                    <div className="truncate text-body-default font-semibold text-ink">
                      {user.displayName}
                    </div>
                    <div className="truncate text-body-sm text-ink-3">{user.email}</div>
                  </div>
                  <div className="my-1 h-px bg-border" />
                  <button
                    onClick={() => void logout()}
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-body-default text-ink-2 hover:bg-subtle"
                  >
                    <Icon name="logout" size={18} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {activeDocument && shareOpen && (
        <ShareDialog
          documentId={activeDocument.id}
          role={activeDocument.role}
          onClose={() => setShareOpen(false)}
        />
      )}
    </header>
  );
}
