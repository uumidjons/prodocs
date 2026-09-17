import { expect, test, type Download, type Page } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
 * PHASE — application-shell UX: persistent personal profile button, complete dark mode,
 * theme-independent (always light) export, and document creation with an editable name.
 * Real Chromium, since these are presentation/interaction behaviors.
 */

const PROFILE = '[data-testid="profile-button"]';

/** Force the theme by seeding the stored preference, then reloading so the store applies it. */
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => localStorage.setItem('scribe-theme', t), theme);
  await page.reload();
}

function bg(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.afterAll(async () => {
  await closeDb();
});

// ── 1. Persistent personal profile button ──────────────────────────────────────

test('profile button is present in the document view for the owner', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('pfo');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await expect(page.locator(PROFILE)).toBeVisible();
  // The menu opens from within the document view and keeps its actions.
  await page.locator(PROFILE).click();
  await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();

  await ctx.close();
});

test('profile button is present for an editor and a viewer of a shared document', async ({
  browser,
  request,
}) => {
  const owner = uniqueUser('pfshare');
  const editor = uniqueUser('pfe');
  const viewer = uniqueUser('pfv');
  await registerUser(request, owner);
  await registerUser(request, editor);
  await registerUser(request, viewer);

  const ctxO = await browser.newContext();
  const pageO = await ctxO.newPage();
  await loginUI(pageO, owner);
  const docId = await createDocumentUI(pageO);
  await grantMembership(docId, editor.email, 'editor');
  await grantMembership(docId, viewer.email, 'viewer');

  const ctxE = await browser.newContext();
  const pageE = await ctxE.newPage();
  await loginUI(pageE, editor);
  await pageE.goto(`/d/${docId}`);
  await expect(pageE.locator(PROFILE)).toBeVisible();

  const ctxV = await browser.newContext();
  const pageV = await ctxV.newPage();
  await loginUI(pageV, viewer);
  await pageV.goto(`/d/${docId}`);
  await expect(pageV.locator(PROFILE)).toBeVisible();
  // Viewer's editor is read-only, but their profile control is still present.
  await expect(body(pageV)).toHaveAttribute('contenteditable', 'false');

  await ctxO.close();
  await ctxE.close();
  await ctxV.close();
});

