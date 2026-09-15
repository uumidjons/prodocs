/** A collaborator derived from ephemeral Yjs awareness state (never persisted). */
export interface PresenceUser {
  /** Stable application user id (dedupes multiple tabs of the same person). */
  id: string;
  name: string;
  color: string;
}
