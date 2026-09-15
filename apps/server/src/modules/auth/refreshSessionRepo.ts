import { pool } from '../../db/pool.js';

/**
 * Persistence for stateful refresh tokens (rotation + reuse detection). One row per
 * issued refresh token keyed by `jti`; every token from one login shares a
 * `family_id` so a whole session can be revoked at once. See migration 003 and
 * docs/architecture/security.md.
 *
 * There is no CRDT here — this is ordinary transactional metadata. The rotation is
 * done inside a single `SELECT ... FOR UPDATE` transaction so two requests carrying
 * the same token are serialized (which is what makes safe concurrent refresh and
 * genuine reuse distinguishable).
 */

export interface SessionRow {
  jti: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
}

/** Result of attempting to rotate a presented refresh token. */
export type RotateOutcome =
  | { status: 'ok'; userId: string }
  | { status: 'reuse'; userId: string; familyId: string }
  | { status: 'invalid' };

/** Insert a freshly-issued token row (login/register create the first of a family). */
export async function insertSession(row: SessionRow): Promise<void> {
  await pool.query(
    `INSERT INTO refresh_token (jti, user_id, family_id, expires_at) VALUES ($1, $2, $3, $4)`,
    [row.jti, row.userId, row.familyId, row.expiresAt],
  );
}

/**
 * Atomically consume `oldJti` and issue `newJti` in the same family.
 *
 * - unknown/expired token → `invalid` (nothing trusted).
 * - already-consumed token presented again **after** the grace window → `reuse`:
 *   the entire family is deleted (session killed), so a stolen token cannot be used.
 * - already-consumed token within the grace window → treated as a benign concurrent
 *   double-refresh (e.g. two tabs / the WS token callback racing an API 401): a new
 *   sibling token is issued instead of nuking the session.
 * - fresh token → normal rotation: mark consumed, issue the successor.
 */
export async function rotateSession(
  oldJti: string,
  newJti: string,
  newExpiresAt: Date,
  graceMs: number,
): Promise<RotateOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      user_id: string;
      family_id: string;
      used_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT user_id, family_id, used_at, expires_at FROM refresh_token WHERE jti = $1 FOR UPDATE`,
      [oldJti],
    );
    const row = rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      return { status: 'invalid' };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('DELETE FROM refresh_token WHERE jti = $1', [oldJti]);
      await client.query('COMMIT');
      return { status: 'invalid' };
    }

    if (row.used_at) {
      const usedMsAgo = Date.now() - new Date(row.used_at).getTime();
      if (usedMsAgo > graceMs) {
        // Reuse of a long-consumed token → assume theft; revoke the whole family.
        await client.query('DELETE FROM refresh_token WHERE family_id = $1', [row.family_id]);
        await client.query('COMMIT');
        return { status: 'reuse', userId: row.user_id, familyId: row.family_id };
      }
      // Benign concurrent refresh: issue a fresh sibling in the same family.
      await client.query(
        `INSERT INTO refresh_token (jti, user_id, family_id, expires_at) VALUES ($1, $2, $3, $4)`,
        [newJti, row.user_id, row.family_id, newExpiresAt],
      );
      await client.query('COMMIT');
      return { status: 'ok', userId: row.user_id };
    }

    // Normal rotation: consume the old token, mint its successor.
    await client.query('UPDATE refresh_token SET used_at = now() WHERE jti = $1', [oldJti]);
    await client.query(
      `INSERT INTO refresh_token (jti, user_id, family_id, expires_at) VALUES ($1, $2, $3, $4)`,
      [newJti, row.user_id, row.family_id, newExpiresAt],
    );
    // Opportunistic cleanup so consumed/expired rows don't accumulate unbounded.
    await client.query('DELETE FROM refresh_token WHERE user_id = $1 AND expires_at < now()', [
      row.user_id,
    ]);
    await client.query('COMMIT');
    return { status: 'ok', userId: row.user_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Revoke the whole family the given token belongs to (used by logout). No-op if unknown. */
export async function revokeFamilyByJti(jti: string): Promise<void> {
  const { rows } = await pool.query<{ family_id: string }>(
    'SELECT family_id FROM refresh_token WHERE jti = $1',
    [jti],
  );
  const familyId = rows[0]?.family_id;
  if (familyId) {
    await pool.query('DELETE FROM refresh_token WHERE family_id = $1', [familyId]);
  }
}
