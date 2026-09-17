import { type Page, expect, test } from '@playwright/test';
import { closeDb } from './db.js';
import {
  body,
  createDocumentUI,
  expectStatus,
  loginUI,
  registerUser,
  uniqueUser,
} from './helpers.js';

/**
 * PERMISSION REVOCATION / RE-GRANT — the authoritative collaboration boundary
 * (critical bug). Two DISTINCT users in two independent browser contexts, real
 * WebSocket, real IndexedDB, real Postgres.
 *
 * The bug this pins down: when an editor is demoted to viewer and later restored,
 * any LOCAL CRDT edits the client made while unauthorized (never accepted by the
 * server) must be DISCARDED — they must not resurrect when the editor role is
 * granted back. The fix treats the server's permission-change socket drop as a hard
 * boundary: the client rebuilds its session against a fresh Y.Doc after purging the
 * document's local persistence, so only authoritative server state can survive.
 */

async function openShare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('dialog', { name: 'Share document' })).toBeVisible();
}

async function addMemberUI(page: Page, email: string, role: 'Editor' | 'Viewer'): Promise<void> {
  await openShare(page);
  await page.getByLabel('Role for new member').selectOption(role);
  await page.getByLabel('Search users to add').fill(email);
  await page.getByRole('dialog').getByText(email).click();
  await expect(page.getByText(/now has access/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

/** Owner changes an existing member's role via the real Share UI (hits changeRole,
 *  which force-drops the member's live socket so the new role takes effect live). */
async function setRole(page: Page, displayName: string, role: 'Editor' | 'Viewer'): Promise<void> {
  await openShare(page);
  await page.getByLabel(new RegExp(`Role for ${displayName}`)).selectOption(role);
  await page.getByRole('button', { name: 'Done' }).click();
}

/** Force a LOCAL (unauthorized) edit into a client's editor/Y.Doc via the dev probe. */
async function injectLocalEdit(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    if (!window.__scribeConvergence?.injectLocalEdit) {
      throw new Error('convergence probe missing — is this a dev build?');
    }
    window.__scribeConvergence.injectLocalEdit(t);
  }, text);
}

test.afterAll(async () => {
  await closeDb();
});

test('editor→viewer→editor discards unauthorized local edits (no resurrection)', async ({
  browser,
  request,
}) => {
  const owner = uniqueUser('own');
  const collaborator = uniqueUser('col');
  await registerUser(request, owner);
  await registerUser(request, collaborator);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // A creates the document and shares it with B as an editor.
  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await expectStatus(pageA, /synced/i);
  await addMemberUI(pageA, collaborator.email, 'Editor');

  // B opens it and makes a LEGITIMATE edit that A sees.
  await loginUI(pageB, collaborator);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'true');
  await body(pageB).click();
  await body(pageB).press('End');
  await body(pageB).pressSequentially('LEGIT_B');
  await expect(body(pageA)).toContainText('LEGIT_B');

  // --- A demotes B to viewer (LIVE, no reload). B must go read-only immediately. ---
  await setRole(pageA, collaborator.displayName, 'Viewer');
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'false', { timeout: 20000 });
  // Content is still readable.
  await expect(body(pageB)).toContainText('LEGIT_B');
  // Let the read-only session fully settle (reset + resync) before injecting.
  await pageB.waitForTimeout(800);

  // --- B acquires an UNAUTHORIZED local edit while a viewer. ---
  await injectLocalEdit(pageB, 'GHOST_FROM_B');
  // It exists LOCALLY on B (proving the resurrection check below is meaningful)…
  await expect(body(pageB)).toContainText('GHOST_FROM_B');
  // …but the server rejects it, so A never sees it.
  await pageA.waitForTimeout(1500);
  await expect(body(pageA)).not.toContainText('GHOST_FROM_B');

  // --- A restores B to editor (LIVE). ---
  await setRole(pageA, collaborator.displayName, 'Editor');
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'true', { timeout: 20000 });

  // CRITICAL: the unauthorized text must NOT resurrect for anyone.
  await pageA.waitForTimeout(1500);
  await expect(body(pageA)).not.toContainText('GHOST_FROM_B');
  await expect(body(pageB)).not.toContainText('GHOST_FROM_B');
  // Legitimate authoritative content is intact.
  await expect(body(pageB)).toContainText('LEGIT_B');

  // --- B can make a NEW legitimate edit that A receives. ---
  await body(pageB).click();
  await body(pageB).press('End');
  await body(pageB).pressSequentially(' NEW_LEGIT_B');
  await expect(body(pageA)).toContainText('NEW_LEGIT_B');

  // --- Reload both: only authoritative content survives. ---
  await pageA.reload();
  await pageB.reload();
  await expect(body(pageA)).toContainText('LEGIT_B', { timeout: 20000 });
  await expect(body(pageA)).toContainText('NEW_LEGIT_B');
  await expect(body(pageA)).not.toContainText('GHOST_FROM_B');
  await expect(body(pageB)).not.toContainText('GHOST_FROM_B');
  // B is still an editor after reload (role persisted, no stale viewer state).
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'true');

  await ctxA.close();
  await ctxB.close();
});

test('demote → reload keeps viewer read-only with no injected ghost state', async ({
  browser,
  request,
}) => {
  const owner = uniqueUser('own2');
  const collaborator = uniqueUser('col2');
  await registerUser(request, owner);
  await registerUser(request, collaborator);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await expectStatus(pageA, /synced/i);
  await body(pageA).click();
  await body(pageA).pressSequentially('OWNER_SEED');
  await addMemberUI(pageA, collaborator.email, 'Editor');

  await loginUI(pageB, collaborator);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageB, /synced/i);
  await expect(body(pageB)).toContainText('OWNER_SEED');

  // Demote live, inject an unauthorized edit, then RELOAD B.
  await setRole(pageA, collaborator.displayName, 'Viewer');
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'false', { timeout: 20000 });
  await pageB.waitForTimeout(800);
  await injectLocalEdit(pageB, 'GHOST_RELOAD');
  await expect(body(pageB)).toContainText('GHOST_RELOAD');

  await pageB.reload();
  // After reload B is still a viewer (read-only) and the ghost is gone (purged local
  // persistence + authoritative resync — it was never accepted by the server).
  await expect(body(pageB)).toHaveAttribute('contenteditable', 'false', { timeout: 20000 });
  await expect(body(pageB)).toContainText('OWNER_SEED');
  await expect(body(pageB)).not.toContainText('GHOST_RELOAD');
  await expect(body(pageA)).not.toContainText('GHOST_RELOAD');

  await ctxA.close();
  await ctxB.close();
});
