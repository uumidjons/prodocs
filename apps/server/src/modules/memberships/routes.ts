import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addMemberSchema, updateMemberRoleSchema } from '@scribe/shared';
import { authenticate, requireUserId } from '../../http/authenticate.js';
import { parseBody } from '../../http/validation.js';
import * as memberships from './service.js';

const docParams = z.object({ id: z.string().uuid() });
const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/**
 * Sharing / membership API. All routes require authentication; every mutation is
 * authorized server-side in the service against the membership table (owner-only).
 * Document and target-user ids are validated as UUIDs, so a malformed id is a 400
 * (never a DB error) and a document id in the URL can only ever address the
 * caller's authorized document — there is no way to reach another document's
 * membership by editing the body (no document id is accepted in any body).
 */
export function registerMembershipRoutes(app: FastifyInstance): void {
  app.register(async (scoped) => {
    scoped.addHook('preHandler', authenticate);

    // List members — any member (owner/editor/viewer) may read this.
    scoped.get('/api/documents/:id/members', async (req) => {
      const { id } = parseBody(docParams, req.params);
      return memberships.list(requireUserId(req), id);
    });

    // Add a member — owner only.
    scoped.post('/api/documents/:id/members', async (req, reply) => {
      const { id } = parseBody(docParams, req.params);
      const { userId, role } = parseBody(addMemberSchema, req.body);
      const members = await memberships.add(requireUserId(req), id, userId, role);
      return reply.code(201).send(members);
    });

    // Change a member's role — owner only.
    scoped.patch('/api/documents/:id/members/:userId', async (req) => {
      const { id, userId } = parseBody(memberParams, req.params);
      const { role } = parseBody(updateMemberRoleSchema, req.body);
      return memberships.changeRole(requireUserId(req), id, userId, role);
    });

    // Remove a member — owner only.
    scoped.delete('/api/documents/:id/members/:userId', async (req) => {
      const { id, userId } = parseBody(memberParams, req.params);
      return memberships.remove(requireUserId(req), id, userId);
    });
  });
}
