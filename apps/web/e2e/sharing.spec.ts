import { type Page, expect, test } from '@playwright/test';
import {
  body,
  createDocumentUI,
  expectStatus,
  loginUI,
  registerUser,
  uniqueUser,
} from './helpers.js';

/**
 * PHASE 5 end-to-end sharing + collaboration flow (§13). Real browsers, real
 * WebSocket, real Postgres — and the REAL Share UI (no direct DB seeding): User A
 * shares a document with User B through the dialog, they collaborate live, then A
 * changes B's role and finally removes B. Two DISTINCT users in two independent
 * browser contexts, exactly as in the offline suite.
 *
 * Revocation semantics (documented in security.md): a role/access change takes
 * effect for B on the next document (re)connect — B reloads to pick it up, which is
 * the current single-instance MVP behavior (existing live sockets are not
 * force-closed).
 */

/** Open the Share dialog from the header (visible only when a document is open). */
async function openShare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('dialog', { name: 'Share document' })).toBeVisible();
}

/** As the owner, add a registered user by email with the given role via the dialog. */
async function addMemberUI(page: Page, email: string, role: 'Editor' | 'Viewer'): Promise<void> {
  await openShare(page);
  await page.getByLabel('Role for new member').selectOption(role);
  await page.getByLabel('Search users to add').fill(email);
  // The search result row is a button showing the user's email.
  await page.getByRole('dialog').getByText(email).click();
  await expect(page.getByText(/now has access/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('full sharing flow: share → collaborate → change role → remove', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('a');
  const userB = uniqueUser('b');
  await registerUser(request, userA);
  await registerUser(request, userB);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // --- A creates a document and shares it with B as Editor via the UI ---
  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await expectStatus(pageA, /synced/i);

  await addMemberUI(pageA, userB.email, 'Editor');

  // --- B sees the shared document on the dashboard and opens it ---
  await loginUI(pageB, userB);
  await pageB.goto('/');
  await expect(pageB.getByText('Shared with me')).toBeVisible();
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);

  // --- Live collaboration both ways ---
  await body(pageB).click();
  await body(pageB).press('End');
  await body(pageB).pressSequentially(' EDIT_FROM_B');
  await expect(body(pageA)).toContainText('EDIT_FROM_B');

  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' EDIT_FROM_A');
  await expect(body(pageB)).toContainText('EDIT_FROM_A');

  // --- A downgrades B to Viewer ---
  await openShare(pageA);
  await pageA.getByLabel(new RegExp(`Role for ${userB.displayName}`)).selectOption('Viewer');
  await pageA.getByRole('button', { name: 'Done' }).click();

  // B reloads to pick up the new role (revocation-on-reconnect semantics).
  await pageB.reload();
  await expectStatus(pageB, /synced/i);
  // B can still READ the content…
  await expect(body(pageB)).toContainText('EDIT_FROM_A');
  // …but the editor is now read-only, and the role badge reflects viewer.
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'false');
  await expect(pageB.getByText('viewer', { exact: true })).toBeVisible();

  // --- A removes B entirely ---
  await openShare(pageA);
  await pageA.getByLabel(`Remove ${userB.displayName}`).click();
  // The member list no longer shows B.
  await expect(pageA.getByRole('dialog').getByText(userB.email)).toHaveCount(0);
  await pageA.getByRole('button', { name: 'Done' }).click();

  // --- A fresh B session can no longer access the document ---
  const ctxB2 = await browser.newContext();
  const pageB2 = await ctxB2.newPage();
  await loginUI(pageB2, userB);
  await pageB2.goto(`/d/${docId}`);
  await expect(pageB2.getByText('Document unavailable')).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxB2.close();
});

test('editor cannot manage sharing; viewer sees a read-only roster', async ({
  browser,
  request,
}) => {
  const owner = uniqueUser('owner');
  const editor = uniqueUser('editor');
  await registerUser(request, owner);
  await registerUser(request, editor);

  const ctxO = await browser.newContext();
  const ctxE = await browser.newContext();
  const pageO = await ctxO.newPage();
  const pageE = await ctxE.newPage();

  await loginUI(pageO, owner);
  const docId = await createDocumentUI(pageO);
  await addMemberUI(pageO, editor.email, 'Editor');

  await loginUI(pageE, editor);
  await pageE.goto(`/d/${docId}`);
  await expectStatus(pageE, /synced/i);

  // The editor can open Share and see the roster, but has no management controls.
  await openShare(pageE);
  await expect(pageE.getByText('Only the owner can manage sharing.')).toBeVisible();
  await expect(pageE.getByLabel('Search users to add')).toHaveCount(0);
  await expect(pageE.getByLabel(new RegExp(`Role for ${owner.displayName}`))).toHaveCount(0);

  await ctxO.close();
  await ctxE.close();
});
