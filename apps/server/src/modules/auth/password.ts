import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (docs/architecture/security.md). Parameters follow
 * OWASP guidance for interactive logins. `@node-rs/argon2` ships prebuilt
 * binaries, so there is no native compile step in Docker.
 */
const OPTIONS = {
  // argon2id is the default algorithm for this library.
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verify(hashed, plain);
}
