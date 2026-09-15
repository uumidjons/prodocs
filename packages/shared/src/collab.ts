import { PRESENCE_COLORS } from './roles.js';

/**
 * WebSocket close code the collaboration server sends to a client whose PERMISSION
 * on a document changed (role change or removal). Shared so the server (which sends
 * it) and the client (which reacts to it) cannot drift.
 *
 * It is a deliberately NON-terminal application code (not 4401 Unauthorized / 4403
 * Forbidden), so the Hocuspocus provider treats it as an ordinary drop and
 * RECONNECTS, re-running the server's `onAuthenticate` against the current
 * membership. On the CLIENT it is ALSO the authoritative signal to discard any
 * local (possibly unauthorized/unsynced) CRDT state and resync purely from the
 * server — see useCollaboration.ts — which is what stops edits a user made while
 * unauthorized from resurrecting after their role is restored.
 */
export const PERMISSION_CHANGED_CLOSE_CODE = 4210;

/**
 * Collaboration VISUAL identity helpers (shared so client and tests agree).
 *
 * A user's *profile* color (assigned randomly at registration, used for their
 * account avatar) is NOT reused as their collaboration color: two collaborators
 * can be dealt the same random profile color, which would make their cursors and
 * selections ambiguous. Instead the collaboration color is derived
 * DETERMINISTICALLY from the stable user id, so:
 *   - the same user gets the same collaboration color on every client viewing the
 *     document (no coordination needed), and
 *   - the mapping is spread across the presence palette, so distinct users usually
 *     get distinct colors when the palette is large enough.
 *
 * This is intentionally a tiny pure function, not a color-management subsystem, and
 * it adds no database field — the color is computed on demand from the id.
 */

/** Deterministic, stable collaboration color for a user id (from the presence palette). */
export function collaborationColor(userId: string): string {
  // Small, stable string hash (FNV-like); identical on every client for a given id.
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (Math.imul(hash, 31) + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PRESENCE_COLORS.length;
  return PRESENCE_COLORS[idx] ?? PRESENCE_COLORS[0];
}

/**
 * A readable text color (near-black or white) to place ON a solid collaboration
 * color, chosen by perceived luminance so the name label stays legible on light
 * palette colors (e.g. amber) as well as dark ones (e.g. indigo).
 */
export function readableTextColor(hexColor: string): '#0F172A' | '#FFFFFF' {
  const hex = hexColor.replace('#', '');
  if (hex.length < 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Perceived luminance (ITU-R BT.601 weights), normalized to 0..1.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0F172A' : '#FFFFFF';
}
