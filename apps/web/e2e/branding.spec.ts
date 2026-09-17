import { expect, test } from '@playwright/test';
import { closeDb } from './db.js';
import { createDocumentUI, expectStatus, loginUI, registerUser, uniqueUser } from './helpers.js';

/**
 * PRODUCT BRANDING — the user-facing product name is "ProDocs" (rebranded from
 * "Scribe"). Verifies the login screen, the application shell, and the browser tab
 * title all read ProDocs, and that no stray "Scribe" wordmark is visible to users.
 * Internal technical identifiers (package names, IndexedDB store names, CSS classes,
 * the DB, Docker services) are intentionally left as `scribe` and are not asserted
 * here — they are not user-facing.
 */

test.afterAll(async () => {
  await closeDb();
});

test('login screen is branded ProDocs (no Scribe wordmark)', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('ProDocs', { exact: true })).toBeVisible();
  // No user-visible "Scribe" text anywhere on the (login) auth screen.
  await expect(page.getByText(/scribe/i)).toHaveCount(0);

  // The sign-up variant's copy is also branded ProDocs.
  await page.getByRole('button', { name: /create.*account|sign up/i }).first().click();
  await expect(page.getByText('Start writing and collaborating in ProDocs.')).toBeVisible();
  await expect(page.getByText(/scribe/i)).toHaveCount(0);
});

test('application shell and browser title are branded ProDocs', async ({ browser, request }) => {
  const user = uniqueUser('brand');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);

  // Home: header wordmark + plain "ProDocs" tab title.
  await expect(page.getByRole('button', { name: 'ProDocs' })).toBeVisible();
  await expect(page).toHaveTitle('ProDocs');

  // Inside a document: "<title> - ProDocs".
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);
  await expect(page).toHaveTitle('Untitled document - ProDocs');

  await ctx.close();
});
