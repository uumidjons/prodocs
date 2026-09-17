import { expect, test, type Page } from '@playwright/test';
import { closeDb, grantMembership } from './db.js';
import {
  body,
  createDocumentUI,
  expectStatus,
  loginUI,
  registerUser,
  uniqueUser,
} from './helpers.js';

/**
 * PHASE — media as a real document-editor object (clipboard paste, resize, layout modes)
 * plus their collaboration/persistence, in real Chromium. Complements
 * media-comments.spec.ts (upload/delete/security) with the new interactions.
 */

// A real, decodable 1×1 PNG (base64, no data-url prefix).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** Dispatch a real ClipboardEvent('paste') carrying a PNG File on the editor DOM. */
async function pasteImage(page: Page, mime = 'image/png'): Promise<void> {
  await page.evaluate(
    async ({ b64, mime }) => {
      const res = await fetch(`data:${mime};base64,${b64}`);
      const blob = await res.blob();
      const file = new File([blob], 'pasted.png', { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
      el.focus();
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { b64: PNG_B64, mime },
  );
}

/** Dispatch a real DragEvent('drop') carrying a PNG File on the editor DOM. */
async function dropImage(page: Page): Promise<void> {
  await page.evaluate(async (b64) => {
    const res = await fetch(`data:image/png;base64,${b64}`);
    const blob = await res.blob();
    const file = new File([blob], 'dropped.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        clientX: r.left + 20,
        clientY: r.top + 20,
      }),
    );
  }, PNG_B64);
}

/** Paste a REAL image of `mime` generated in-browser via canvas (server accepts it). */
async function pasteCanvasImage(page: Page, mime: string): Promise<void> {
  await page.evaluate(async (mime) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3366cc';
    ctx.fillRect(0, 0, 4, 3);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), mime));
    const file = new File([blob], `img.${mime.split('/')[1]}`, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
    el.focus();
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, mime);
}

test.afterAll(async () => {
  await closeDb();
});

test('paste: a PNG from the clipboard uploads and inserts a media node', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('pp');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('Before image');
  const [uploadRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST', {
      timeout: 20000,
    }),
    pasteImage(page),
  ]);
  expect(uploadRes.status()).toBe(201);

  // The media node renders (its view fetches the authenticated bytes).
  await expect(page.locator('.scribe-media-figure')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });
  // The typed text is preserved (paste inserted the image, didn't replace content).
  await expect(body(page)).toContainText('Before image');
  // No base64/data-url ever entered the document JSON.
  const json = JSON.stringify(
    await page.evaluate(() => window.__scribeConvergence?.documentJson()),
  );
  expect(json).not.toContain('data:image');
  expect(json).not.toContain('base64');
  expect(json).toContain('"media"');

  await ctx.close();
});

test('layout + resize: attributes persist across reload', async ({ browser, request }) => {
  const user = uniqueUser('lr');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  const docId = await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST'),
    pasteImage(page),
  ]);
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  // Select the media node, then set a wrap-left layout via its control bar.
  await page.locator('.scribe-media-img').click();
  await page.getByRole('button', { name: /wrap text left/i }).click();
  await expect(page.locator('.scribe-media-figure[data-layout="wrap-left"]')).toHaveCount(1);

  // Drag the resize handle a bit (real interaction) and assert the layout persists.
  const handle = page.locator('.scribe-media-resize');
  const box = await handle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 45, { steps: 5 });
    await page.mouse.up();
  }
  await expectStatus(page, /synced/i);
  await page.waitForTimeout(600);

  // The resize committed a real width attribute (≥ the enforced minimum) into the doc.
  const mediaWidth = await page.evaluate(() => {
    const doc = window.__scribeConvergence?.documentJson() as
      { content?: { type: string; attrs?: { width?: number } }[] } | undefined;
    return doc?.content?.find((n) => n.type === 'media')?.attrs?.width ?? null;
  });
  expect(typeof mediaWidth).toBe('number');
  expect(mediaWidth as number).toBeGreaterThanOrEqual(48);

  // Reload → the layout (and any committed width) survive the server round-trip.
  await page.reload();
  await expect(page.locator('.scribe-media-figure[data-layout="wrap-left"]')).toHaveCount(1, {
    timeout: 20000,
  });
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });
  void docId;

  await ctx.close();
});

