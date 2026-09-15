/**
 * Document membership roles. The ordering encodes privilege: `owner` > `editor` > `viewer`.
 * These are the only roles in the MVP (see docs/architecture/data-model.md).
 */
export const ROLES = ['owner', 'editor', 'viewer'] as const;

export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

/** True when `role` grants at least the privileges of `required`. */
export function roleAtLeast(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

/** Presence/identity color palette from UI/DESIGN.md (jewel-tone presence tokens). */
export const PRESENCE_COLORS = [
  '#3B49DF', // primary ink
  '#10B981', // emerald
  '#F43F5E', // warm coral
  '#F59E0B', // vivid amber
  '#8B5CF6', // iris violet
  '#0EA5E9', // sky
] as const;

export type PresenceColor = (typeof PRESENCE_COLORS)[number];
