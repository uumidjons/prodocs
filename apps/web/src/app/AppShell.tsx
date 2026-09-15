import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useUiStore } from '../stores/uiStore.js';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

const APP_TITLE = 'Scribe';

/** Tripartite workspace: header on top, collapsible sidebar, routed main area. */
export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const activeDocument = useUiStore((s) => s.activeDocument);

  // Browser tab title (task §12): "<title> - Scribe" while a document is open,
  // otherwise just "Scribe". Follows the LIVE active-document title, so it updates
  // after a document loads, when its title is edited, and back to "Scribe" on exit.
  useEffect(() => {
    const title = activeDocument
      ? `${activeDocument.title.trim() || 'Untitled document'} - ${APP_TITLE}`
      : APP_TITLE;
    document.title = title;
    return () => {
      document.title = APP_TITLE;
    };
  }, [activeDocument]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <Header />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
