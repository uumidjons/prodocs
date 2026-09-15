import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createDocumentSchema, updateDocumentSchema } from '@scribe/shared';
import { config, rateLimitMax } from '../../config/index.js';
import { authenticate, requireUserId } from '../../http/authenticate.js';
import { parseBody } from '../../http/validation.js';
import { verifyAccessToken } from '../auth/tokens.js';
import * as documents from './service.js';

const paramsSchema = z.object({ id: z.string().uuid() });

// Which sidebar section the document listing is scoped to (defaults to "mine").
const listQuerySchema = z.object({
  view: z.enum(['mine', 'recent', 'shared', 'trash']).default('mine'),
});

/**
 * Rate-limit key for per-user limits. The limiter runs at `onRequest`, before the
 * `authenticate` preHandler sets `req.userId`, so we derive the subject directly
 * from the Bearer token here (cheap JWT verify), falling back to IP for anonymous
 * requests. Keeps document-creation limits per-account, not per-IP.
 */
function userKey(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      return `user:${verifyAccessToken(header.slice('Bearer '.length).trim()).sub}`;
    } catch {
      // fall through to IP
    }
  }
  return `ip:${req.ip}`;
}

export function registerDocumentRoutes(app: FastifyInstance): void {
  // Every document route requires authentication.
  app.register(async (scoped) => {
    scoped.addHook('preHandler', authenticate);

    scoped.get('/api/documents', async (req) => {
      const { view } = parseBody(listQuerySchema, req.query);
      return documents.list(requireUserId(req), view);
    });

    // System templates for the "New document → From template" picker. Any
    // authenticated user may read the (public) template list; it never includes
    // user documents. Templates are copied server-side on create.
    scoped.get('/api/templates', async () => {
      return documents.listTemplates();
    });

    scoped.post(
      '/api/documents',
      {
        // Per-user creation cap so one account can't spam documents (each creates a
        // row + membership + seeded CRDT state). Generous for real use.
        config: {
          rateLimit: {
            max: rateLimitMax(config.nodeEnv === 'test' ? 1_000_000 : 30),
            timeWindow: '1 minute',
            keyGenerator: userKey,
          },
        },
      },
      async (req, reply) => {
        const input = parseBody(createDocumentSchema, req.body);
        const doc = await documents.create(requireUserId(req), input);
        return reply.code(201).send(doc);
      },
    );

    scoped.get('/api/documents/:id', async (req) => {
      const { id } = parseBody(paramsSchema, req.params);
      return documents.get(requireUserId(req), id);
    });

    scoped.patch('/api/documents/:id', async (req) => {
      const { id } = parseBody(paramsSchema, req.params);
      const { title } = parseBody(updateDocumentSchema, req.body);
      return documents.updateTitle(requireUserId(req), id, title);
    });

    // DELETE moves a document to Trash (soft delete). It is reversible via restore
    // and never hard-deletes on the normal "Delete" action (task §5).
    scoped.delete('/api/documents/:id', async (req, reply) => {
      const { id } = parseBody(paramsSchema, req.params);
      await documents.trash(requireUserId(req), id);
      return reply.code(204).send();
    });

    // Restore a document from Trash back to Documents (owner-only).
    scoped.post('/api/documents/:id/restore', async (req, reply) => {
      const { id } = parseBody(paramsSchema, req.params);
      await documents.restore(requireUserId(req), id);
      return reply.code(204).send();
    });

    // Permanently delete a document (owner-only, irreversible). Distinct from the
    // soft-delete DELETE so destructive removal is always an explicit, separate act.
    scoped.delete('/api/documents/:id/permanent', async (req, reply) => {
      const { id } = parseBody(paramsSchema, req.params);
      await documents.purge(requireUserId(req), id);
      return reply.code(204).send();
    });
  });
}
