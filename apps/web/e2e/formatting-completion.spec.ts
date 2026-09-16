import { expect, test } from '@playwright/test';
import { closeDb, grantMembership } from './db.js';
import {
  body,
  createDocumentUI,
  expectConverged,
  expectStatus,
  loginUI,
  registerUser,
  setOffline,
  uniqueUser,
} from './helpers.js';

/**
 * PHASE — Editor formatting completion (strikethrough, inline code, task checklist,
 * blockquote, links) in REAL Chromium. Each scenario proves the feature is genuine
 * document state: it renders, persists across reload (server round-trip), collaborates
 * through Yjs, survives offline/reconnect, is read-only for viewers, and stays
 * compatible with the page-break/pagination layer.
 *
 * A blank document opens genuinely empty (one empty paragraph), so each scenario types
 * content first before formatting it.
 */

const docBody = '[aria-label="Document body"]';

test.afterAll(async () => {
  await closeDb();
});

test('Strikethrough + inline code apply and survive reload', async ({ browser, request }) => {
  const user = uniqueUser('sc');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  // Type BOTH lines first (typing new content right after a toolbar click is racy),
  // then format each — the proven pattern from formatting.spec.ts.
  await body(page).click();
  await body(page).pressSequentially('strike me');
  await body(page).press('Enter');
  await body(page).pressSequentially('code here');

  // Strike the first line.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: /strikethrough/i }).click();
  await expect(page.locator(`${docBody} s`)).toHaveCount(1);

  // Inline-code the second line.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: /inline code/i }).click();
  await expect(page.locator(`${docBody} code`)).toHaveCount(1);

  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();

  await expect(page.locator(`${docBody} s`)).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(`${docBody} code`)).toHaveCount(1);

  await ctx.close();
});

test('Blockquote: apply, type, reload keeps it; then remove', async ({ browser, request }) => {
  const user = uniqueUser('bq');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('A quoted thought');
  await page.getByRole('button', { name: /blockquote/i }).click();
  await expect(page.locator(`${docBody} blockquote`)).toHaveCount(1);

  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(`${docBody} blockquote`)).toHaveCount(1, { timeout: 20000 });

  // Remove the blockquote again (caret inside it, toggle off).
  await page.locator(`${docBody} blockquote`).click();
  await page.getByRole('button', { name: /blockquote/i }).click();
  await expect(page.locator(`${docBody} blockquote`)).toHaveCount(0);

  await ctx.close();
});

test('Task checklist: create, check the box, reload keeps checked state', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('task');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  // Type a line, then convert it to a task list (one item).
  await body(page).click();
  await body(page).pressSequentially('Buy milk');
  await page.getByRole('button', { name: /task checklist/i }).click();
  await expect(page.locator(`${docBody} input[type="checkbox"]`)).toHaveCount(1);

  // Check the task via its checkbox → this is a document mutation (a node attribute).
  await page.locator(`${docBody} input[type="checkbox"]`).first().check();
  await expect(page.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);

  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();

  // The task item and its checked state survived the server round-trip — proving the
  // checked state is document/CRDT data, not React/local state.
  await expect(page.locator(`${docBody} input[type="checkbox"]`)).toHaveCount(1, {
    timeout: 20000,
  });
  await expect(page.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);
  await expect(page.locator(`${docBody}`)).toContainText('Buy milk');

  await ctx.close();
});

test('Link: insert via popover, survives reload, then remove; javascript: is rejected', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('link');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('visit our site');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');

  // A dangerous scheme is rejected (inline error, no link applied).
  await page.getByRole('button', { name: /insert link/i }).click();
  await page.getByLabel(/link url/i).fill('javascript:alert(1)');
  await page.getByRole('button', { name: /apply/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator(`${docBody} a`)).toHaveCount(0);

  // A safe URL applies.
  await page.getByLabel(/link url/i).fill('https://example.com');
  await page.getByRole('button', { name: /apply/i }).click();
  const link = page.locator(`${docBody} a`);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://example.com');
  await expect(link).toHaveAttribute('rel', /nofollow/);

  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(`${docBody} a`)).toHaveAttribute('href', 'https://example.com', {
    timeout: 20000,
  });

  // Remove the link (caret inside it → "Edit link").
  await page.locator(`${docBody} a`).click();
  await page.getByRole('button', { name: /edit link/i }).click();
  await page.getByRole('button', { name: /remove/i }).click();
  await expect(page.locator(`${docBody} a`)).toHaveCount(0);

  await ctx.close();
});

