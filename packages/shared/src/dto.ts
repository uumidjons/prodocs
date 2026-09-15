import type { Role } from './roles.js';

/**
 * Data Transfer Objects — the shapes that cross the HTTP boundary. These never
 * include secrets (e.g. no password_hash). They are the shared contract used by
 * the backend responses and the frontend API client.
 */

/** The sidebar section a document listing is scoped to. */
export type DocumentView = 'mine' | 'recent' | 'shared' | 'trash';

/** A user as exposed to the client. */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  color: string;
  createdAt: string; // ISO 8601
}

/** Document metadata. Content (Yjs state) is intentionally NOT here. */
export interface DocumentDto {
  id: string;
  title: string;
  ownerId: string;
  /** The owner's display name — used by the "Shared with me" listing. */
  ownerName: string;
  /** The requesting user's role on this document. */
  role: Role;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** When the current user last opened this document (Recent). Null if never. */
  lastOpenedAt: string | null; // ISO 8601 or null
  /** When the document was moved to Trash (soft delete). Null when live. */
  deletedAt: string | null; // ISO 8601 or null
}

/**
 * A system template as exposed to the client's "New document → From template"
 * picker. Deliberately minimal: only what the picker needs to show and select. The
 * template's content is never sent over HTTP — it is copied server-side into the new
 * document's Yjs state when the user creates from it.
 */
export interface TemplateDto {
  id: string;
  title: string;
  /** A short, human description of what the template is for (optional). */
  description?: string;
}

/** Returned by login/register/refresh: access token is held in memory by the client. */
export interface AuthResultDto {
  user: UserDto;
  accessToken: string;
}

/**
 * A member of a document as exposed to the client (sharing UI). Combines the
 * user's public identity with their role on the document. Never includes secrets
 * (no password hash, no tokens) — see security.md.
 */
export interface MemberDto {
  userId: string;
  email: string;
  displayName: string;
  color: string;
  role: Role;
  /** True when this member is the document owner (owner invariant — cannot be
   *  removed or role-changed via the sharing API). */
  isOwner: boolean;
}

/**
 * A user returned by the sharing user-search endpoint. Deliberately minimal — only
 * what the "add member" UI needs to identify and display a person. No security
 * fields, no unrelated profile data (security.md — least exposure).
 */
export interface UserSearchResultDto {
  id: string;
  email: string;
  displayName: string;
  color: string;
}

/** Consistent error envelope for all non-2xx responses. */
export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    /** Optional field-level validation details. */
    details?: Record<string, string[]>;
  };
}
