import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { attachCollaboration } from './collab/attach.js';
import { config, rateLimitMax } from './config/index.js';
import { logSecurityEvent } from './observability/events.js';
import { AppError, Errors, toErrorDto } from './http/errors.js';
import { registerHealthRoutes } from './http/health.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerDocumentRoutes } from './modules/documents/routes.js';
import { registerMediaRoutes } from './modules/media/routes.js';
import { registerMembershipRoutes } from './modules/memberships/routes.js';
import { registerUserRoutes } from './modules/users/routes.js';

/**
 * Builds a fully-configured Fastify instance without starting to listen. Kept
 * separate from `index.ts` so tests can build an app against a test database and
 * use `app.inject()` without opening a socket.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Cap request bodies globally (Phase 4). Our largest legitimate body is a short
    // JSON object, so this rejects oversized-body floods long before they reach a
    // handler. Document CONTENT never travels over HTTP (it is Yjs over WebSocket).
    bodyLimit: config.limits.maxHttpBodyBytes,
    // Structured logging via Fastify's built-in pino. Pretty output in dev only.
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
      // Never log credentials or tokens.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
    },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    // Effectively disabled under test so suites can drive many requests; real
    // limits apply in dev/production. In-memory store (single-instance MVP — no
    // Redis; documented in security.md). Per-route overrides tighten sensitive
    // endpoints; per-user document creation uses a userId keyGenerator below.
    max: rateLimitMax(config.nodeEnv === 'test' ? 1_000_000 : 300),
    timeWindow: '1 minute',
    onExceeding: (req) => {
      logSecurityEvent('ratelimit.exceeded', { ip: req.ip, method: req.method, url: req.url });
    },
  });

  // Consistent error envelope; internal details are never leaked on 5xx.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(toErrorDto(err));
    }
    // Fastify's own validation / 429 rate-limit errors carry a statusCode/code.
    const e = err as { statusCode?: number; code?: string; message?: string };
    const statusCode = typeof e.statusCode === 'number' ? e.statusCode : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply
        .code(statusCode)
        .send(
          toErrorDto(
            new AppError(statusCode, e.code ?? 'request_error', e.message ?? 'Request error'),
          ),
        );
    }
    req.log.error(err);
    return reply
      .code(500)
      .send(toErrorDto(new AppError(500, 'internal_error', 'Internal server error')));
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send(toErrorDto(Errors.notFound('Route not found')));
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerDocumentRoutes(app);
  // Media upload/serve (multipart). Registered before the collab attach; adds no
  // document-content path — binaries live in object storage, referenced by media id.
  await registerMediaRoutes(app);
  registerMembershipRoutes(app);
  registerUserRoutes(app);

  // Real-time collaboration (WebSocket) shares this HTTP server / process.
  attachCollaboration(app);

  return app;
}
