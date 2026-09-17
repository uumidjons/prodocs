import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthResultDto, DocumentDto } from '@scribe/shared';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { pool } from '../../src/db/pool.js';

/**
 * Media upload/serve integration (ADR 0012). Exercises the SERVER-side security model
 * end to end against a real Postgres + the on-disk storage: authorization by role,
 * content-based MIME validation, size limits, safe storage keys, metadata persistence,
 * and document-scoped serving (a forged / cross-document media id must 404).
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
  console.warn('[integration] Postgres not reachable — skipping media tests.');
  await pool.end().catch(() => {});
}

/** A tiny but VALID PNG (signature + IHDR with dimensions). */
function pngBuffer(width = 2, height = 2): Buffer {
  const b = Buffer.alloc(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** Build a multipart/form-data body with one file field for app.inject. */
function multipart(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----scribeTestBoundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, fileBuffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

suite('Media upload & serving', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  const register = async (email: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123', displayName: 'User' },
    });
    return (res.json() as AuthResultDto).accessToken;
  };

  const createDoc = async (token: string): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    return (res.json() as DocumentDto).id;
  };

  const grant = async (docId: string, email: string, role: 'editor' | 'viewer') => {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      email,
    ]);
    await pool.query(
      `INSERT INTO memberships (document_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [docId, rows[0]!.id, role],
    );
  };

  const upload = (
    token: string | null,
    docId: string,
    buf: Buffer,
    filename = 'pic.png',
    contentType = 'image/png',
  ) => {
    const { payload, headers } = multipart(buf, filename, contentType);
    return app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/media`,
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload,
    });
  };

  it('lets an owner upload a PNG and returns media metadata', async () => {
    const token = await register('owner@example.com');
    const docId = await createDoc(token);
    const res = await upload(token, docId, pngBuffer(2, 2));
    expect(res.statusCode).toBe(201);
    const body = res.json() as { mediaId: string; mime: string; width: number; height: number };
    expect(body.mime).toBe('image/png');
    expect(body.width).toBe(2);
    expect(body.height).toBe(2);
    // Metadata row persisted, storage_key is a UUID (not the filename), doc-scoped.
    const { rows } = await pool.query(
      'SELECT storage_key, original_filename, mime_type FROM media WHERE id = $1',
      [body.mediaId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.storage_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]!.storage_key).not.toContain('pic.png');
    expect(rows[0]!.original_filename).toBe('pic.png');
  });

  it('ignores the client MIME and validates content (a text file claiming PNG is rejected)', async () => {
    const token = await register('owner@example.com');
    const docId = await createDoc(token);
    const res = await upload(token, docId, Buffer.from('not an image'), 'evil.png', 'image/png');
    expect(res.statusCode).toBe(415);
  });

  it('rejects an unsupported image type (GIF)', async () => {
    const token = await register('owner@example.com');
    const docId = await createDoc(token);
    const res = await upload(token, docId, Buffer.from('GIF89a123456'), 'x.gif', 'image/gif');
    expect(res.statusCode).toBe(415);
  });

  it('rejects an oversized file (413)', async () => {
    const token = await register('owner@example.com');
    const docId = await createDoc(token);
    const big = Buffer.concat([pngBuffer(), Buffer.alloc(300 * 1024, 1)]);
    const res = await upload(token, docId, big);
    expect(res.statusCode).toBe(413);
  });

  it('forbids a VIEWER from uploading (403)', async () => {
    const owner = await register('owner@example.com');
    const docId = await createDoc(owner);
    const viewerToken = await register('viewer@example.com');
    await grant(docId, 'viewer@example.com', 'viewer');
    const res = await upload(viewerToken, docId, pngBuffer());
    expect(res.statusCode).toBe(403);
  });

  it('lets an EDITOR upload (200/201)', async () => {
    const owner = await register('owner@example.com');
    const docId = await createDoc(owner);
    const editorToken = await register('editor@example.com');
    await grant(docId, 'editor@example.com', 'editor');
    const res = await upload(editorToken, docId, pngBuffer());
    expect(res.statusCode).toBe(201);
  });

  it('404s an upload from a NON-member (existence hidden)', async () => {
    const owner = await register('owner@example.com');
    const docId = await createDoc(owner);
    const strangerToken = await register('stranger@example.com');
    const res = await upload(strangerToken, docId, pngBuffer());
    expect(res.statusCode).toBe(404);
  });

  it('serves media to a member with the correct headers', async () => {
    const token = await register('owner@example.com');
    const docId = await createDoc(token);
    const { mediaId } = (await upload(token, docId, pngBuffer(4, 6)).then((r) => r.json())) as {
      mediaId: string;
    };
    const res = await app.inject({
      method: 'GET',
      url: `/api/documents/${docId}/media/${mediaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('404s serving to a NON-member (cannot fetch private media by guessing an id)', async () => {
    const owner = await register('owner@example.com');
    const docId = await createDoc(owner);
    const { mediaId } = (await upload(owner, docId, pngBuffer()).then((r) => r.json())) as {
      mediaId: string;
    };
    const strangerToken = await register('stranger@example.com');
    const res = await app.inject({
      method: 'GET',
      url: `/api/documents/${docId}/media/${mediaId}`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s a forged media id and a media id from ANOTHER document', async () => {
    const token = await register('owner@example.com');
    const docA = await createDoc(token);
    const docB = await createDoc(token);
    const { mediaId } = (await upload(token, docA, pngBuffer()).then((r) => r.json())) as {
      mediaId: string;
    };

    // Forged (well-formed but nonexistent) id → 404.
    const forged = await app.inject({
      method: 'GET',
      url: `/api/documents/${docA}/media/00000000-0000-4000-8000-000000000000`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(forged.statusCode).toBe(404);

    // Real media id but requested under the WRONG document → 404 (doc-scoped lookup).
    const crossDoc = await app.inject({
      method: 'GET',
      url: `/api/documents/${docB}/media/${mediaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(crossDoc.statusCode).toBe(404);
  });

  it('requires authentication to upload or serve', async () => {
    const token = await register('owner@example.com');
    const docId = await createDoc(token);
    const up = await upload(null, docId, pngBuffer());
    expect(up.statusCode).toBe(401);
    const get = await app.inject({
      method: 'GET',
      url: `/api/documents/${docId}/media/00000000-0000-4000-8000-000000000000`,
    });
    expect(get.statusCode).toBe(401);
  });
});
