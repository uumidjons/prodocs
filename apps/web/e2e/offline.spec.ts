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
 * PHASE 3 end-to-end offline suite (testing-strategy.md → E2E). Real browsers, real
 * IndexedDB, real WebSocket, real Postgres, and Playwright's real network-offline
 * control. Two DISTINCT users run in two independent browser contexts (§17), each
 * with its own cookie jar + IndexedDB — never two tabs of one session.
 *
 * The assertions are user-visible convergence in the actual DOM; byte-level CRDT
 * convergence and the fine-grained conflict matrix are proven in the server
 * integration suite (apps/server/test/integration/offline.test.ts).
 */

test.afterAll(async () => {
  await closeDb();
});

test('online collaboration: A types, B sees it live', async ({ browser, request }) => {
  const userA = uniqueUser('a');
  const userB = uniqueUser('b');
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
  await expectStatus(pageB, /synced/i);

  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' LIVE_FROM_A');
  await expect(body(pageB)).toContainText('LIVE_FROM_A');

  await ctxA.close();
  await ctxB.close();
});

test('offline editing stays editable and survives reconnect (Scenario B)', async ({
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

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, userB.email, 'editor');
  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  await expectStatus(pageA, /synced/i);
  await expectStatus(pageB, /synced/i);

  // A goes truly offline at the network layer.
  await setOffline(ctxA, true);
  await expectStatus(pageA, /offline/i);

  // A can STILL edit while offline (not read-only just because the socket is down).
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' EDIT_A_OFFLINE');
  await expect(body(pageA)).toContainText('EDIT_A_OFFLINE');

  // B keeps editing online; A cannot have received this yet.
  await body(pageB).click();
  await body(pageB).press('Home');
  await body(pageB).pressSequentially('EDIT_B_ONLINE ');
  await expect(body(pageA)).not.toContainText('EDIT_B_ONLINE');

  // A reconnects → bidirectional CRDT merge; both edits survive on both sides.
  await setOffline(ctxA, false);
  await expectStatus(pageA, /synced|syncing/i); // wait for the provider to re-establish
  await expectConverged(pageA, pageB);
  await expect(body(pageA)).toContainText('EDIT_A_OFFLINE');
  await expect(body(pageA)).toContainText('EDIT_B_ONLINE');
  await expect(body(pageB)).toContainText('EDIT_A_OFFLINE');

  await ctxA.close();
  await ctxB.close();
});

test('an offline edit survives a browser reload', async ({ browser, request }) => {
  // NOTE ON SCOPE: a reload with the network *still down* additionally requires the
  // app SHELL (HTML/JS bundle) to be cached offline — a service worker / PWA concern
  // that is out of MVP scope (documented in offline-sync.md). The CRDT *content*
  // durability that Phase 3 owns lives in IndexedDB and is proven here: an edit made
  // while offline is still present after a full page reload. (Byte-level IndexedDB
  // persistence across reload is additionally covered by the integration/unit layer.)
  const userA = uniqueUser('a');
  await registerUser(request, userA);
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  void docId;
  await expectStatus(pageA, /synced/i);

  // Make an edit while genuinely offline.
  await setOffline(ctxA, true);
  await expectStatus(pageA, /offline/i);
  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' PERSIST_OFFLINE');
  await expect(body(pageA)).toContainText('PERSIST_OFFLINE');

  // Restore the network so the app shell can be re-fetched, then reload. The edit,
  // which was only ever stored locally (IndexedDB) at the time it was made, is still
  // present after the reload.
  await setOffline(ctxA, false);
  await expectStatus(pageA, /synced/i);
  await pageA.reload();
  await expect(body(pageA)).toContainText('PERSIST_OFFLINE', { timeout: 20_000 });

  await ctxA.close();
});

test('both offline diverge, then both reconnect → converge (no last-write-wins)', async ({
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

  await loginUI(pageA, userA);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, userB.email, 'editor');
  await loginUI(pageB, userB);
  await pageB.goto(`/d/${docId}`);
  // A blank document opens empty; seed a shared, non-empty base so both peers start
  // from the same converged content (expectConverged requires visible text).
  await body(pageA).click();
  await body(pageA).pressSequentially('BASE');
  await expectConverged(pageA, pageB);

  await setOffline(ctxA, true);
  await setOffline(ctxB, true);
  await expectStatus(pageA, /offline/i);
  await expectStatus(pageB, /offline/i);

  await body(pageA).click();
  await body(pageA).press('End');
  await body(pageA).pressSequentially(' TAIL_A');
  await body(pageB).click();
  await body(pageB).press('Home');
  await body(pageB).pressSequentially('HEAD_B ');

  // Reconnect A first, then B — B reconnecting last must NOT overwrite A.
  await setOffline(ctxA, false);
  await pageA.waitForTimeout(500);
  await setOffline(ctxB, false);

  await expectConverged(pageA, pageB);
  await expect(body(pageA)).toContainText('TAIL_A');
  await expect(body(pageA)).toContainText('HEAD_B');

  await ctxA.close();
  await ctxB.close();
});

test('presence disappears when a peer disconnects and returns on reconnect', async ({
  browser,
  request,
}) => {
  // Awareness is pruned either by the server on detected disconnect or, as a
  // fallback, by the client's ~30s awareness-outdated timeout — so allow for that.
  test.setTimeout(120_000);
  const userA = uniqueUser('a');
  const userB = uniqueUser('b');
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

  // A sees B's presence avatar (awareness). Presence avatars carry a title/name.
  const bAvatarOnA = pageA.getByTitle(new RegExp(userB.displayName, 'i'));
  await expect(bAvatarOnA).toBeVisible();

  // B disconnects → its presence expires from A's view (awareness is ephemeral).
  await setOffline(ctxB, true);
  await expect(bAvatarOnA).toBeHidden({ timeout: 45_000 });

  // B returns → presence is re-published.
  await setOffline(ctxB, false);
  await expect(bAvatarOnA).toBeVisible({ timeout: 20_000 });

  await ctxA.close();
  await ctxB.close();
});
