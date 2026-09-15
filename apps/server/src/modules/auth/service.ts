import { randomUUID } from 'node:crypto';
import type { AuthResultDto, LoginInput, RegisterInput, UserDto } from '@scribe/shared';
import { config } from '../../config/index.js';
import { Errors } from '../../http/errors.js';
import { logSecurityEvent } from '../../observability/events.js';
import { createUser, findByEmail, findById, toUserDto } from '../users/repo.js';
import { hashPassword, verifyPassword } from './password.js';
import { insertSession, revokeFamilyByJti, rotateSession } from './refreshSessionRepo.js';
import { refreshTokenExpiry, signAccessToken, signRefreshToken } from './tokens.js';

export interface AuthOutcome {
  result: AuthResultDto;
  refreshToken: string;
}

/**
 * Issue a brand-new session (first token of a new family) for `userId` and persist
 * it. Used by login and register. The persisted expiry is read back from the signed
 * JWT so the row and the token expire together.
 */
async function startSession(
  userId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const jti = randomUUID();
  const familyId = randomUUID();
  const refreshToken = signRefreshToken(userId, jti);
  await insertSession({ jti, userId, familyId, expiresAt: refreshTokenExpiry(refreshToken) });
  return { accessToken: signAccessToken(userId), refreshToken };
}

export async function register(input: RegisterInput): Promise<AuthOutcome> {
  const existing = await findByEmail(input.email);
  if (existing) throw Errors.conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);
  const user = await createUser({
    email: input.email,
    displayName: input.displayName,
    passwordHash,
  });

  const { accessToken, refreshToken } = await startSession(user.id);
  return { result: { user: toUserDto(user), accessToken }, refreshToken };
}

export async function login(input: LoginInput): Promise<AuthOutcome> {
  const user = await findByEmail(input.email);
  // Verify even when the user is missing to keep timing roughly uniform, then
  // return a single generic error so we don't reveal which field was wrong.
  const ok = user ? await verifyPassword(user.password_hash, input.password) : false;
  if (!user || !ok) {
    logSecurityEvent('auth.login.failed', { email: input.email });
    throw Errors.unauthorized('Invalid email or password');
  }

  const { accessToken, refreshToken } = await startSession(user.id);
  return { result: { user: toUserDto(user), accessToken }, refreshToken };
}

/**
 * Rotate a presented refresh token: consume it and issue a new access + refresh
 * token in the same family. Detects reuse of an already-consumed token and revokes
 * the whole family (session) when it happens. Throws 401 on any invalid/reused
 * token; the caller clears the cookie on throw.
 */
export async function refresh(oldJti: string, userIdFromToken: string): Promise<AuthOutcome> {
  const newJti = randomUUID();
  // Sign the successor first so we can persist its exact expiry alongside it.
  const newRefreshToken = signRefreshToken(userIdFromToken, newJti);
  const outcome = await rotateSession(
    oldJti,
    newJti,
    refreshTokenExpiry(newRefreshToken),
    config.refreshReuseGraceMs,
  );

  if (outcome.status === 'reuse') {
    logSecurityEvent('auth.refresh.reuse_detected', {
      userId: outcome.userId,
      familyId: outcome.familyId,
    });
    throw Errors.unauthorized('Session invalidated');
  }
  if (outcome.status === 'invalid') {
    logSecurityEvent('auth.refresh.invalid', {});
    throw Errors.unauthorized('Invalid refresh token');
  }

  const user = await findById(outcome.userId);
  if (!user) throw Errors.unauthorized('Session no longer valid');

  return {
    result: { user: toUserDto(user), accessToken: signAccessToken(user.id) },
    refreshToken: newRefreshToken,
  };
}

/** Revoke the session (family) a refresh token belongs to. */
export async function logout(jti: string): Promise<void> {
  await revokeFamilyByJti(jti);
  logSecurityEvent('auth.logout', {});
}

export async function currentUser(userId: string): Promise<UserDto> {
  const user = await findById(userId);
  if (!user) throw Errors.unauthorized('Session no longer valid');
  return toUserDto(user);
}
