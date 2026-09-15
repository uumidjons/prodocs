import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App.js';
import { removeLegacyDraftStorage } from './features/collaboration/legacyCleanup.js';
import './index.css';

// Purge the obsolete Phase 1 localStorage content bridge (now Yjs-owned).
removeLegacyDraftStorage();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
