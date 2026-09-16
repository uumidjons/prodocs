import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { pool } from '../../src/db/pool.js';

/**
 * Phase 4 — WebSocket abuse resistance. An oversized frame must be rejected at the
 * transport layer (ws `maxPayload`) WITHOUT crashing the server or touching
 * persistence. Authentication/authorization on the collaboration channel (invalid
 * token, non-member, viewer read-only) is covered by collab.test.ts.
 */

async function dbReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const available = await dbReachable();
const suite = available ? describe : describe.skip;
if (!available) {
  console.warn('[integration] Postgres not reachable — skipping ws-security tests.');
  await pool.end().catch(() => {});
}

suite('WebSocket security: payload bounds', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('closes the socket with 1009 when a frame exceeds the max payload (no crash)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`);
    const closeCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no close within timeout')), 8000);
      ws.on('open', () => {
        // One frame larger than the configured cap. ws rejects it at the frame layer
        // (before Hocuspocus ever sees it) and closes with 1009 "message too big".
        ws.send(Buffer.alloc(config.limits.maxWsMessageBytes + 1024));
      });
      ws.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      ws.on('error', () => {
        /* a transport error may accompany the oversized-frame close; ignore */
      });
    });

    expect(closeCode).toBe(1009);

    // The server survived the abusive frame and still serves requests.
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
