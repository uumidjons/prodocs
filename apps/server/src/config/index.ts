import { z } from 'zod';

/**
 * Centralized, validated configuration. Nothing else in the app reads
 * `process.env` directly — everyone imports `config`. Invalid or missing values
 * fail fast at startup with a clear message rather than surfacing as a runtime
 * bug later. See docs/architecture/security.md (secrets via env only).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).startsWith('postgres'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Abuse limits (Phase 4). Defaults are generous for legitimate use but bound
  // resource exhaustion; see docs/architecture/security.md for the rationale.
  // Max HTTP request body: our bodies are tiny (email/password/title), so 64 KiB
  // is >100× headroom while rejecting large-body floods early.
  MAX_HTTP_BODY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024),
  // Max single WebSocket frame. Yjs edits are tens of bytes; an initial full-doc
  // sync is the largest legitimate frame. 1 MiB is very generous for MVP documents
  // while capping the ws default of 100 MiB. Exceeding it closes the socket (1009).
  MAX_WS_MESSAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),

  // Grace window (ms) in which re-presenting a just-consumed refresh token is
  // treated as a benign concurrent refresh rather than theft. Configurable so tests
  // can set it to 0 to exercise reuse detection deterministically. See security.md.
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().nonnegative().default(10_000),

  // Media attachments (Phase — media & comments). Binaries live on disk under
  // MEDIA_DIR behind an authenticated endpoint (ADR 0012), never in Yjs/Postgres.
  // Default is a repo-local dir (a docker named volume in compose) created on boot.
  MEDIA_DIR: z.string().default('var/media'),
  // Max uploaded image size. 5 MiB is generous for document images while bounding
  // disk/memory per upload; the server enforces it independently of the client.
  MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),

  // Optional hard override for every rate-limit ceiling. Left unset in normal use
  // (per-endpoint defaults apply, and limits are effectively off under test so
  // suites can drive many requests). A test sets this low to exercise the limiter
  // without slowing the suite; a deployment could use it to tune limits centrally.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  cookie: {
    secure: boolean;
    domain: string | undefined;
  };
  corsOrigins: string[];
  limits: {
    maxHttpBodyBytes: number;
    maxWsMessageBytes: number;
  };
  media: {
    /** Directory where uploaded binaries are stored (created on boot). */
    dir: string;
    /** Maximum accepted upload size in bytes. */
    maxBytes: number;
  };
  /** Grace window (ms) tolerating concurrent re-use of a just-rotated refresh token. */
  refreshReuseGraceMs: number;
  /** When set, forces every rate-limit ceiling to this value (else per-endpoint defaults). */
  rateLimitMaxOverride: number | undefined;
}

/**
 * The effective ceiling for a rate-limited endpoint: the global override if set,
 * otherwise `perEnvDefault` (which callers set to a huge number under test so suites
 * aren't throttled). Centralizes the "override wins, else default" rule.
 */
export function rateLimitMax(perEnvDefault: number): number {
  return config.rateLimitMaxOverride ?? perEnvDefault;
}

export class ConfigError extends Error {}

/**
 * Pure, testable config builder. Throws {@link ConfigError} with an aggregated,
 * human-readable message when the environment is invalid.
 */
export function buildConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;

  if (e.NODE_ENV === 'production') {
    const weak = [e.JWT_ACCESS_SECRET, e.JWT_REFRESH_SECRET].some((s) => s.includes('change_me'));
    if (weak) {
      throw new ConfigError('Refusing to start in production with default JWT secrets.');
    }
  }

  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwt: {
      accessSecret: e.JWT_ACCESS_SECRET,
      refreshSecret: e.JWT_REFRESH_SECRET,
      accessTtl: e.JWT_ACCESS_TTL,
      refreshTtl: e.JWT_REFRESH_TTL,
    },
    cookie: {
      secure: e.COOKIE_SECURE,
      domain: e.COOKIE_DOMAIN || undefined,
    },
    corsOrigins: e.CORS_ORIGINS,
    limits: {
      maxHttpBodyBytes: e.MAX_HTTP_BODY_BYTES,
      maxWsMessageBytes: e.MAX_WS_MESSAGE_BYTES,
    },
    media: {
      dir: e.MEDIA_DIR,
      maxBytes: e.MEDIA_MAX_BYTES,
    },
    refreshReuseGraceMs: e.REFRESH_REUSE_GRACE_MS,
    rateLimitMaxOverride: e.RATE_LIMIT_MAX,
  };
}

function loadOrExit(): AppConfig {
  try {
    return buildConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export const config = loadOrExit();
