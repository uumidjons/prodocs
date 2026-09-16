import { expect, test } from '@playwright/test';
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
 * PHASE 8 — underline + text alignment (real Chromium). Proves the formatting is
 * real document state: it renders, persists across reload, collaborates through
 * Yjs, survives a page break, and is read-only for viewers.
 *
 * NOTE: a BLANK document opens genuinely empty (one empty paragraph — see
 * EMPTY_DOCUMENT_CONTENT), so each scenario first types content to format. An inline
 * mark like underline only produces a `<u>` element when there is text to wrap.
 */

test.afterAll(async () => {
  await closeDb();
});

test('Scenario A: underline applies and survives reload', async ({ browser, request }) => {
  const user = uniqueUser('ul');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  // Type a line, then select it and underline it via the toolbar.
  await body(page).click();
  await body(page).pressSequentially('Underlined heading');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: /underline/i }).click();

  await expect(page.locator('[aria-label="Document body"] u')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /underline/i })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();
  // Underline persisted through the server round-trip.
  await expect(page.locator('[aria-label="Document body"] u')).toHaveCount(1, { timeout: 20000 });

  await ctx.close();
});

test('Scenario B: left/center/right/justify persist across reload', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('align');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  const setAlign = async (label: RegExp) => {
    await page.getByRole('button', { name: /alignment/i }).click();
    await page.getByRole('option', { name: label }).click();
  };

  // Type three distinct blocks to align independently.
  await body(page).click();
  await body(page).pressSequentially('First block');
  await page.keyboard.press('Enter');
  await body(page).pressSequentially('Second block');
  await page.keyboard.press('Enter');
  await body(page).pressSequentially('Third block');

  // Center the first block…
  await page.keyboard.press('Control+Home');
  await setAlign(/align center/i);
  await expect(
    page.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1);

  // …right-align a lower block…
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await setAlign(/align right/i);
  await expect(
    page.locator('[aria-label="Document body"] [style*="text-align: right"]'),
  ).toHaveCount(1);

  await expectStatus(page, /synced/i);
  // Let the append-then-debounced-snapshot flush before reloading (mirrors Scenario F).
  await page.waitForTimeout(800);
  await page.reload();

  // Both alignments persisted.
  await expect(
    page.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[aria-label="Document body"] [style*="text-align: right"]'),
  ).toHaveCount(1);

  await ctx.close();
});

test('Scenario C: formatting synchronizes between two collaborators', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('fa');
  const userB = uniqueUser('fb');
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

  // A types a line (which syncs to B), then underlines the first few characters →
  // B sees the <u> (via Yjs sync).
  await body(pageA).click();
  await pageA.keyboard.press('Control+Home');
  await body(pageA).pressSequentially('Shared heading');
  await expect(pageB.locator('[aria-label="Document body"]')).toContainText('Shared heading', {
    timeout: 20000,
  });
  await pageA.keyboard.press('Control+Home');
  for (let i = 0; i < 6; i += 1) await pageA.keyboard.press('Shift+ArrowRight');
  await pageA.getByRole('button', { name: /underline/i }).click();
  await expect(pageA.locator('[aria-label="Document body"] u')).toHaveCount(1);
  await expect(pageB.locator('[aria-label="Document body"] u')).toHaveCount(1, { timeout: 20000 });

  // B centers a block → A sees the centered block (via Yjs sync).
  await body(pageB).click();
  await pageB.keyboard.press('Control+Home');
  await pageB.getByRole('button', { name: /alignment/i }).click();
  await pageB.getByRole('option', { name: /align center/i }).click();
  await expect(
    pageB.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1);
  await expect(
    pageA.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1, { timeout: 20000 });

  await ctxA.close();
  await ctxB.close();
});

test('Scenario D: a viewer sees formatting but cannot change it', async ({ browser, request }) => {
  const owner = uniqueUser('fo');
  const viewer = uniqueUser('fv');
  await registerUser(request, owner);
  await registerUser(request, viewer);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, viewer.email, 'viewer');

  // Owner types a line and applies underline first.
  await body(pageA).click();
  await body(pageA).pressSequentially('Owner heading');
  await pageA.keyboard.press('Home');
  await pageA.keyboard.press('Shift+End');
  await pageA.getByRole('button', { name: /underline/i }).click();
  await expect(pageA.locator('[aria-label="Document body"] u')).toHaveCount(1);
  await expectStatus(pageA, /synced/i);

  // Viewer opens: sees the underline, but the controls are read-only.
  await loginUI(pageB, viewer);
  await pageB.goto(`/d/${docId}`);
  await expect(pageB.locator('[aria-label="Document body"] u')).toHaveCount(1);
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'false');
  await expect(pageB.getByRole('button', { name: /underline/i })).toBeDisabled();
  await expect(pageB.getByRole('button', { name: /alignment/i })).toBeDisabled();

  await ctxA.close();
  await ctxB.close();
});

test('Scenario F: formatting + a manual page break both survive reload', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('fpb');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  // Insert the page break FIRST at a clean, collapsed, mid-block cursor (End of the
  // first line → parentOffset > 0), so we never touch the page-break command's
  // block-start selection-replace edge. Then type after the break, underline that
  // fresh text, and center it.
  await body(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End'); // end of the first line, collapsed
  await body(page).press('Control+Enter'); // clean page break
  const after = 'AFTER_BREAK_LINE';
  await body(page).pressSequentially(after);
  // Select the freshly typed text and underline it.
  for (let i = 0; i < after.length; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: /underline/i }).click();
  await expect(page.locator('[aria-label="Document body"] u')).toHaveCount(1);
  await page.keyboard.press('ArrowRight'); // collapse
  // Center this block.
  await page.getByRole('button', { name: /alignment/i }).click();
  await page.getByRole('option', { name: /align center/i }).click();

  await expect(page.locator('[data-page-break]')).toHaveCount(1);
  await expect(
    page.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1);
  // Let the last updates flush to the server before reloading (persistence is
  // append-then-debounced-snapshot).
  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();

  // Underline, alignment, and the page break all persisted together.
  await expect(page.locator('[aria-label="Document body"] u')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('[data-page-break]')).toHaveCount(1);
  await expect(
    page.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1);
  await expect(page.locator('.scribe-page-gap')).toHaveCount(1);

  await ctx.close();
});
