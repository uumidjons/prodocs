/**
 * Trigger a browser "Save file" for a generated Blob. Client-only: the bytes are
 * produced in the browser (from the local document state) and handed to the user via
 * an object URL — no upload, no server round trip (task §10). The object URL is
 * revoked after the click so it does not leak.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke a tick so the download has started in every browser.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
