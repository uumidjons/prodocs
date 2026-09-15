import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
import { config } from '../config/index.js';
import { logSecurityEvent } from '../observability/events.js';
import { registerCollabServer, unregisterCollabServer } from './controller.js';
import { createHocuspocus } from './server.js';

/** Path the browser's WebSocket connects to (proxied by Vite in dev). */
export const COLLAB_PATH = '/collab';

/**
 * Attaches the Hocuspocus WebSocket server to Fastify's existing HTTP server, so
 * HTTP and collaboration share ONE process and ONE port (modular monolith). We
 * intercept the raw `upgrade` event, route `/collab` upgrades into Hocuspocus,
 * and reject everything else.
 *
 * Origin is checked here (defense in depth for WS, which is not covered by the
 * HTTP CORS middleware): in production only configured origins may open a socket;
 * development allows any origin for convenience.
 */
export function attachCollaboration(app: FastifyInstance): void {
  const hocuspocus = createHocuspocus();
  // Expose the live server so REST membership changes can re-authorize open sockets
  // (see controller.ts). Same process — no separate service or message bus.
  registerCollabServer(hocuspocus);
  // Cap the size of a single WebSocket frame (Phase 4). `ws` defaults to 100 MiB;
  // a legitimate Yjs update — even an initial full-document sync — is far smaller,
  // so this bounds memory per message and rejects abusive frames. On exceed, `ws`
  // closes the connection with code 1009 (message too big) WITHOUT delivering the
  // frame, so persistence is never touched by an oversized payload.
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.limits.maxWsMessageBytes });

  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!config.isProduction) return true; // dev convenience
    if (!origin) return false;
    return config.corsOrigins.includes(origin);
  };

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const { url } = request;
    if (!url || !url.startsWith(COLLAB_PATH)) {
      // Not ours — don't leave the socket hanging.
      socket.destroy();
      return;
    }
    if (!isAllowedOrigin(request.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Observe oversized-frame disconnects (ws close code 1009). This listener is
      // additive to Hocuspocus's own handlers and never interferes with them.
      ws.on('close', (code) => {
        if (code === 1009) logSecurityEvent('ws.payload.too_large', {});
      });
      // An oversized/garbled frame makes ws emit 'error' on the socket. Handle it so
      // it never becomes an unhandled exception; ws still closes the connection
      // (1009 above). Without a listener, EventEmitter would throw on 'error'.
      ws.on('error', () => {
        /* connection-level error; the socket is being torn down — nothing to do */
      });
      // Actual auth/authorization happens in Hocuspocus onAuthenticate before any
      // document is loaded or update accepted.
      hocuspocus.handleConnection(ws, request);
    });
  };

  app.server.on('upgrade', onUpgrade);

  // Tie the collaboration server's lifecycle to the Fastify app. Hard-terminate
  // live WebSocket clients first, then let their close events unload the in-memory
  // documents before destroying Hocuspocus. Without this, both graceful shutdown
  // (SIGTERM in prod) and app.close() between tests would block on Hocuspocus's
  // ~30s per-connection ping timeout while it waits for a clean disconnect.
  app.addHook('onClose', async () => {
    app.server.off('upgrade', onUpgrade);
    unregisterCollabServer();
    for (const client of wss.clients) client.terminate();
    // Yield so the terminated sockets' 'close' handlers run and unload documents.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await hocuspocus.destroy();
    wss.close();
  });
}
