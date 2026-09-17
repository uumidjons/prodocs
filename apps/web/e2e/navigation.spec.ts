import { expect, test } from '@playwright/test';
import { createDocumentUI, loginUI, registerUser, uniqueUser } from './helpers.js';

/**
 * Sidebar navigation, Recent, Templates, Trash, Settings/theme, the profile dropdown,
 * and the browser tab title — the Phase 11 workflow (task §15). Everything runs in a
 * single fresh user context against the real stack; it only adds data (never resets).
 */
test('documents, recent, templates, trash, theme, profile, and tab title', async ({
  page,
  request,
}) => {
  const user = uniqueUser('nav');
  await registerUser(request, user);
  await loginUI(page, user);

  // --- Create a blank document; it appears in Documents. ---
  await createDocumentUI(page);
  await expect(page).toHaveTitle('Untitled document - ProDocs');

  // Rename the document; the browser tab title follows the live title.
  const title = page.getByLabel('Document title');
  await title.click();
  await title.fill('Quarterly Plan');
  await title.press('Enter');
  await expect(page).toHaveTitle('Quarterly Plan - ProDocs');

  // Back to Documents — the tab title returns to the app name and the doc is listed.
  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('ProDocs');
  await expect(page.getByText('Quarterly Plan')).toBeVisible();

  // --- Recent: the opened document is present. ---
  await page.getByRole('link', { name: 'Recent' }).click();
  await expect(page).toHaveURL(/\/recent$/);
  await expect(page.getByText('Quarterly Plan')).toBeVisible();

  // --- Templates: only system templates, and creating one lands in Documents. ---
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole('heading', { name: 'Meeting Notes' })).toBeVisible();
  await expect(page.getByText('Quarterly Plan')).toHaveCount(0); // no user docs here

  await page
    .locator('li', { hasText: 'Meeting Notes' })
    .getByRole('button', { name: /Use template/ })
    .click();
  await page.waitForURL(/\/d\/[0-9a-f-]{36}/);
  await expect(page).toHaveTitle('Meeting Notes - ProDocs');

  // The template instance is a normal document (Documents), never a template.
  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByText('Meeting Notes')).toBeVisible();
  await page.getByRole('link', { name: 'Templates' }).click();
  // Only the system "Meeting Notes" heading exists (the created doc is not here).
  await expect(page.getByRole('heading', { name: 'Meeting Notes' })).toHaveCount(1);

  // --- Trash: move an owned document to Trash, then restore it. ---
  await page.getByRole('link', { name: 'Documents' }).click();
  const planCard = page.locator('li', { hasText: 'Quarterly Plan' });
  await planCard.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByText('Quarterly Plan')).toHaveCount(0); // gone from Documents

  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(page.getByText('Quarterly Plan')).toBeVisible();
  await page
    .locator('li', { hasText: 'Quarterly Plan' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.getByText('Quarterly Plan')).toHaveCount(0); // gone from Trash

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByText('Quarterly Plan')).toBeVisible(); // back in Documents

  // --- Settings: switch to Dark and confirm it persists across reload. ---
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('radio', { name: /Dark/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Reset to Light so the shared dev environment isn't left dark for the next run.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: /Light/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // --- Profile dropdown: closes on outside click and on Escape. ---
  const avatar = page.getByRole('button', { name: user.displayName });
  await avatar.click();
  await expect(page.getByText('Sign out')).toBeVisible();
  await page.mouse.click(5, 400); // click well outside the menu
  await expect(page.getByText('Sign out')).toHaveCount(0);

  await avatar.click();
  await expect(page.getByText('Sign out')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Sign out')).toHaveCount(0);
});
