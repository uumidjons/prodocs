import { afterEach, describe, expect, it } from 'vitest';
import type { DocumentDto } from '@scribe/shared';
import { cacheDocumentMeta, readCachedDocumentMeta } from './metadataCache.js';

/**
 * The offline metadata cache stores document METADATA only (title/role/timestamps)
 * so a previously-seen document can open after an offline reload. These tests pin
 * that contract: it round-trips, it rejects corrupt entries, and — importantly —
 * it never stores anything resembling document content.
 */

const doc: DocumentDto = {
  id: 'doc-1',
  title: 'Q3 Strategy',
  ownerId: 'user-1',
  ownerName: 'User One',
  role: 'editor',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lastOpenedAt: null,
  deletedAt: null,
};

afterEach(() => localStorage.clear());

describe('document metadata cache', () => {
  it('round-trips metadata for a known document', () => {
    cacheDocumentMeta(doc);
    expect(readCachedDocumentMeta('doc-1')).toEqual(doc);
  });

  it('returns null for an unknown document', () => {
    expect(readCachedDocumentMeta('nope')).toBeNull();
  });

  it('preserves the role so viewer read-only survives an offline open', () => {
    cacheDocumentMeta({ ...doc, role: 'viewer' });
    expect(readCachedDocumentMeta('doc-1')?.role).toBe('viewer');
  });

  it('rejects a corrupt cache entry rather than opening a broken view', () => {
    localStorage.setItem('scribe:doc-meta:v1:doc-1', '{ not valid json');
    expect(readCachedDocumentMeta('doc-1')).toBeNull();
    localStorage.setItem('scribe:doc-meta:v1:doc-2', JSON.stringify({ id: 'doc-2' })); // missing fields
    expect(readCachedDocumentMeta('doc-2')).toBeNull();
  });

  it('stores only metadata keys, never document content', () => {
    cacheDocumentMeta(doc);
    const keys = Object.keys(localStorage);
    expect(keys).toEqual(['scribe:doc-meta:v1:doc-1']);
    // The stored blob is the metadata row only — no ProseMirror/HTML body.
    const raw = localStorage.getItem('scribe:doc-meta:v1:doc-1') ?? '';
    expect(raw).not.toMatch(/content|prosemirror|<p>|paragraph/i);
  });
});
