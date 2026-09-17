import { describe, expect, it } from 'vitest';
import { sniffImage } from './imageSniff.js';

/** Minimal valid-enough headers for content sniffing (dimensions where parseable). */
function pngBytes(width = 3, height = 5): Buffer {
  const b = Buffer.alloc(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpegBytes(width = 7, height = 11): Buffer {
  // SOI + a SOF0 segment carrying dimensions.
  const sof = Buffer.alloc(10);
  sof[0] = 0xff;
  sof[1] = 0xc0; // SOF0
  sof.writeUInt16BE(8, 2); // segment length
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof]);
}

function webpBytes(): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  b.writeUInt16LE(20, 26); // width bits
  b.writeUInt16LE(40, 28); // height bits
  return b;
}

describe('sniffImage', () => {
  it('detects PNG by content and reads dimensions', () => {
    expect(sniffImage(pngBytes(3, 5))).toEqual({ mime: 'image/png', width: 3, height: 5 });
  });

  it('detects JPEG by content and reads dimensions from the SOF marker', () => {
    expect(sniffImage(jpegBytes(7, 11))).toEqual({ mime: 'image/jpeg', width: 7, height: 11 });
  });

  it('detects WebP by content', () => {
    const r = sniffImage(webpBytes());
    expect(r?.mime).toBe('image/webp');
  });

  it('rejects an executable disguised as an image (ELF magic)', () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(sniffImage(elf)).toBeNull();
  });

  it('rejects HTML content', () => {
    expect(sniffImage(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
  });

  it('rejects SVG (text/XML, not a supported raster type)', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  it('rejects a GIF (not in the allow-list)', () => {
    expect(sniffImage(Buffer.from('GIF89a....'))).toBeNull();
  });

  it('rejects empty/short input', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it('does not trust the extension/claimed type — only the bytes decide', () => {
    // Bytes are PNG regardless of what a caller might claim elsewhere.
    expect(sniffImage(pngBytes())?.mime).toBe('image/png');
  });
});
