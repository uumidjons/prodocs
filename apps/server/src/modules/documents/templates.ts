import { getSchema } from '@tiptap/core';
import {
  COLLAB_FIELD,
  SYSTEM_TEMPLATES,
  type TemplateDto,
  buildBaseExtensions,
} from '@scribe/shared';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { pool } from '../../db/pool.js';
import { hashPassword } from '../auth/password.js';
import { hasPersistedState, saveSnapshot } from '../persistence/repo.js';

/**
 * System templates: their owning system user, idempotent seeding, and read access
 * (task §1/§2). Templates are ordinary rows in `documents` with `is_template = true`,
 * owned by a dedicated system user and carrying NO user memberships — so the normal
 * membership-based access rules already keep them out of every user's Documents list
 * and sharing UI. Their content lives in the SAME persistence tables as any document
 * (doc_snapshot), so "create from template" reuses the existing content-copy path.
 */

/** Fixed id + email for the templates-owning system account (never a login target). */
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEM_USER_EMAIL = 'system+templates@scribe.local';
export { SYSTEM_USER_EMAIL };

// The exact schema the browser editor uses — so seeded template Y state maps 1:1.
const schema = getSchema(buildBaseExtensions());

/**
 * Ensure the system user + every system template document exist and have their
 * content persisted. Idempotent: fixed ids + ON CONFLICT DO NOTHING mean re-running
 * (startup, or a test re-seeding after truncation) never duplicates. Safe to call
 * whenever the schema is migrated.
 */
export async function seedSystemTemplates(): Promise<void> {
  await ensureSystemUser();

  for (const tpl of SYSTEM_TEMPLATES) {
    // Create the template document row (owned by the system user, flagged template).
    await pool.query(
      `INSERT INTO documents (id, title, owner_id, is_template)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (id) DO NOTHING`,
      [tpl.id, tpl.title, SYSTEM_USER_ID],
    );

    // Persist its content as the initial snapshot if it isn't there yet. This is the
    // durable Yjs state that "create from template" copies from.
    if (!(await hasPersistedState(tpl.id))) {
      const ydoc = prosemirrorJSONToYDoc(schema, tpl.content, COLLAB_FIELD);
      try {
        await saveSnapshot(tpl.id, Y.encodeStateAsUpdate(ydoc), 0);
      } finally {
        ydoc.destroy();
      }
    }
  }
}

async function ensureSystemUser(): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1', [SYSTEM_USER_ID]);
  if (rowCount) return;
  // A real Argon2 hash of a random secret: login verification works (and always
  // fails) rather than throwing, and no one knows the secret. The account is also
  // excluded from user search (see users/repo.ts).
  const passwordHash = await hashPassword(`system-${crypto.randomUUID()}-${crypto.randomUUID()}`);
  await pool.query(
    `INSERT INTO users (id, email, display_name, color, password_hash)
     VALUES ($1, $2, 'ProDocs Templates', '#3B49DF', $3)
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_USER_ID, SYSTEM_USER_EMAIL, passwordHash],
  );
}

/** Descriptions come from the shared template definitions (not stored per-row). */
const TEMPLATE_DESCRIPTIONS = new Map(SYSTEM_TEMPLATES.map((t) => [t.id, t.description]));

/** The list of system templates for the "From template" picker + Templates page. */
export async function listTemplates(): Promise<TemplateDto[]> {
  const { rows } = await pool.query<{ id: string; title: string }>(
    `SELECT id, title FROM documents WHERE is_template = true ORDER BY title ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: TEMPLATE_DESCRIPTIONS.get(r.id),
  }));
}

/** A single template by id, or null if the id is not a system template. */
export async function getTemplateById(id: string): Promise<TemplateDto | null> {
  const { rows } = await pool.query<{ id: string; title: string }>(
    `SELECT id, title FROM documents WHERE id = $1 AND is_template = true`,
    [id],
  );
  const row = rows[0];
  return row ? { id: row.id, title: row.title } : null;
}
