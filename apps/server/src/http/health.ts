import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../db/pool.js';

/**
 * Liveness vs. readiness are kept distinct (see docs/architecture/connection-states.md
 * spirit): `/health` says the process is up; `/ready` says dependencies are reachable.
 * Docker healthchecks target `/ready` so a container is only "healthy" once it can
 * serve real traffic.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  // Health/readiness are infrastructure probes (Docker healthcheck, load balancers)
  // and must NOT be rate-limited — otherwise frequent probing could trip the global
  // limiter and flap the container's health. Exempt them explicitly.
  const noRateLimit = { config: { rateLimit: false } };

  app.get('/health', noRateLimit, async () => ({ status: 'ok' }));

  app.get('/ready', noRateLimit, async (_req, reply) => {
    const dbOk = await pingDatabase();
    if (!dbOk) {
      return reply.code(503).send({ status: 'unavailable', checks: { database: 'down' } });
    }
    return reply.send({ status: 'ready', checks: { database: 'up' } });
  });
}
