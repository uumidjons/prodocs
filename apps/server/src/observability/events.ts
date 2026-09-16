import { config } from '../config/index.js';

/**
 * Minimal structured security/operational event logging.
 *
 * Purpose: emit a small set of STABLE, greppable event names for the security- and
 * durability-relevant things that happen outside a normal request log line (auth
 * failures, refresh-token reuse, WebSocket authz denials, oversized frames,
 * persistence failures). Stable `evt` names mean alerts/dashboards can key off them.
 *
 * Hard rule: callers pass only NON-sensitive fields. Never pass passwords, tokens,
 * Authorization headers, cookies, or document contents. This helper does not
 * serialize arbitrary objects that might contain them — callers choose the fields.
 *
 * It is deliberately dependency-free (no pino instance to configure) and silent
 * under test, mirroring the Fastify logger which is silent in `NODE_ENV=test`, so
 * the suite stays quiet while production/dev still get the events.
 */
export type SecurityEvent =
  | 'auth.login.failed'
  | 'auth.refresh.invalid'
  | 'auth.refresh.reuse_detected'
  | 'auth.logout'
  | 'authz.denied'
  | 'ws.auth.failed'
  | 'ws.payload.too_large'
  | 'ratelimit.exceeded'
  | 'persistence.failure';

type Level = 'info' | 'warn' | 'error';

const LEVELS: Record<SecurityEvent, Level> = {
  'auth.login.failed': 'warn',
  'auth.refresh.invalid': 'warn',
  'auth.refresh.reuse_detected': 'error',
  'auth.logout': 'info',
  'authz.denied': 'warn',
  'ws.auth.failed': 'warn',
  'ws.payload.too_large': 'warn',
  'ratelimit.exceeded': 'warn',
  'persistence.failure': 'error',
};

export function logSecurityEvent(evt: SecurityEvent, fields: Record<string, unknown> = {}): void {
  if (config.nodeEnv === 'test') return; // keep the test output clean, like the app logger
  const line = JSON.stringify({ evt, level: LEVELS[evt], t: new Date().toISOString(), ...fields });
  if (LEVELS[evt] === 'error') console.error(line);
  else console.warn(line);
}
