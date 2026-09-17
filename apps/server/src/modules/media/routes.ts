import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { config, rateLimitMax } from '../../config/index.js';
import { authenticate, requireUserId } from '../../http/authenticate.js';
import { Errors } from '../../http/errors.js';
import { parseBody } from '../../http/validation.js';
import { getMediaBytes, uploadMedia } from './service.js';

const uploadParams = z.object({ id: z.string().uuid() });
const serveParams = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() });

/**
 * Media HTTP routes (ADR 0012). Binaries travel ONLY over these authenticated
 * endpoints — never over the collaboration socket, never as public URLs.
 *
 *   POST /api/documents/:id/media            (multipart, editor/owner) → upload
 *   GET  /api/documents/:id/media/:mediaId   (member)                  → serve bytes
 */
export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // Register multipart with a hard size limit so oversized uploads are rejected at the
  // parser before the handler ever buffers them fully.
  await app.register(multipart, {
    limits: {
      fileSize: config.media.maxBytes,
      files: 1,
      // No non-file fields are expected; keep them tiny.
      fields: 4,
      fieldSize: 1024,
    },
  });

  app.register(async (scoped) => {
    scoped.addHook('preHandler', authenticate);

    scoped.post(
      '/api/documents/:id/media',
      {
        config: {
          // Bound upload frequency per account (each upload writes a file + a row).
          rateLimit: {
            max: rateLimitMax(config.nodeEnv === 'test' ? 1_000_000 : 60),
            timeWindow: '1 minute',
          },
        },
      },
      async (req, reply) => {
        const { id } = parseBody(uploadParams, req.params);

        const part = await req.file();
        if (!part) throw Errors.badRequest('No file provided');

        // Buffer the file (bounded by the multipart fileSize limit above).
        const bytes = await part.toBuffer();
        // @fastify/multipart flags a truncated file when it hit the size limit.
        if (part.file.truncated) {
          throw Errors.payloadTooLarge(`File exceeds the ${config.media.maxBytes}-byte limit`);
        }

        const result = await uploadMedia(requireUserId(req), id, {
          bytes,
          filename: part.filename ?? null,
          declaredMime: part.mimetype ?? null,
        });
        return reply.code(201).send(result);
      },
    );

    scoped.get('/api/documents/:id/media/:mediaId', async (req, reply) => {
      const { id, mediaId } = parseBody(serveParams, req.params);
      const media = await getMediaBytes(requireUserId(req), id, mediaId);

      return (
        reply
          .header('Content-Type', media.mime)
          // Force inline rendering with a fixed disposition — never a user-controlled
          // filename that could enable header/download tricks.
          .header('Content-Disposition', 'inline')
          // Defense in depth: never let a browser MIME-sniff the response into something
          // executable; the type is the server-sniffed image type only.
          .header('X-Content-Type-Options', 'nosniff')
          // Private per-document media must not be shared by intermediary caches.
          .header('Cache-Control', 'private, max-age=300')
          .send(media.bytes)
      );
    });
  });
}
