import { describe, expect, it } from 'vitest';
import { ConfigError, buildConfig } from './index.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(16),
  JWT_REFRESH_SECRET: 'b'.repeat(16),
};

describe('buildConfig', () => {
  it('applies safe defaults and parses required values', () => {
    const c = buildConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.nodeEnv).toBe('development');
    expect(c.port).toBe(4000);
    expect(c.corsOrigins).toEqual(['http://localhost:5173']);
    expect(c.cookie.secure).toBe(false);
  });

  it('coerces PORT and splits CORS_ORIGINS', () => {
    const c = buildConfig({
      ...base,
      PORT: '5000',
      CORS_ORIGINS: 'http://a.com, http://b.com',
    } as NodeJS.ProcessEnv);
    expect(c.port).toBe(5000);
    expect(c.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });

  it('throws when a required secret is missing', () => {
    expect(() => buildConfig({ DATABASE_URL: base.DATABASE_URL } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    );
  });

  it('rejects a too-short JWT secret', () => {
    expect(() => buildConfig({ ...base, JWT_ACCESS_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    );
  });

  it('rejects default secrets in production', () => {
    expect(() =>
      buildConfig({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change_me_change_me_change_me',
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it('applies Phase 4 abuse-limit defaults', () => {
    const c = buildConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.limits.maxHttpBodyBytes).toBe(64 * 1024);
    expect(c.limits.maxWsMessageBytes).toBe(1024 * 1024);
    expect(c.refreshReuseGraceMs).toBe(10_000);
    expect(c.rateLimitMaxOverride).toBeUndefined();
  });

  it('coerces the Phase 4 abuse-limit overrides when provided', () => {
    const c = buildConfig({
      ...base,
      MAX_HTTP_BODY_BYTES: '2048',
      MAX_WS_MESSAGE_BYTES: '4096',
      REFRESH_REUSE_GRACE_MS: '0',
      RATE_LIMIT_MAX: '3',
    } as NodeJS.ProcessEnv);
    expect(c.limits.maxHttpBodyBytes).toBe(2048);
    expect(c.limits.maxWsMessageBytes).toBe(4096);
    expect(c.refreshReuseGraceMs).toBe(0);
    expect(c.rateLimitMaxOverride).toBe(3);
  });
});
