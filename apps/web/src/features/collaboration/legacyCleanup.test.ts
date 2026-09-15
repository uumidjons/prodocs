import { afterEach, describe, expect, it } from 'vitest';
import { removeLegacyDraftStorage } from './legacyCleanup.js';

describe('removeLegacyDraftStorage', () => {
  afterEach(() => localStorage.clear());

  it('purges the Phase-1 doc-draft bridge keys and leaves other keys intact', () => {
    localStorage.setItem('scribe:doc-draft:v1:abc', '{"json":{}}');
    localStorage.setItem('scribe:doc-draft:v1:def', '{"json":{}}');
    localStorage.setItem('theme', 'light');

    removeLegacyDraftStorage();

    expect(localStorage.getItem('scribe:doc-draft:v1:abc')).toBeNull();
    expect(localStorage.getItem('scribe:doc-draft:v1:def')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
