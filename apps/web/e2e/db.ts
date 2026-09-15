import pg from 'pg';

/**
 * Direct Postgres access for E2E SEEDING ONLY.
 *
 * The app has no sharing UI yet (the header "Share" button is a placeholder), so to
 * put two DISTINCT users on the SAME document we grant the membership row directly —
 * the same approach the server integration suite uses. This touches only the
 * authorization table (`memberships`); it never writes document CONTENT, which stays
 * exclusively in the Yjs CRDT. It is a test fixture, not a product code path.
 *
 * DATABASE_URL defaults to the host-side port from docker-compose (5433).
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://scribe:scribe_dev_password@localhost:5433/scribe';

/**
 * Lazily-(re)created pool. With Playwright `workers: 1`, every spec file runs in the
 * SAME worker process and shares this module, so one spec's `afterAll` → `closeDb`
 * would otherwise end the pool that a LATER spec still needs. Recreating the pool on
 * demand makes `closeDb` safe to call from every spec's `afterAll` regardless of
 * order, and calling it more than once is a no-op until the pool is used again.
 */
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString });
  return pool;
}

export async function grantMembership(
  documentId: string,
  userEmail: string,
  role: 'editor' | 'viewer',
): Promise<void> {
  const db = getPool();
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    userEmail,
  ]);
  const userId = rows[0]?.id;
  if (!userId) throw new Error(`no user with email ${userEmail}`);
  await db.query(
    `INSERT INTO memberships (document_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [documentId, userId, role],
  );
}

/**
 * Pool teardown. Safe to call from every spec's `afterAll` and safe to call more
 * than once — a later spec that seeds will transparently reconnect via getPool().
 */
export async function closeDb(): Promise<void> {
  if (!pool) return;
  const db = pool;
  pool = null;
  await db.end();
}
