import { expect, test } from '@playwright/test';
import { closeDb, grantMembership } from './db.js';
import {
  body,
  createDocumentUI,
  documentJson,
  expectStatus,
  expectStructurallyConverged,
  loginUI,
  registerUser,
  setOffline,
  uniqueUser,
} from './helpers.js';

/**
 * STRUCTURAL convergence in real browsers (correctness contract §12 + §17).
 *
 * The rest of the offline suite asserts convergence on visible TEXT. Text alone
 * cannot catch a divergence in marks, node attributes, page breaks, or list
 * structure — two replicas could render the same characters while disagreeing on
 * whether a word is bold or a block is centered. These tests therefore assert
 * convergence on the CANONICAL LOGICAL document (the ProseMirror doc JSON exposed by
 * the dev-only convergence probe), the browser-level analogue of the server suite's
 * Yjs state-vector equality check.
 *
 * The edits are made while genuinely offline (real Playwright network-offline) and
 * span formatting, block attributes, page breaks, and lists — all of which are plain
 * document-model operations that ride the SAME CRDT pipeline as text. Convergence is
 * produced solely by the Yjs state-vector handshake on reconnect; nothing here calls
 * a merge function or replaces a document.
 */

test.afterAll(async () => {
  await closeDb();
});

test('offline formatting + page break diverge → structurally converge (no loss)', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('sa');
  const userB = uniqueUser('sb');
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

  // Shared, converged base so both peers diverge from the same starting structure.
  await body(pageA).click();
  await pageA.keyboard.press('Control+Home');
  await body(pageA).pressSequentially('BASE LINE');
  await expectStructurallyConverged(pageA, pageB);
  await expectStatus(pageA, /synced/i);
  await expectStatus(pageB, /synced/i);

  // Both go genuinely offline at the network layer.
  await setOffline(ctxA, true);
  await setOffline(ctxB, true);
  await expectStatus(pageA, /offline/i);
  await expectStatus(pageB, /offline/i);

  // A (offline): append BOLD text at the end, then insert an explicit page break.
  await body(pageA).click();
  await pageA.keyboard.press('Control+End');
  await pageA.keyboard.press('End');
  await pageA.getByRole('button', { name: /bold/i }).click(); // stored mark for next typed text
  await body(pageA).pressSequentially('BOLD_A');
  await pageA.keyboard.press('Control+End');
  await body(pageA).press('Control+Enter'); // page break at top level
  await expect(pageA.locator('[aria-label="Document body"] [data-page-break]')).toHaveCount(1);
  await expect(pageA.locator('[aria-label="Document body"] strong')).toHaveCount(1);

  // B (offline): center the first block (a `textAlign` node attribute — different
  // dimension of the same first block A is also editing, exercising a real merge).
  await body(pageB).click();
  await pageB.keyboard.press('Control+Home');
  await pageB.getByRole('button', { name: /alignment/i }).click();
  await pageB.getByRole('option', { name: /align center/i }).click();
  await expect(
    pageB.locator('[aria-label="Document body"] [style*="text-align: center"]'),
  ).toHaveCount(1);

  // Reconnect A first, then B — the later reconnect must NOT overwrite the earlier.
  await setOffline(ctxA, false);
  await pageA.waitForTimeout(500);
  await setOffline(ctxB, false);

  // Both replicas converge to the IDENTICAL logical document (structure included).
  await expectStructurallyConverged(pageA, pageB);

  // And every concurrent structural edit survived on BOTH peers.
  for (const p of [pageA, pageB]) {
    await expect(p.locator('[aria-label="Document body"] strong')).toHaveCount(1);
    await expect(p.locator('[aria-label="Document body"] [data-page-break]')).toHaveCount(1);
    await expect(
      p.locator('[aria-label="Document body"] [style*="text-align: center"]'),
    ).toHaveCount(1);
    await expect(p.locator('[aria-label="Document body"]')).toContainText('BOLD_A');
  }

  // Sanity: the canonical JSON really does carry the structure (not just text) and is
  // byte-identical across peers — the property text-only convergence cannot prove.
  const ja = await documentJson(pageA);
  const jb = await documentJson(pageB);
  expect(ja).toBe(jb);
  expect(ja).toContain('pageBreak');
  expect(ja).toContain('bold');
  expect(ja).toContain('center');

  await ctxA.close();
  await ctxB.close();
});

test('offline list edits in different regions diverge → structurally converge (both survive)', async ({
  browser,
  request,
}) => {
  const userA = uniqueUser('la');
  const userB = uniqueUser('lb');
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

  // Base: two DISTINCT blocks. A restructures the first block; B edits the second.
  // These are different regions, so both intentions are preserved on merge (contrast
  // with a structural replace and an adjacent insert on the *same* block, which
  // y-prosemirror cannot both preserve — see the correctness contract's limitations).
  await body(pageA).click();
  await pageA.keyboard.press('Control+Home');
  await body(pageA).pressSequentially('Item one');
  await pageA.keyboard.press('Enter');
  await body(pageA).pressSequentially('Second block');
  await expectStructurallyConverged(pageA, pageB);

  await setOffline(ctxA, true);
  await setOffline(ctxB, true);
  await expectStatus(pageA, /offline/i);
  await expectStatus(pageB, /offline/i);

  // A converts the FIRST block into a bullet list (structural: paragraph → listItem).
  await body(pageA).click();
  await pageA.keyboard.press('Control+Home');
  await pageA.getByRole('button', { name: /bullet list/i }).click();
  await expect(pageA.locator('[aria-label="Document body"] ul')).toHaveCount(1);

  // B appends text to the SECOND block (a different region).
  await body(pageB).click();
  await pageB.keyboard.press('Control+End');
  await body(pageB).pressSequentially(' + tail from B');

  await setOffline(ctxB, false);
  await pageB.waitForTimeout(500);
  await setOffline(ctxA, false);

  await expectStructurallyConverged(pageA, pageB);
  for (const p of [pageA, pageB]) {
    await expect(p.locator('[aria-label="Document body"] ul')).toHaveCount(1);
    await expect(p.locator('[aria-label="Document body"]')).toContainText('tail from B');
    await expect(p.locator('[aria-label="Document body"]')).toContainText('Item one');
  }

  await ctxA.close();
  await ctxB.close();
});