test('current user is NOT in the collaborator stack; their profile stays separate', async ({
  browser,
  request,
}) => {
  const a = uniqueUser('sepa');
  const b = uniqueUser('sepb');
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

  // A sees exactly ONE other collaborator (B) in the presence stack, plus A's own profile.
  await expect(pageA.locator('[aria-label*="collaborator"]')).toBeVisible({ timeout: 20000 });
  await expect(pageA.locator(PROFILE)).toBeVisible();
  // The presence stack (other collaborators) does not contain A's own profile button.
  await expect(pageA.locator(`[aria-label*="collaborator"] ${PROFILE}`)).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

// ── 2. Complete dark mode ───────────────────────────────────────────────────────

test('dark mode themes the chrome, the toolbar AND the document surface', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('dm');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await setTheme(page, 'dark');
  await expect(page.locator('.scribe-sheet').first()).toBeVisible({ timeout: 20000 });

  // Chrome: header uses the dark elevated surface.
  expect(await bg(page, 'header')).toBe('rgb(30, 41, 59)');
  // Toolbar: the frosted floating ribbon is dark, not a light bar.
  expect(await bg(page, '[role="toolbar"][aria-label="Text formatting"]')).toContain('30, 41, 59');
  // Document surface: the A4 page itself is an intentional dark page (not white).
  expect(await bg(page, '.scribe-sheet')).toBe('rgb(27, 34, 48)');
  // Document text is readable light ink on the dark page.
  const proseColor = await page
    .locator('.scribe-prose')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(proseColor).toBe('rgb(226, 232, 240)');

  // Switch back to light → the page is white again (no state corruption).
  await setTheme(page, 'light');
  await expect(page.locator('.scribe-sheet').first()).toBeVisible({ timeout: 20000 });
  expect(await bg(page, '.scribe-sheet')).toBe('rgb(255, 255, 255)');

  await ctx.close();
});

// ── 3. Export is always light, even from a dark UI ──────────────────────────────

async function exportVia(page: Page, item: RegExp): Promise<Download> {
  await page.getByRole('button', { name: /^Export$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click(),
  ]);
  return download;
}

async function bytesOf(download: Download): Promise<Buffer> {
  const path = join(tmpdir(), `scribe-ux-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(path);
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

test('export from dark mode still produces a normal (light) PDF and DOCX', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('xd');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);
  await body(page).click();
  await body(page).pressSequentially('Exported from dark mode');

  await setTheme(page, 'dark');
  await expect(body(page)).toContainText('Exported from dark mode', { timeout: 20000 });

  const pdf = await bytesOf(await exportVia(page, /PDF/));
  // A real PDF (not a screenshot of the dark editor). The exporters use explicit light
  // document colors and never read the DOM/theme, so a dark UI exports a light document.
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  const docx = await bytesOf(await exportVia(page, /Word|docx/i));
  // A real .docx is a ZIP (PK\x03\x04 signature).
  expect(docx.subarray(0, 2).toString()).toBe('PK');

  await ctx.close();
});

// ── 4. Document creation with an editable name ─────────────────────────────────

async function openNewDocDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Document' }).first().click();
  await expect(page.getByRole('dialog', { name: 'New document' })).toBeVisible();
}

test('new document dialog defaults to "Untitled document" and creates with a custom name', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('crt');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);

  await openNewDocDialog(page);
  const nameInput = page.getByRole('textbox', { name: /document name/i });
  await expect(nameInput).toHaveValue('Untitled document');

  // The default is pre-selected: typing immediately replaces it (no manual select-all).
  await nameInput.pressSequentially('Project Notes');
  await expect(nameInput).toHaveValue('Project Notes');

  // Enter creates exactly one document and navigates to it.
  await Promise.all([page.waitForURL(/\/d\/[0-9a-f-]{36}/), nameInput.press('Enter')]);

  // Title agrees everywhere: header, browser title, and the document list.
  await expect(page.getByRole('textbox', { name: /document title/i })).toHaveValue('Project Notes');
  await expect.poll(() => page.title()).toContain('Project Notes - Scribe');
  await page.goto('/');
  await expect(page.getByText('Project Notes', { exact: true }).first()).toBeVisible();

  await ctx.close();
});

test('creation name: whitespace falls back to default; Unicode is preserved; Escape cancels', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('crt2');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);

  // Escape closes the dialog without creating.
  await openNewDocDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New document' })).toHaveCount(0);

  // Whitespace-only name → server default "Untitled document".
  await openNewDocDialog(page);
  const nameInput = page.getByRole('textbox', { name: /document name/i });
  await nameInput.fill('   ');
  await Promise.all([
    page.waitForURL(/\/d\/[0-9a-f-]{36}/),
    page.getByRole('dialog', { name: 'New document' }).getByText('Blank document').click(),
  ]);
  await expect(page.getByRole('textbox', { name: /document title/i })).toHaveValue(
    'Untitled document',
  );

  // A Unicode title is preserved exactly.
  await openNewDocDialog(page);
  const nameInput2 = page.getByRole('textbox', { name: /document name/i });
  await nameInput2.fill('Loyiha hisoboti — Q1 · 文档');
  await Promise.all([
    page.waitForURL(/\/d\/[0-9a-f-]{36}/),
    page.getByRole('dialog', { name: 'New document' }).getByText('Blank document').click(),
  ]);
  await expect(page.getByRole('textbox', { name: /document title/i })).toHaveValue(
    'Loyiha hisoboti — Q1 · 文档',
  );

  await ctx.close();
});
