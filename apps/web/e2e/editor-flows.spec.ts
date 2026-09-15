import { expect, test } from '@playwright/test';
import {
  body,
  createDocumentUI,
  expectStatus,
  loginUI,
  registerUser,
  uniqueUser,
} from './helpers.js';

/**
 * E2E for the document/template + A4 page product behavior (real Chromium):
 *   - New Document opens a creation dialog (Blank vs. system Template)
 *   - Blank creates + opens an EMPTY document (full A4 page, no copied content)
 *   - the document title lives in the header, not the editor body
 *   - "create from a system template" makes an INDEPENDENT document (template unchanged)
 *   - Ctrl+Enter inserts a page break that persists across reload
 *   - the editor renders full-height A4 sheets (empty & list-only pages don't collapse)
 */

test('New Document opens a dialog and does not create a document immediately', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('dlg');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);

  await page.getByRole('button', { name: 'New Document' }).first().click();
  // A dialog appears; we are NOT navigated to a document.
  await expect(page.getByRole('dialog', { name: 'New document' })).toBeVisible();
  expect(page.url()).not.toMatch(/\/d\//);

  // Choosing Blank creates and opens an EMPTY document (nothing copied), rendered on
  // a full A4 sheet.
  await page.getByRole('dialog', { name: 'New document' }).getByText('Blank document').click();
  await page.waitForURL(/\/d\/[0-9a-f-]{36}/);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toContainText('Core Objectives');
  // Exactly one full-height A4 backdrop sheet for an empty document.
  await expect(page.locator('.scribe-sheet')).toHaveCount(1);
  const emptyPageHeight = await page
    .locator('.scribe-sheet')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(emptyPageHeight).toBeGreaterThan(1000);

  await ctx.close();
});

test('the document title is in the header, not the editor body', async ({ browser, request }) => {
  const user = uniqueUser('title');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);

  // The title input is inside the header…
  const headerTitle = page.locator('header').getByLabel('Document title');
  await expect(headerTitle).toBeVisible();

  // …and NOT inside the document body/canvas.
  await expect(page.locator('.scribe-pages').getByLabel('Document title')).toHaveCount(0);

  // Renaming from the header persists.
  await headerTitle.fill('Renamed In Header');
  await headerTitle.blur();
  await page.reload();
  await expect(page.locator('header').getByLabel('Document title')).toHaveValue(
    'Renamed In Header',
  );

  await ctx.close();
});

test('the editor renders A4 sheets', async ({ browser, request }) => {
  const user = uniqueUser('a4');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);

  const sheet = page.locator('.scribe-page-sheet');
  await expect(sheet).toBeVisible();
  // The sheet column is A4 width (794px) at desktop widths.
  const boxWidth = await sheet.evaluate((el) => el.getBoundingClientRect().width);
  expect(boxWidth).toBeGreaterThan(700);
  // The white backdrop page is a full A4 sheet (one page for a short doc).
  const sheetHeight = await page
    .locator('.scribe-sheet')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(sheetHeight).toBeGreaterThan(1000);

  await ctx.close();
});

test('Ctrl+Enter inserts a page break that survives reload', async ({ browser, request }) => {
  const user = uniqueUser('brk');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).press('End');
  await body(page).pressSequentially(' BEFORE_BREAK');
  await body(page).press('Control+Enter');
  await body(page).pressSequentially('AFTER_BREAK');

  // The break is a real node in the document.
  await expect(page.locator('[data-page-break]')).toHaveCount(1);
  // Pagination renders it as a visual page gap.
  await expect(page.locator('.scribe-page-gap')).toHaveCount(1);

  await expectStatus(page, /synced/i);
  await page.reload();

  // The break persisted through the server round-trip.
  await expect(page.locator('[data-page-break]')).toHaveCount(1);
  await expect(body(page)).toContainText('AFTER_BREAK');

  await ctx.close();
});

test('the template picker shows only system templates, not the user’s documents', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('picker');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);

  // Give the user a distinctively-named document of their own.
  await createDocumentUI(page);
  await page.locator('header').getByLabel('Document title').fill('MY_PRIVATE_DOC');
  await page.locator('header').getByLabel('Document title').blur();
  await expectStatus(page, /synced/i);

  await page.goto('/');
  await page.getByRole('button', { name: 'New Document' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New document' });
  await expect(dialog).toBeVisible();

  // System templates are offered…
  await expect(dialog.getByText('Meeting Notes')).toBeVisible();
  // …the user's own document is NOT offered as a template.
  await expect(dialog.getByText('MY_PRIVATE_DOC')).toHaveCount(0);

  await ctx.close();
});

test('creating from a system template makes an independent document; template is unchanged', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('tpl');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);

  const openTemplate = async (): Promise<string> => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New Document' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New document' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Meeting Notes').click();
    await page.waitForURL(/\/d\/[0-9a-f-]{36}/);
    return page.url().match(/\/d\/([0-9a-f-]{36})/)![1]!;
  };

  // First document from the Meeting Notes template.
  const firstId = await openTemplate();
  await expect(body(page)).toContainText('Agenda');
  // Its title is the template's name (a new instance, not "Copy of …").
  await expect(page.locator('header').getByLabel('Document title')).toHaveValue('Meeting Notes');
  await expectStatus(page, /synced/i);

  // Edit the first document.
  await body(page).click();
  await body(page).press('End');
  await body(page).pressSequentially(' EDIT_ON_FIRST_ONLY');
  await expectStatus(page, /synced/i);

  // A second document from the SAME template is independent (different id, no edit).
  const secondId = await openTemplate();
  expect(secondId).not.toBe(firstId);
  await expect(body(page)).toContainText('Agenda');
  await expect(body(page)).not.toContainText('EDIT_ON_FIRST_ONLY');

  // The edit on the first document persists across reload (durable, independent).
  await page.goto(`/d/${firstId}`);
  await expect(body(page)).toContainText('EDIT_ON_FIRST_ONLY');

  await ctx.close();
});

test('Ctrl+Enter around a list starts a full-height A4 page (no collapse)', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('lst');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page); // empty blank document
  await expectStatus(page, /synced/i);

  // Page 1: a short bullet list.
  await body(page).click();
  await page.keyboard.type('Item one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Item two');
  // Turn the two paragraphs into a bullet list via the toolbar.
  await page.getByRole('button', { name: /bullet list/i }).click();

  // Manual page break, then a tiny bit of content on page 2.
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Item three');

  // Two logical pages → two full-height backdrop sheets, each a full A4.
  await expect(page.locator('.scribe-sheet')).toHaveCount(2);
  const heights = await page
    .locator('.scribe-sheet')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeGreaterThan(1000);

  await ctx.close();
});
