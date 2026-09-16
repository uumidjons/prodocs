import { type Page, expect, test } from '@playwright/test';
import {
  body,
  createDocumentUI,
  editorText,
  expectConverged,
  expectStatus,
  loginUI,
  registerUser,
  setOffline,
  uniqueUser,
} from './helpers.js';

/**
 * Regression E2E for the reported page-break interaction bug (the "giant blue
 * rectangle"). Real Chromium, real WebSocket + Yjs + Postgres.
 *
 * Before the fix: clicking the empty new page — or Backspacing into the break —
 * produced a page-sized `.ProseMirror-selectednode` NodeSelection, and the break
 * needed a select-then-delete to remove. After the fix the break is not selectable:
 * clicks give a normal text cursor, and one Backspace/Delete removes it.
 */

const selectedNode = (page: Page) => page.locator('.ProseMirror .ProseMirror-selectednode');

test('clicking the empty new page never selects a giant node; one Backspace removes the break', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('pgbreak');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  // Create the second page.
  await body(page).click();
  await body(page).press('End');
  await body(page).press('Control+Enter');
  await expect(page.locator('[data-page-break]')).toHaveCount(1);
  await expect(page.locator('.scribe-sheet')).toHaveCount(2);

  // Click the top, middle, and bottom of the large empty page area. None may produce
  // a NodeSelection (the reported giant blue rectangle).
  const gap = await page.locator('[data-page-break]').boundingBox();
  expect(gap).not.toBeNull();
  for (const frac of [0.05, 0.5, 0.95]) {
    await page.mouse.click(gap!.x + gap!.width / 2, gap!.y + gap!.height * frac);
    await expect(selectedNode(page)).toHaveCount(0);
  }

  // The paragraph on the new page is a normal editable paragraph: typing works.
  await body(page).press('Control+End');
  await body(page).pressSequentially('Second page');
  await expect(body(page)).toContainText('Second page');

  // Put the caret at the very START of that paragraph: triple-click selects the whole
  // paragraph (click-to-position must resolve to a normal text selection, never a
  // giant NodeSelection), then ArrowLeft collapses to offset 0. One Backspace removes
  // the break.
  const secondPara = page.locator('.scribe-prose p', { hasText: 'Second page' });
  await secondPara.click({ clickCount: 3 });
  await expect(selectedNode(page)).toHaveCount(0);
  await body(page).press('ArrowLeft');
  await body(page).press('Backspace');

  // The break is gone in a single press — no giant selection was ever needed.
  await expect(page.locator('[data-page-break]')).toHaveCount(0);
  await expect(page.locator('.scribe-sheet')).toHaveCount(1);
  await expect(selectedNode(page)).toHaveCount(0);
  // The content survived and the editor is still usable.
  await expect(body(page)).toContainText('Second page');
  await body(page).press('Control+End');
  await body(page).pressSequentially(' MORE');
  await expect(body(page)).toContainText('Second page MORE');

  await ctx.close();
});

test('Backspace from the empty new page removes the break without typing first', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('pgempty');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).press('End');
  await body(page).press('Control+Enter');
  await expect(page.locator('[data-page-break]')).toHaveCount(1);

  // Caret is already in the empty paragraph after the break. One Backspace removes it,
  // with no giant selection appearing at any point.
  await body(page).press('Backspace');
  await expect(page.locator('[data-page-break]')).toHaveCount(0);
  await expect(selectedNode(page)).toHaveCount(0);

  await ctx.close();
});

test('page-break create/remove converges across two collaborators', async ({ browser, request }) => {
  const userA = uniqueUser('pgA');
  const userB = uniqueUser('pgB');
  await registerUser(request, userA);
  await registerUser(request, userB);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await expectStatus(pageA, /synced/i);
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially('Shared');

  // Share with B as editor.
  await pageA.getByRole('button', { name: 'Share' }).click();
  await pageA.getByLabel('Role for new member').selectOption('Editor');
  await pageA.getByLabel('Search users to add').fill(userB.email);
  await pageA.getByRole('dialog').getByText(userB.email).click();
  await expect(pageA.getByText(/now has access/i)).toBeVisible();
  await pageA.getByRole('button', { name: 'Done' }).click();

  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);

  // A inserts a page break; B sees it.
  await body(pageA).press('Control+End');
  await body(pageA).press('Control+Enter');
  await expect(pageB.locator('[data-page-break]')).toHaveCount(1);

  // A removes it via Backspace; B sees it disappear.
  await body(pageA).press('Control+End');
  await body(pageA).press('Backspace');
  await expect(pageA.locator('[data-page-break]')).toHaveCount(0);
  await expect(pageB.locator('[data-page-break]')).toHaveCount(0);

  // B inserts one; A sees it. No divergence.
  await body(pageB).press('Control+End');
  await body(pageB).press('Control+Enter');
  await expect(pageA.locator('[data-page-break]')).toHaveCount(1);
  await expectConverged(pageA, pageB);

  await ctxA.close();
  await ctxB.close();
});

test('page break created and removed offline converges on reconnect', async ({ browser, request }) => {
  const userA = uniqueUser('pgoffA');
  const userB = uniqueUser('pgoffB');
  await registerUser(request, userA);
  await registerUser(request, userB);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await expectStatus(pageA, /synced/i);
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially('Base');

  await pageA.getByRole('button', { name: 'Share' }).click();
  await pageA.getByLabel('Role for new member').selectOption('Editor');
  await pageA.getByLabel('Search users to add').fill(userB.email);
  await pageA.getByRole('dialog').getByText(userB.email).click();
  await expect(pageA.getByText(/now has access/i)).toBeVisible();
  await pageA.getByRole('button', { name: 'Done' }).click();

  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);

  // B goes offline and inserts a break, typing on the new page (editing offline).
  await setOffline(ctxB, true);
  await expectStatus(pageB, /offline/i);
  await body(pageB).press('Control+End');
  await body(pageB).press('Control+Enter');
  await body(pageB).pressSequentially('Offline page');
  await expect(pageB.locator('[data-page-break]')).toHaveCount(1);

  // Still offline, B inserts a SECOND break and removes it again with one Backspace.
  // The caret is at the start of the freshly created empty paragraph by construction,
  // so this is deterministic and needs no giant selection.
  await body(pageB).press('Control+Enter');
  await expect(pageB.locator('[data-page-break]')).toHaveCount(2);
  await body(pageB).press('Backspace');
  await expect(pageB.locator('[data-page-break]')).toHaveCount(1);

  // Reconnect → both peers converge: the one remaining break and the offline text
  // survive with no divergence.
  await setOffline(ctxB, false);
  await expectStatus(pageB, /synced/i);
  await expectConverged(pageA, pageB);
  await expect(pageA.locator('[data-page-break]')).toHaveCount(1);
  expect(await editorText(pageA)).toContain('Offline page');

  await ctxA.close();
  await ctxB.close();
});
