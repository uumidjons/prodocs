import { type APIRequestContext, expect, test } from '@playwright/test';
import { collaborationColor } from '@scribe/shared';
import { closeDb, grantMembership } from './db.js';
import { body, createDocumentUI, expectStatus, loginUI, uniqueUser } from './helpers.js';

/**
 * PHASE 7 — collaborative presence UI (real Chromium, two browser contexts). Proves
 * the user-visible presence experience: each remote collaborator has a stable,
 * distinct collaboration color; their caret, name flag, and selection all use it;
 * and stale presence disappears on disconnect. Positions come from Yjs awareness
 * (unchanged); this asserts the rendering only.
 */

interface CollabUser {
  email: string;
  password: string;
  displayName: string;
  id: string;
  color: string;
}

/** Register a user via the API and capture their id + deterministic collab color. */
async function register(request: APIRequestContext, prefix: string): Promise<CollabUser> {
  const u = uniqueUser(prefix);
  const res = await request.post('/api/auth/register', {
    data: { email: u.email, password: u.password, displayName: u.displayName },
  });
  expect(res.ok(), `register ${u.email}: ${res.status()}`).toBeTruthy();
  const id = (res.json ? await res.json() : JSON.parse(await res.text())).user.id as string;
  return { ...u, id, color: collaborationColor(id) };
}

/** Two users whose collaboration colors differ (so the test can prove distinctness). */
async function twoDistinctUsers(request: APIRequestContext): Promise<[CollabUser, CollabUser]> {
  const a = await register(request, 'presence-a');
  let b = await register(request, 'presence-b');
  for (let i = 0; i < 8 && b.color === a.color; i += 1) b = await register(request, 'presence-b');
  expect(b.color).not.toBe(a.color);
  return [a, b];
}

const styleOf = (loc: ReturnType<typeof body>) =>
  loc.evaluate((el) => el.getAttribute('style') ?? '');

/** #RRGGBB → "rgb(r, g, b)" so we can match colors the browser normalizes in inline styles. */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** #RRGGBB + alpha byte → "rgba(r, g, b, a)" (browsers normalize `#rrggbbaa` inline). */
function hexToRgba(hex: string, alphaByte: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.round((alphaByte / 255) * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Assert a style string references a color, tolerating hex OR normalized rgb/rgba. */
function styleHasColor(style: string, hex: string): boolean {
  const s = style.toLowerCase();
  return s.includes(hex.toLowerCase()) || s.includes(hexToRgb(hex).toLowerCase());
}

test.afterAll(async () => {
  await closeDb();
});

test('Scenario A: a collaborator sees a remote colored caret + name label', async ({
  browser,
  request,
}) => {
  const [userA, userB] = await twoDistinctUsers(request);

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

  // A edits; B sees it (proves the shared session is live).
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' HELLO_FROM_A');
  await expect(body(pageB)).toContainText('HELLO_FROM_A');

  // B now sees A's remote caret and a name flag labeled with A's display name…
  const aCaretOnB = pageB.locator('.collaboration-cursor__caret').first();
  await expect(aCaretOnB).toBeVisible();
  const aLabelOnB = pageB.locator('.collaboration-cursor__label', { hasText: userA.displayName });
  await expect(aLabelOnB).toBeVisible();

  // …in A's collaboration color (caret + label both).
  const caretStyle = await styleOf(aCaretOnB);
  const labelStyle = await styleOf(aLabelOnB.first());
  expect(styleHasColor(caretStyle, userA.color)).toBe(true);
  expect(styleHasColor(labelStyle, userA.color)).toBe(true);

  await ctxA.close();
  await ctxB.close();
});

test('Scenario B: two collaborators show selections in their own distinct colors', async ({
  browser,
  request,
}) => {
  const [userA, userB] = await twoDistinctUsers(request);

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

  // Seed a line of text to select (a blank document opens empty). It syncs to B so
  // both peers share the same content before we exchange selections.
  await body(pageA).click();
  await body(pageA).pressSequentially('Selection line one');
  await pageA.keyboard.press('Enter');
  await body(pageA).pressSequentially('Selection line two');
  await expect(pageB.locator('[aria-label="Document body"]')).toContainText('Selection line one', {
    timeout: 20000,
  });

  // A selects the first line; B should see a remote selection in A's color.
  await body(pageA).click();
  await pageA.keyboard.press('Control+Home');
  await pageA.keyboard.press('Shift+End');
  const aSelOnB = pageB.locator('.collaboration-selection').first();
  await expect(aSelOnB).toBeVisible();
  const aSelStyle = await styleOf(aSelOnB);
  // Solid underline in A's color + a translucent (14%) wash so text stays readable.
  expect(styleHasColor(aSelStyle, userA.color)).toBe(true);
  expect(aSelStyle.toLowerCase()).toContain(hexToRgba(userA.color, 0x24).toLowerCase());

  // B selects a different (last) line; A sees B's selection in B's (different) color.
  await body(pageB).click();
  await pageB.keyboard.press('Control+End');
  await pageB.keyboard.press('Shift+Home');
  const bSelOnA = pageA.locator('.collaboration-selection').first();
  await expect(bSelOnA).toBeVisible();
  const bSelStyle = await styleOf(bSelOnA);
  expect(styleHasColor(bSelStyle, userB.color)).toBe(true);
  expect(userA.color.toLowerCase()).not.toBe(userB.color.toLowerCase());

  await ctxA.close();
  await ctxB.close();
});

test('Scenario E: stale presence disappears when a collaborator disconnects', async ({
  browser,
  request,
}) => {
  const [userA, userB] = await twoDistinctUsers(request);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, userB.email, 'editor');
  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);

  // A focuses so B renders A's caret/label.
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' X');
  const aLabelOnB = pageB.locator('.collaboration-cursor__label', { hasText: userA.displayName });
  await expect(aLabelOnB).toBeVisible();

  // A disconnects → awareness is removed → A's presence chrome disappears on B.
  await ctxA.close();
  await expect(aLabelOnB).toHaveCount(0);
  await expect(pageB.locator('.collaboration-cursor__caret')).toHaveCount(0);

  await ctxB.close();
});

test('Scenario D: remote presence renders across an A4 page break', async ({
  browser,
  request,
}) => {
  const [userA, userB] = await twoDistinctUsers(request);

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

  // A inserts a manual page break and types on the second page.
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).press('Control+Enter');
  await body(pageA).pressSequentially('SECOND_PAGE_LINE');
  await expect(body(pageB)).toContainText('SECOND_PAGE_LINE');
  // The page break is present for both, and A's caret renders (on the 2nd page).
  await expect(pageB.locator('[data-page-break]')).toHaveCount(1);
  await expect(
    pageB.locator('.collaboration-cursor__label', { hasText: userA.displayName }),
  ).toBeVisible();
  // Presence chrome must not create extra pages / gaps.
  await expect(pageB.locator('.scribe-page-gap')).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});
