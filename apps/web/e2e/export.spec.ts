import { type Download, type Page, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  body,
  createDocumentUI,
  expectStatus,
  loginUI,
  registerUser,
  uniqueUser,
} from './helpers.js';

/**
 * E2E for document export (real Chromium, real WebSocket + Postgres, real browser
 * downloads). Proves the user workflow end to end: a formatted, multi-page document
 * exports to a real PDF and a real .docx named from the title, viewers can export,
 * export never disturbs live collaboration, and export works offline from local state.
 */

/** Rename the open document from the header and wait for the change to stick. */
async function rename(page: Page, title: string): Promise<void> {
  const input = page.locator('header').getByLabel('Document title');
  await input.click();
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveValue(title);
}

/** Type a small formatted document: a heading, bold/italic text, and a bullet. */
async function typeFormatted(page: Page): Promise<void> {
  await body(page).click();
  await body(page).press('End');
  await body(page).pressSequentially('Intro paragraph. ');
  await page.getByRole('button', { name: /Bold/ }).click();
  await body(page).pressSequentially('bold bit');
  await page.getByRole('button', { name: /Bold/ }).click();
}

/** Click Export → the given item and capture the resulting browser download. */
async function exportVia(page: Page, item: RegExp): Promise<Download> {
  await page.getByRole('button', { name: /^Export$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click(),
  ]);
  return download;
}

/** Save the download to a temp file and return its bytes. */
async function bytesOf(download: Download): Promise<Buffer> {
  const path = join(tmpdir(), `scribe-e2e-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(path);
  return readFile(path);
}

test('Scenario A — export a formatted, multi-page document to PDF', async ({ browser, request }) => {
  const user = uniqueUser('pdf');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await rename(page, 'Meeting Notes');
  await typeFormatted(page);
  // A manual page break → a real second PDF page.
  await body(page).press('End');
  await body(page).press('Control+Enter');
  await body(page).pressSequentially('Second page content');
  await expect(page.locator('[data-page-break]')).toHaveCount(1);

  const download = await exportVia(page, /PDF/);
  expect(download.suggestedFilename()).toBe('Meeting Notes.pdf');
  const bytes = await bytesOf(download);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  // The manual page break produces a real second PDF page.
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);

  await ctx.close();
});

test('Scenario B — export to Word (.docx)', async ({ browser, request }) => {
  const user = uniqueUser('docx');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await rename(page, 'Quarterly Report');
  await typeFormatted(page);

  const download = await exportVia(page, /Word/);
  expect(download.suggestedFilename()).toBe('Quarterly Report.docx');
  const bytes = await bytesOf(download);
  // A .docx is a ZIP (PK\x03\x04) that contains the Word main document part.
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(bytes.toString('latin1')).toContain('word/document.xml');

  await ctx.close();
});

test('Scenario C — a viewer can export a shared document', async ({ browser, request }) => {
  const owner = uniqueUser('owner');
  const viewer = uniqueUser('viewer');
  await registerUser(request, owner);
  await registerUser(request, viewer);

  const ctxO = await browser.newContext();
  const ctxV = await browser.newContext();
  const pageO = await ctxO.newPage();
  const pageV = await ctxV.newPage();

  await loginUI(pageO, owner);
  const docId = await createDocumentUI(pageO);
  await expectStatus(pageO, /synced/i);
  await rename(pageO, 'Shared Doc');
  await body(pageO).click();
  await body(pageO).press('End');
  await body(pageO).pressSequentially('Owner content');

  // Share with the viewer via the real Share dialog.
  await pageO.getByRole('button', { name: 'Share' }).click();
  await pageO.getByLabel('Role for new member').selectOption('Viewer');
  await pageO.getByLabel('Search users to add').fill(viewer.email);
  await pageO.getByRole('dialog').getByText(viewer.email).click();
  await expect(pageO.getByText(/now has access/i)).toBeVisible();
  await pageO.getByRole('button', { name: 'Done' }).click();

  // The viewer opens the document read-only and exports it.
  await loginUI(pageV, viewer);
  await pageV.goto(`/d/${docId}`);
  await expectStatus(pageV, /synced/i);
  await expect(body(pageV)).toContainText('Owner content');

  const download = await exportVia(pageV, /PDF/);
  expect(download.suggestedFilename()).toBe('Shared Doc.pdf');
  expect((await bytesOf(download)).subarray(0, 5).toString()).toBe('%PDF-');

  await ctxO.close();
  await ctxV.close();
});

test('Scenario D — exporting does not disturb live collaboration', async ({ browser, request }) => {
  const userA = uniqueUser('collabA');
  const userB = uniqueUser('collabB');
  await registerUser(request, userA);
  await registerUser(request, userB);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await expectStatus(pageA, /synced/i);
  await rename(pageA, 'Live Doc');

  // Share with B as editor and have B open it.
  await pageA.getByRole('button', { name: 'Share' }).click();
  await pageA.getByLabel('Role for new member').selectOption('Editor');
  await pageA.getByLabel('Search users to add').fill(userB.email);
  await pageA.getByRole('dialog').getByText(userB.email).click();
  await expect(pageA.getByText(/now has access/i)).toBeVisible();
  await pageA.getByRole('button', { name: 'Done' }).click();

  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);

  // B edits; A exports at the same time.
  await body(pageB).click();
  await body(pageB).press('End');
  await body(pageB).pressSequentially('EDIT_FROM_B');
  await expect(body(pageA)).toContainText('EDIT_FROM_B');

  const download = await exportVia(pageA, /PDF/);
  expect(download.suggestedFilename()).toBe('Live Doc.pdf');
  expect((await bytesOf(download)).subarray(0, 5).toString()).toBe('%PDF-');

  // Collaboration is still live after the export: A's edit reaches B, B's the reverse.
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially('EDIT_FROM_A_AFTER_EXPORT');
  await expect(body(pageB)).toContainText('EDIT_FROM_A_AFTER_EXPORT');
  await expectStatus(pageA, /synced/i);
  await expectStatus(pageB, /synced/i);

  await ctxA.close();
  await ctxB.close();
});

test('Scenario E — export works offline from local state', async ({ browser, request }) => {
  const user = uniqueUser('offline');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);
  await rename(page, 'Offline Doc');
  await body(page).click();
  await body(page).press('End');
  await body(page).pressSequentially('Local content');

  // Go fully offline at the network layer, then export from the local Yjs state.
  await ctx.setOffline(true);
  await expectStatus(page, /offline/i);

  const download = await exportVia(page, /PDF/);
  expect(download.suggestedFilename()).toBe('Offline Doc.pdf');
  expect((await bytesOf(download)).subarray(0, 5).toString()).toBe('%PDF-');

  await ctx.setOffline(false);
  await ctx.close();
});
