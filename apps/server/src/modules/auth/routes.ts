import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loginSchema, registerSchema } from '@scribe/shared';
import { config, rateLimitMax } from '../../config/index.js';
import { authenticate, requireUserId } from '../../http/authenticate.js';
import { Errors } from '../../http/errors.js';
import { parseBody } from '../../http/validation.js';
import { currentUser, login, logout, refresh, register } from './service.js';
import { verifyRefreshToken } from './tokens.js';

const REFRESH_COOKIE = 'scribe_refresh';

function refreshCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true, // not readable by JS — refresh token never reaches the frontend
    secure: config.cookie.secure, // true in production (HTTPS-only); see .env docs
    sameSite: 'lax', // blocks the cookie on cross-site POSTs → primary CSRF defense
    path: '/api/auth', // sent only to the auth endpoints, never to /api/documents
    domain: config.cookie.domain,
    // Roughly matches JWT_REFRESH_TTL default (30d) so the cookie and token expire together.
    maxAge: 60 * 60 * 24 * 30,
  };
}

/**
 * Defense-in-depth CSRF check for the cookie-authenticated refresh endpoint.
 * SameSite=Lax already blocks the refresh cookie on cross-site POSTs; this adds an
 * explicit Origin allow-list in production. Requests without an Origin header
 * (same-origin fetches, native clients, server-to-server) are allowed, and the
 * check is relaxed outside production so local tooling/tests are unaffected.
 */
function assertTrustedOrigin(req: FastifyRequest): void {
  if (!config.isProduction) return;
  const origin = req.headers.origin;
  if (origin && !config.corsOrigins.includes(origin)) {
    throw Errors.forbidden('Origin not allowed');
  }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // Tighter limit on credential endpoints to blunt brute force / stuffing
  // (relaxed under test so suites can register many users). Per-IP via the global
  // @fastify/rate-limit keyGenerator.
  const authLimit = {
    config: {
      rateLimit: {
        max: rateLimitMax(config.nodeEnv === 'test' ? 1_000_000 : 10),
        timeWindow: '1 minute',
      },
    },
  };
  // Refresh is called routinely (~every access-token lifetime) so its ceiling is
  // higher than login, but still bounded to blunt cookie-replay hammering.
  const refreshLimit = {
    config: {
      rateLimit: {
        max: rateLimitMax(config.nodeEnv === 'test' ? 1_000_000 : 60),
        timeWindow: '1 minute',
      },
    },
  };

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const input = parseBody(registerSchema, req.body);
    const { result, refreshToken } = await register(input);
    reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    return reply.code(201).send(result);
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const input = parseBody(loginSchema, req.body);
    const { result, refreshToken } = await login(input);
    reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    return reply.send(result);
  });

  app.post('/api/auth/refresh', refreshLimit, async (req, reply) => {
    assertTrustedOrigin(req);
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw Errors.unauthorized('No refresh token');

    let claims: { sub: string; jti: string };
    try {
      claims = verifyRefreshToken(token);
    } catch {
      reply.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw Errors.unauthorized('Invalid refresh token');
    }

    try {
      const { result, refreshToken } = await refresh(claims.jti, claims.sub);
      reply.setCookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
      return reply.send(result);
    } catch (err) {
      // Rotation rejected (unknown/expired/reused): drop the now-useless cookie.
      reply.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    // Revoke the server-side session (whole family) so the token is dead even if a
    // copy was captured — logout is not merely "forget the cookie".
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      try {
        await logout(verifyRefreshToken(token).jti);
      } catch {
        // Invalid/expired token — nothing to revoke; still clear the cookie below.
      }
    }
    reply.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (req) => {
    return currentUser(requireUserId(req));
  });
}
