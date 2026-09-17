import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalMediaStorage, assertSafeStorageKey } from './storage.js';

describe('assertSafeStorageKey', () => {
  it('accepts a UUID', () => {
    expect(() => assertSafeStorageKey(randomUUID())).not.toThrow();
  });

  it('rejects path-traversal and separator-bearing keys', () => {
    for (const bad of [
      '../etc/passwd',
      'a/b',
      'a\\b',
      '..',
      '.',
      'key.png',
      'key with space',
      '',
    ]) {
      expect(() => assertSafeStorageKey(bad), bad).toThrow();
    }
  });
});

describe('LocalMediaStorage', () => {
  let root: string;
  let storage: LocalMediaStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'scribe-media-'));
    storage = new LocalMediaStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips bytes under a UUID key', async () => {
    const key = randomUUID();
    const data = Buffer.from([1, 2, 3, 4, 5]);
    await storage.put(key, data);
    expect(await storage.get(key)).toEqual(data);
  });

  it('never writes outside the root and rejects unsafe keys', async () => {
    await expect(storage.put('../escape', Buffer.from('x'))).rejects.toThrow();
    await expect(storage.get('../../etc/passwd')).rejects.toThrow();
    // Nothing escaped the root directory.
    const entries = await readdir(root);
    expect(entries.every((e) => /^[0-9a-f]{2}$/.test(e))).toBe(true);
  });

  it('delete is idempotent (no throw when absent)', async () => {
    const key = randomUUID();
    await expect(storage.delete(key)).resolves.toBeUndefined();
    await storage.put(key, Buffer.from('x'));
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow();
  });
});
