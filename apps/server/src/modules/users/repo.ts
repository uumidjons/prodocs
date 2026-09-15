import type { UserDto, UserSearchResultDto } from '@scribe/shared';
import { PRESENCE_COLORS } from '@scribe/shared';
import { pool } from '../../db/pool.js';

/** Raw `users` row, including the secret hash (never sent to clients). */
export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  color: string;
  password_hash: string;
  created_at: Date;
}

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    createdAt: row.created_at.toISOString(),
  };
}

function pickColor(): string {
  const idx = Math.floor(Math.random() * PRESENCE_COLORS.length);
  return PRESENCE_COLORS[idx] ?? PRESENCE_COLORS[0];
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Search registered users by email or display name for the sharing "add member"
 * control. Returns ONLY public identity fields (never the hash) and caps the
 * result set. The caller is excluded (you don't share a document with yourself).
 * The query is a case-insensitive substring; a minimum length is enforced at the
 * schema layer to blunt mass enumeration.
 */
export async function searchUsers(
  query: string,
  excludeUserId: string,
  limit = 10,
): Promise<UserSearchResultDto[]> {
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    color: string;
  }>(
    `SELECT id, email, display_name, color
       FROM users
      WHERE id <> $1
        AND email NOT LIKE 'system+%'
        AND (email ILIKE $2 OR display_name ILIKE $2)
      ORDER BY display_name ASC
      LIMIT $3`,
    [excludeUserId, pattern, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    color: r.color,
  }));
}

export async function createUser(input: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, display_name, color, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.email, input.displayName, pickColor(), input.passwordHash],
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create user');
  return row;
}