test('Collaboration: A applies strikethrough, B applies blockquote, both converge', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('ca');
  const userB = uniqueUser('cb');
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

  // A types two lines that both peers share.
  await body(pageA).click();
  await body(pageA).pressSequentially('line one');
  await pageA.keyboard.press('Enter');
  await body(pageA).pressSequentially('line two');
  await expect(body(pageB)).toContainText('line two', { timeout: 20000 });

  // A strikes the first line.
  await pageA.keyboard.press('Control+Home');
  await pageA.keyboard.press('Shift+End');
  await pageA.getByRole('button', { name: /strikethrough/i }).click();
  await expect(pageB.locator(`${docBody} s`)).toHaveCount(1, { timeout: 20000 });

  // B blockquotes the second line.
  await pageB.locator(`${docBody}`).click();
  await pageB.keyboard.press('Control+End');
  await pageB.getByRole('button', { name: /blockquote/i }).click();
  await expect(pageA.locator(`${docBody} blockquote`)).toHaveCount(1, { timeout: 20000 });

  await ctxA.close();
  await ctxB.close();
});

test('Offline: A checks a task offline, B adds a link online, reconnect converges', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('oa');
  const userB = uniqueUser('ob');
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

  // Seed a task line + a paragraph to link (type both first, then convert only the
  // first line to a task list), converged on both peers.
  await body(pageA).click();
  await body(pageA).pressSequentially('finish report');
  await body(pageA).press('Enter');
  await body(pageA).pressSequentially('anchor text');
  await pageA.keyboard.press('Control+Home');
  await pageA.getByRole('button', { name: /task checklist/i }).click();
  await expect(pageA.locator(`${docBody} input[type="checkbox"]`)).toHaveCount(1);
  await expectConverged(pageA, pageB);

  // A goes offline and checks the task (a document mutation stored locally).
  await setOffline(ctxA, true);
  await expectStatus(pageA, /offline/i);
  await pageA.locator(`${docBody} input[type="checkbox"]`).first().check();
  await expect(pageA.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);

  // B (online) links the anchor line.
  await pageB.locator(`${docBody}`).click();
  await pageB.keyboard.press('Control+End');
  await pageB.keyboard.press('Shift+Home');
  await pageB.getByRole('button', { name: /insert link/i }).click();
  await pageB.getByLabel(/link url/i).fill('https://converge.example');
  await pageB.getByRole('button', { name: /apply/i }).click();
  await expect(pageB.locator(`${docBody} a`)).toHaveCount(1);

  // Reconnect → both the offline checkbox and the online link survive on both peers.
  await setOffline(ctxA, false);
  await expectStatus(pageA, /synced|syncing/i);
  await expectConverged(pageA, pageB);
  await expect(pageA.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);
  await expect(pageA.locator(`${docBody} a`)).toHaveCount(1);
  await expect(pageB.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});

test('Viewer sees the formatting but cannot modify it', async ({ browser, request }) => {
  const owner = uniqueUser('vo');
  const viewer = uniqueUser('vv');
  await registerUser(request, owner);
  await registerUser(request, viewer);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, viewer.email, 'viewer');

  // Owner creates a task list and checks the first item.
  await body(pageA).click();
  await body(pageA).pressSequentially('owner task');
  await pageA.getByRole('button', { name: /task checklist/i }).click();
  await pageA.locator(`${docBody} input[type="checkbox"]`).first().check();
  await expect(pageA.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);
  await expectStatus(pageA, /synced/i);

  // Viewer opens: sees the checked task, but every formatting control is disabled and
  // the document is not editable. Clicking the checkbox does NOT change its state.
  await loginUI(pageB, viewer);
  await pageB.goto(`/d/${docId}`);
  await expect(pageB.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'false');
  await expect(pageB.getByRole('button', { name: /strikethrough/i })).toBeDisabled();
  await expect(pageB.getByRole('button', { name: /inline code/i })).toBeDisabled();
  await expect(pageB.getByRole('button', { name: /blockquote/i })).toBeDisabled();
  await expect(pageB.getByRole('button', { name: /task checklist/i })).toBeDisabled();
  await expect(pageB.getByRole('button', { name: /insert link/i })).toBeDisabled();

  // The read-only checkbox change is reverted by the node view (stays checked).
  await pageB.locator(`${docBody} input[type="checkbox"]`).first().click();
  await expect(pageB.locator(`${docBody} li[data-checked="true"]`)).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});

test('Page-break compatibility: blockquote + pageBreak + paragraph survive reload', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('pbc');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('a quote block');
  await page.getByRole('button', { name: /blockquote/i }).click();
  await expect(page.locator(`${docBody} blockquote`)).toHaveCount(1);

  // Insert a page break at a clean collapsed caret at the end of the quote line.
  await page.keyboard.press('End');
  await body(page).press('Control+Enter');
  await body(page).pressSequentially('after the break');
  await expect(page.locator('[data-page-break]')).toHaveCount(1);

  await expectStatus(page, /synced/i);
  await page.waitForTimeout(800);
  await page.reload();

  await expect(page.locator(`${docBody} blockquote`)).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('[data-page-break]')).toHaveCount(1);
  await expect(page.locator('.scribe-page-gap')).toHaveCount(1);
  await expect(body(page)).toContainText('after the break');

  await ctx.close();
});
