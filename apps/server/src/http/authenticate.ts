import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { Errors } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by {@link authenticate}; present only on protected routes. */
    userId?: string;
  }
}

/**
 * preHandler guard: requires a valid `Authorization: Bearer <accessToken>`.
 * Access tokens travel in the header (not cookies), which also mitigates CSRF
 * for state-changing routes. Throws 401 on any failure.
 */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw Errors.unauthorized();
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const claims = verifyAccessToken(token);
    req.userId = claims.sub;
  } catch {
    throw Errors.unauthorized('Invalid or expired access token');
  }
}

/** Narrowing helper: returns the authenticated user id or throws 401. */
export function requireUserId(req: FastifyRequest): string {
  if (!req.userId) throw Errors.unauthorized();
  return req.userId;
}
