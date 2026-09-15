import type { FastifyInstance } from 'fastify';
import { userSearchQuerySchema } from '@scribe/shared';
import { authenticate, requireUserId } from '../../http/authenticate.js';
import { parseBody } from '../../http/validation.js';
import { searchUsers } from './repo.js';

/**
 * User directory search — the minimum needed by the sharing "add member" control.
 * Authenticated only, returns just public identity fields (id, email, displayName,
 * color) and never security fields. A minimum query length (shared schema) plus a
 * capped result set limit mass user enumeration.
 */
export function registerUserRoutes(app: FastifyInstance): void {
  app.register(async (scoped) => {
    scoped.addHook('preHandler', authenticate);

    scoped.get('/api/users/search', async (req) => {
      const { q } = parseBody(userSearchQuerySchema, req.query);
      return searchUsers(q, requireUserId(req));
    });
  });
}
