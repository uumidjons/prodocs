import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies /api to the backend so the browser talks same-origin
// (keeps cookies simple and avoids CORS in development). The backend host is
// configurable so this works both on the host machine and inside Docker.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // Required for the dev server to be reachable from outside the container and
    // for file watching to work reliably on bind-mounted volumes.
    watch: { usePolling: true },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      // WebSocket collaboration endpoint — same backend process as /api. `ws: true`
      // makes Vite forward the HTTP upgrade to the Hocuspocus server.
      '/collab': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
});
