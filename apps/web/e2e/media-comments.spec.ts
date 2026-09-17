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
 * PHASE — media attachments & inline comments (real Chromium). Proves media is real
 * uploaded object-storage referenced by a Yjs node (renders, collaborates, deletes,
 * is authorization-gated) and comments are real Yjs annotations (anchor + thread that
 * collaborate, survive edits, resolve, and are viewer-read-only).
 */

const docBody = '[aria-label="Document body"]';

// A real, decodable 1×1 PNG.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

async function uploadImage(page: Page): Promise<void> {
  await page.getByRole('button', { name: /insert image/i }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
}

test.afterAll(async () => {
  await closeDb();
});

test('Media: upload renders, syncs to a collaborator, and delete propagates', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('ma');
  const userB = uniqueUser('mb');
  await registerUser(request, userA);
  await registerUser(request, userB);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, userB.email, 'editor');
  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageA, /synced/i);
  await expectStatus(pageB, /synced/i);

  // A uploads an image → the node renders (figure reaches the loaded state).
  await body(pageA).click();
  await uploadImage(pageA);
  await expect(pageA.locator('.scribe-media-figure')).toHaveCount(1, { timeout: 20000 });
  await expect(pageA.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  // B sees the media node (synced via Yjs) and its own view fetches + renders it.
  await expect(pageB.locator('.scribe-media-figure')).toHaveCount(1, { timeout: 20000 });
  await expect(pageB.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  // A (the uploader) deletes the media via its explicit Remove control (a normal Yjs
  // edit). The image is the document's ONLY block, so this exercises the sole-block
  // deletion path — the one that previously failed to translate into a Yjs delete and
  // resurrected the node on collaborators. Both clients must converge to zero.
  await pageA.locator('.scribe-media-figure').hover();
  await pageA.locator('.scribe-media-remove').click();
  await expect(pageA.locator('.scribe-media-figure')).toHaveCount(0, { timeout: 20000 });
  await expectStatus(pageA, /synced/i);
  await expect(pageB.locator('.scribe-media-figure')).toHaveCount(0, { timeout: 20000 });

  // The deletion must SURVIVE synchronization and reload — the server-persisted Yjs
  // state no longer references the media, so neither client resurrects it on reload.
  await pageB.waitForTimeout(800);
  await pageA.reload();
  await pageB.reload();
  await expect(pageA.locator('.scribe-media-figure')).toHaveCount(0, { timeout: 20000 });
  await expect(pageB.locator('.scribe-media-figure')).toHaveCount(0, { timeout: 20000 });

  await ctxA.close();
  await ctxB.close();
});

