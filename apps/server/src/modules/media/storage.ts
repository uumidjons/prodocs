import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * MediaStorage — the object-storage abstraction (ADR 0012). Binaries live behind this
 * interface so storage stays decoupled from the editor/HTTP layer and can be swapped
 * for S3/MinIO later without touching callers. The MVP ships a filesystem
 * implementation; no cloud SDK is introduced.
 *
 * A `storageKey` is an opaque, server-generated identifier (a UUID) — NEVER a user
 * filename and NEVER a path. Implementations must reject any key that could escape
 * their root (defense in depth against path traversal).
 */
export interface MediaStorage {
  put(storageKey: string, data: Buffer): Promise<void>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

/** A storage key must be a plain UUID — no separators, dots, or traversal sequences. */
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertSafeStorageKey(key: string): void {
  if (!KEY_RE.test(key)) {
    throw new Error('Invalid storage key');
  }
}

/**
 * Filesystem-backed storage rooted at `rootDir`. Files are sharded into two-character
 * subdirectories by a hash of the key to avoid one huge flat directory. The resolved
 * path is verified to stay within the root, so even a malformed key can never write or
 * read outside the media root.
 */
export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly rootDir: string) {}

  private pathFor(storageKey: string): string {
    assertSafeStorageKey(storageKey);
    // Shard by the first 2 chars of a hash of the key (keeps the tree shallow/even).
    const shard = createHash('sha256').update(storageKey).digest('hex').slice(0, 2);
    const abs = resolve(this.rootDir, shard, storageKey);
    const rootAbs = resolve(this.rootDir);
    // Belt-and-suspenders: the resolved file must live under the root.
    if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
      throw new Error('Resolved storage path escapes the media root');
    }
    return abs;
  }

  async put(storageKey: string, data: Buffer): Promise<void> {
    const path = this.pathFor(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }
}

/** Ensures the media root exists (called once at boot). */
export async function ensureMediaDir(rootDir: string): Promise<void> {
  await mkdir(resolve(rootDir), { recursive: true });
}

/** Convenience for callers that only need the resolved root path. */
export function mediaRoot(rootDir: string): string {
  return join(resolve(rootDir));
}
