import { describe, expect, it } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './tokens.js';

describe('JWT tokens', () => {
  it('round-trips an access token', () => {
    const token = signAccessToken('user-123');
    expect(verifyAccessToken(token).sub).toBe('user-123');
  });

  it('round-trips a refresh token with its jti', () => {
    const token = signRefreshToken('user-123', 'jti-abc');
    const claims = verifyRefreshToken(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.jti).toBe('jti-abc');
  });

  it('rejects an access token verified as a refresh token (separate secrets)', () => {
    const access = signAccessToken('user-123');
    expect(() => verifyRefreshToken(access)).toThrow();
  });

  it('rejects a tampered token', () => {
    const token = signAccessToken('user-123');
    expect(() => verifyAccessToken(token + 'tamper')).toThrow();
  });
});
