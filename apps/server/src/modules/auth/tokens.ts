import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';

/**
 * JWT issuance/verification. Two independent secrets separate the short-lived
 * access token (held in memory by the client) from the long-lived refresh token
 * (httpOnly cookie only). See docs/architecture/security.md.
 */
export interface AccessClaims {
  sub: string; // user id
}

export interface RefreshClaims {
  sub: string; // user id
  jti: string; // token id — enables future rotation/reuse-detection
}

export function signAccessToken(userId: string): string {
  return jwt.sign({} satisfies Record<string, never>, config.jwt.accessSecret, {
    subject: userId,
    expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(userId: string, jti: string): string {
  return jwt.sign({ jti }, config.jwt.refreshSecret, {
    subject: userId,
    expiresIn: config.jwt.refreshTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, config.jwt.accessSecret);
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Invalid access token');
  return { sub: decoded.sub };
}

export function verifyRefreshToken(token: string): RefreshClaims {
  const decoded = jwt.verify(token, config.jwt.refreshSecret);
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.jti !== 'string') {
    throw new Error('Invalid refresh token');
  }
  return { sub: decoded.sub, jti: decoded.jti };
}

/**
 * The absolute expiry of an already-signed refresh token, read from its `exp`
 * claim. Used so the persisted session row (refresh_token.expires_at) is kept in
 * lockstep with the JWT's own expiry instead of re-deriving the TTL by hand.
 */
export function refreshTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token);
  if (typeof decoded === 'string' || !decoded || typeof decoded.exp !== 'number') {
    throw new Error('Refresh token has no expiry');
  }
  return new Date(decoded.exp * 1000);
}
