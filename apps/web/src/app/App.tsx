import { type ReactNode, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '../ui/Spinner.js';
import { useAuthStore } from '../stores/authStore.js';
import { AuthPage } from '../features/auth/AuthPage.js';
import { AppShell } from './AppShell.js';
import { DocumentsHome } from '../features/documents/DocumentsHome.js';
import { RecentPage } from '../features/documents/RecentPage.js';
import { SharedPage } from '../features/documents/SharedPage.js';
import { TrashPage } from '../features/documents/TrashPage.js';
import { DocumentView } from '../features/documents/DocumentView.js';
import { TemplatesPage } from '../features/templates/TemplatesPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { useThemeStore } from '../stores/themeStore.js';

/** Full-screen loader shown while we attempt to restore the session. */
function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-surface">
      <Spinner size={28} />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') return <BootScreen />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  // Instantiate the theme store at startup so the saved preference is applied and the
  // "system" media listener is registered app-wide (not only when Settings is open).
  useThemeStore((s) => s.preference);

  // Attempt to restore a session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <AuthPage />}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DocumentsHome />} />
        <Route path="recent" element={<RecentPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="shared" element={<SharedPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="d/:id" element={<DocumentView />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