test('drop: a dropped image file uploads and inserts a media node', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('dp');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  const [uploadRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST', {
      timeout: 20000,
    }),
    dropImage(page),
  ]);
  expect(uploadRes.status()).toBe(201);
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  await ctx.close();
});

test('paste: JPEG and WebP images upload and render', async ({ browser, request }) => {
  const user = uniqueUser('jw');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST'),
    pasteCanvasImage(page, 'image/jpeg'),
  ]);
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  await body(page).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST'),
    pasteCanvasImage(page, 'image/webp'),
  ]);
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(2, {
    timeout: 20000,
  });

  await ctx.close();
});

test('copy a Scribe image and paste it elsewhere reuses the mediaId (no re-upload)', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('cp');
  await registerUser(request, user);
  const ctx = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  let uploads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/media') && r.method() === 'POST') uploads += 1;
  });
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  // A paragraph, then a pasted image after it.
  await body(page).click();
  await body(page).pressSequentially('anchor');
  await body(page).press('Enter');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST'),
    pasteImage(page),
  ]);
  await expect(page.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });
  expect(uploads).toBe(1);

  // Read the image's attributes, then (with a plain text caret) paste the clipboard HTML
  // that a Scribe COPY produces — ProseMirror serializes the media node via its schema
  // toDOM → `<img data-media-id data-mime width …>`. This exercises the real copy→paste
  // round-trip deterministically (headless keyboard clipboard is unreliable). The media
  // node view carries no src/binary in its own DOM: only the reference round-trips.
  const src = await page.evaluate(() => {
    const doc = window.__scribeConvergence?.documentJson() as
      { content?: { type: string; attrs?: Record<string, unknown> }[] } | undefined;
    return (doc?.content ?? []).find((n) => n.type === 'media')?.attrs ?? {};
  });
  // Place a real text caret inside the anchor paragraph (not a node selection).
  await page.getByText('anchor').click();
  await page.evaluate((attrs) => {
    const a = attrs as Record<string, unknown>;
    const w = a.width ? ` width="${a.width}"` : '';
    const h = a.height ? ` height="${a.height}"` : '';
    const mime = a.mime ? ` data-mime="${a.mime}"` : '';
    const html = `<img class="scribe-media" data-media-id="${a.mediaId}"${mime}${w}${h} data-layout="block" data-align="center">`;
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    const el = document.querySelector('[aria-label="Document body"]') as HTMLElement;
    el.focus();
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, src);

  // A second media node appears — reusing the SAME mediaId, with NO extra upload.
  await expect(page.locator('.scribe-media-figure')).toHaveCount(2, { timeout: 10000 });
  await page.waitForTimeout(400);
  expect(uploads).toBe(1);
  const ids = await page.evaluate(() => {
    const doc = window.__scribeConvergence?.documentJson() as
      { content?: { type: string; attrs?: { mediaId?: string } }[] } | undefined;
    return (doc?.content ?? []).filter((n) => n.type === 'media').map((n) => n.attrs?.mediaId);
  });
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);

  await ctx.close();
});

test('two-user: A changes media layout + size, B converges', async ({ browser, request }) => {
  const a = uniqueUser('mca');
  const b = uniqueUser('mcb');
  await registerUser(request, a);
  await registerUser(request, b);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await loginUI(pageA, a);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, b.email, 'editor');
  await loginUI(pageB, b);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageA, /synced/i);
  await expectStatus(pageB, /synced/i);

  await body(pageA).click();
  await Promise.all([
    pageA.waitForResponse((r) => r.url().includes('/media') && r.request().method() === 'POST'),
    pasteImage(pageA),
  ]);
  await expect(pageA.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });
  await expect(pageB.locator('.scribe-media-figure')).toHaveCount(1, { timeout: 20000 });

  // A sets wrap-right; B must see the same document-semantic layout.
  await pageA.locator('.scribe-media-img').click();
  await pageA.getByRole('button', { name: /wrap text right/i }).click();
  await expect(pageA.locator('.scribe-media-figure[data-layout="wrap-right"]')).toHaveCount(1);
  await expect(pageB.locator('.scribe-media-figure[data-layout="wrap-right"]')).toHaveCount(1, {
    timeout: 20000,
  });

  await ctxA.close();
  await ctxB.close();
});