test('Media security: viewer cannot upload; a non-member cannot fetch by id', async ({
  browser,
  request,
}) => {
  const owner = uniqueUser('mo');
  const viewer = uniqueUser('mv');
  const stranger = uniqueUser('ms');
  await registerUser(request, owner);
  await registerUser(request, viewer);
  await registerUser(request, stranger);

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, viewer.email, 'viewer');

  // Owner uploads an image; capture the created media id from the network response.
  await body(pageA).click();
  const [uploadRes] = await Promise.all([
    pageA.waitForResponse(
      (r) => r.url().includes(`/documents/${docId}/media`) && r.request().method() === 'POST',
    ),
    uploadImage(pageA),
  ]);
  expect(uploadRes.status()).toBe(201);
  const mediaId = (await uploadRes.json()).mediaId as string;
  await expect(pageA.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  // Viewer: the Insert-image control is disabled (server also rejects, tested server-side).
  const ctxV = await browser.newContext();
  const pageV = await ctxV.newPage();
  await loginUI(pageV, viewer);
  await pageV.goto(`/d/${docId}`);
  await expect(pageV.getByRole('button', { name: /insert image/i })).toBeDisabled();
  // The viewer CAN still see the image (member).
  await expect(pageV.locator('.scribe-media-figure[data-state="ok"]')).toHaveCount(1, {
    timeout: 20000,
  });

  // A stranger (non-member) cannot fetch the media by id — 404, not the bytes.
  const login = await request.post('/api/auth/login', {
    data: { email: stranger.email, password: stranger.password },
  });
  const token = (await login.json()).accessToken as string;
  const forbidden = await request.get(`/api/documents/${docId}/media/${mediaId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(forbidden.status()).toBe(404);

  await ctxA.close();
  await ctxV.close();
});

test('Comments: create highlights + lists, survives an edit, resolves', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('co');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('Comment on this sentence here');
  // Select the first word.
  await page.keyboard.press('Home');
  for (let i = 0; i < 7; i += 1) await page.keyboard.press('Shift+ArrowRight');

  await page.getByRole('button', { name: /add comment/i }).click();
  await page.getByLabel(/^comment$/i).fill('Please rephrase this');
  await page.getByRole('button', { name: /^comment$/i }).click();

  // Highlight anchor appears and the panel lists the comment.
  await expect(page.locator(`${docBody} .scribe-comment`)).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: /comments/i })).toContainText(
    'Please rephrase this',
  );

  // Edit text AFTER the comment — the anchor must remain (mapping).
  await page.keyboard.press('Control+End');
  await body(page).pressSequentially(' and more');
  await expect(page.locator(`${docBody} .scribe-comment`)).toHaveCount(1);

  // Persist across reload (comment is Yjs state → server round-trip).
  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(`${docBody} .scribe-comment`)).toHaveCount(1, { timeout: 20000 });

  // Resolve it from the panel.
  await page
    .getByRole('button', { name: /show comments|hide comments/i })
    .first()
    .click();
  await page.getByRole('button', { name: /^resolve$/i }).click();
  await expect(
    page.locator(`${docBody} .scribe-comment[data-comment-resolved="true"]`),
  ).toHaveCount(1);

  await ctx.close();
});

test('Comments collaborate: A comments, B sees it', async ({ browser, request }) => {
  const userA = uniqueUser('cca');
  const userB = uniqueUser('ccb');
  await registerUser(request, userA);
  await registerUser(request, userB);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, userB.email, 'editor');
  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageA, /synced/i);

  await body(pageA).click();
  await body(pageA).pressSequentially('Shared commented text');
  await expect(body(pageB)).toContainText('Shared commented text', { timeout: 20000 });

  await pageA.keyboard.press('Home');
  for (let i = 0; i < 6; i += 1) await pageA.keyboard.press('Shift+ArrowRight');
  await pageA.getByRole('button', { name: /add comment/i }).click();
  await pageA.getByLabel(/^comment$/i).fill('A note from A');
  await pageA.getByRole('button', { name: /^comment$/i }).click();

  // B sees the highlight (mark synced) and the thread text (Y.Map synced).
  await expect(pageB.locator(`${docBody} .scribe-comment`)).toHaveCount(1, { timeout: 20000 });
  await pageB
    .getByRole('button', { name: /show comments|hide comments/i })
    .first()
    .click();
  await expect(pageB.getByRole('complementary', { name: /comments/i })).toContainText(
    'A note from A',
    { timeout: 20000 },
  );

  await ctxA.close();
  await ctxB.close();
});

test('Comments viewer: read-only cannot add comments', async ({ browser, request }) => {
  const owner = uniqueUser('cvo');
  const viewer = uniqueUser('cvv');
  await registerUser(request, owner);
  await registerUser(request, viewer);

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, viewer.email, 'viewer');
  await body(pageA).click();
  await body(pageA).pressSequentially('Owner text for viewer');
  await expectStatus(pageA, /synced/i);

  const ctxV = await browser.newContext();
  const pageV = await ctxV.newPage();
  await loginUI(pageV, viewer);
  await pageV.goto(`/d/${docId}`);
  await expect(body(pageV)).toHaveAttribute('contenteditable', 'false');
  // Even with a selection, the comment control stays disabled for a viewer.
  await expect(pageV.getByRole('button', { name: /add comment/i })).toBeDisabled();

  await ctxA.close();
  await ctxV.close();
});
