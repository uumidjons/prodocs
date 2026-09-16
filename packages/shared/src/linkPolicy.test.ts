import { describe, expect, it } from 'vitest';
import { ALLOWED_LINK_SCHEMES, isSafeLinkUrl, normalizeLinkHref } from './linkPolicy.js';

describe('isSafeLinkUrl', () => {
  it('accepts the allowed schemes', () => {
    expect(isSafeLinkUrl('https://example.com')).toBe(true);
    expect(isSafeLinkUrl('http://example.com/path?q=1#h')).toBe(true);
    expect(isSafeLinkUrl('mailto:a@b.com')).toBe(true);
    expect(isSafeLinkUrl('tel:+15551234')).toBe(true);
  });

  it('rejects dangerous / executable schemes', () => {
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeLinkUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeLinkUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeLinkUrl('blob:https://x/y')).toBe(false);
  });

  it('rejects schemes smuggled past with embedded whitespace/control chars', () => {
    // Browsers strip these before dereferencing; so must we, before classifying.
    expect(isSafeLinkUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl(' javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects empty / schemeless / nullish input (fail-closed)', () => {
    expect(isSafeLinkUrl('')).toBe(false);
    expect(isSafeLinkUrl(null)).toBe(false);
    expect(isSafeLinkUrl(undefined)).toBe(false);
    expect(isSafeLinkUrl('example.com')).toBe(false); // no scheme
  });

  it('exposes exactly the documented allow-list', () => {
    expect([...ALLOWED_LINK_SCHEMES]).toEqual(['http', 'https', 'mailto', 'tel']);
  });
});

describe('normalizeLinkHref', () => {
  it('passes through already-valid URLs', () => {
    expect(normalizeLinkHref('https://example.com')).toBe('https://example.com');
    expect(normalizeLinkHref('  http://x.io/p  ')).toBe('http://x.io/p');
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('upgrades a bare host to https://', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com');
    expect(normalizeLinkHref('www.foo.io/bar')).toBe('https://www.foo.io/bar');
  });

  it('does not turn arbitrary text into a URL', () => {
    expect(normalizeLinkHref('click here')).toBeNull(); // has a space
    expect(normalizeLinkHref('nodothere')).toBeNull(); // no dot, no scheme
    expect(normalizeLinkHref('')).toBeNull();
    expect(normalizeLinkHref('   ')).toBeNull();
    expect(normalizeLinkHref(null)).toBeNull();
  });

  it('rejects dangerous schemes rather than upgrading them', () => {
    expect(normalizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('data:text/html,x')).toBeNull();
  });
});
