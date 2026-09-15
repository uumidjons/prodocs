import { z } from 'zod';
import { ROLES } from './roles.js';

/**
 * Single source of truth for the API contract. Both the backend (request
 * validation) and the frontend (typed client) import these, so the two sides
 * cannot drift — a contract change is a compile error on whichever side lags.
 */

// --- Auth ---

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

// Password policy kept deliberately simple for the foundation; length is the
// dominant factor for resistance to brute force (hashing is Argon2id).
export const passwordSchema = z.string().min(8).max(200);

export const displayNameSchema = z.string().trim().min(1).max(80);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Documents ---

export const documentTitleSchema = z.string().trim().min(1).max(200);

export const createDocumentSchema = z.object({
  // Title is optional on create; the server supplies a default ("Untitled document",
  // or the template's title when created from a template).
  title: documentTitleSchema.optional(),
  // When present, the new document is initialized from a SYSTEM TEMPLATE (task §1/§3).
  // The server copies that template's content into a brand-new, independent document
  // — it never links to the template's live Y.Doc and never copies memberships. Only
  // real system templates are accepted here; a user's own document is NOT a template
  // and cannot be used as a creation source (no recursive "Copy of Copy of …").
  fromTemplateId: z.string().uuid().optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  title: documentTitleSchema,
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const roleSchema = z.enum(ROLES);

// --- Sharing / membership ---

/**
 * Roles a member can be ASSIGNED through the sharing API. Ownership is a
 * document-level invariant (the creator, `documents.owner_id`) — it is never
 * granted, changed, or removed via sharing, so `owner` is intentionally excluded
 * here. Add/change-role operations accept only `editor` or `viewer`.
 */
export const assignableRoles = ['editor', 'viewer'] as const;
export type AssignableRole = (typeof assignableRoles)[number];
export const assignableRoleSchema = z.enum(assignableRoles);

/** Add a registered user to a document with an assignable role. */
export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: assignableRoleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/** Change an existing member's role (owner excluded — see {@link assignableRoles}). */
export const updateMemberRoleSchema = z.object({
  role: assignableRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * User-search query for the sharing "add member" control. A minimum length blunts
 * mass user enumeration (you must know part of an email/name), and the result set
 * is capped server-side.
 */
export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(254),
});
export type UserSearchQueryInput = z.infer<typeof userSearchQuerySchema>;
