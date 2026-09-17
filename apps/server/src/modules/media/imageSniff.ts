/**
 * Content-based image detection (ADR 0012, §4/§5): the server NEVER trusts the
 * client-declared MIME type. It sniffs the actual bytes (magic numbers) and only
 * accepts PNG, JPEG, and WebP. This is also the reason an executable renamed `.png`,
 * an HTML file, or an SVG is rejected: their bytes don't match an accepted signature.
 *
 * Intrinsic dimensions are parsed best-effort (a layout hint only; never a security
 * decision) — PNG and (via SOF markers) JPEG reliably, WebP for the common chunk forms.
 */

export type SniffedMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface SniffResult {
  mime: SniffedMime;
  width: number | null;
  height: number | null;
}

function isPng(b: Buffer): boolean {
  return (
    b.length >= 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

function pngDims(b: Buffer): { width: number; height: number } | null {
  // IHDR is the first chunk; width/height are big-endian uint32 at offsets 16 and 20.
  if (b.length < 24) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function jpegDims(b: Buffer): { width: number; height: number } | null {
  // Walk the JPEG marker segments looking for a Start-Of-Frame (SOF0..SOF15, except
  // the non-SOF markers 0xC4/0xC8/0xCC). SOF payload: [precision(1)][height(2)][width(2)].
  let offset = 2; // skip SOI (FFD8)
  const len = b.length;
  while (offset + 9 < len) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1]!;
    // Standalone markers without a length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLen = b.readUInt16BE(offset + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = b.readUInt16BE(offset + 5);
      const width = b.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + segLen;
  }
  return null;
}

function isWebp(b: Buffer): boolean {
  return (
    b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
  );
}

function webpDims(b: Buffer): { width: number; height: number } | null {
  const fourcc = b.toString('ascii', 12, 16);
  try {
    if (fourcc === 'VP8 ' && b.length >= 30) {
      // Lossy: dimensions are 14-bit little-endian at offset 26/28.
      const width = b.readUInt16LE(26) & 0x3fff;
      const height = b.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (fourcc === 'VP8L' && b.length >= 25) {
      // Lossless: 1 signature byte then packed 14-bit-1 dims.
      const bits = b.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
    if (fourcc === 'VP8X' && b.length >= 30) {
      // Extended: 24-bit-1 canvas dims at offset 24 (width) and 27 (height).
      const width = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
      const height = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
      return { width, height };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Detects an accepted image type from its bytes, or returns null when the content is
 * not a supported image (the caller rejects the upload). The returned `mime` is
 * authoritative — callers must persist/serve THIS, not the client's claim.
 */
export function sniffImage(buffer: Buffer): SniffResult | null {
  if (isPng(buffer)) {
    const d = pngDims(buffer);
    return { mime: 'image/png', width: d?.width ?? null, height: d?.height ?? null };
  }
  if (isJpeg(buffer)) {
    const d = jpegDims(buffer);
    return { mime: 'image/jpeg', width: d?.width ?? null, height: d?.height ?? null };
  }
  if (isWebp(buffer)) {
    const d = webpDims(buffer);
    return { mime: 'image/webp', width: d?.width ?? null, height: d?.height ?? null };
  }
  return null;
}
