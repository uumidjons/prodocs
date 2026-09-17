import { expect, test, type Page } from '@playwright/test';
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
 * PHASE — Tab / Shift-Tab editor behavior (task §B) in real Chromium. Tab inside text
 * is an editor indent command (a document `indent` attribute that persists + collaborates)
 * while list Tab still sinks/lifts items, and viewers gain no editing behavior.
 */

const docBody = '[aria-label="Document body"]';

function paragraphIndent(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const doc = window.__scribeConvergence?.documentJson() as
      { content?: { type: string; attrs?: { indent?: number } }[] } | undefined;
    return doc?.content?.find((n) => n.type === 'paragraph')?.attrs?.indent ?? null;
  });
}

/**
 * Deterministically place the caret at the start of top-level block `blockIndex`.
 * Native Home/ArrowLeft do not reliably move a ProseMirror caret in headless
 * Chromium once a Playwright query has run against the page (the DOM selection is
 * reset to the block end), so tests that must Backspace from a block's START use the
 * dev-only probe to set the ProseMirror selection directly. This positions the caret
 * only; the behavior under test (the Backspace keymap) is still driven by a real key.
 */
function caretToBlockStart(page: Page, blockIndex = 0): Promise<void> {
  return page.evaluate((i) => {
    window.__scribeConvergence?.caretToBlockStart?.(i);
  }, blockIndex);
}

test.afterAll(async () => {
  await closeDb();
});

test('Tab indents a paragraph and persists; Shift-Tab outdents', async ({ browser, request }) => {
  const user = uniqueUser('ti');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('Indent me');

  // Tab → indent level 1 (a real document attribute, rendered as a left margin).
  await page.keyboard.press('Tab');
  await expect.poll(() => paragraphIndent(page)).toBe(1);
  await expect(page.locator(`${docBody} p[data-indent="1"]`)).toHaveCount(1);
  await expect(body(page)).toContainText('Indent me'); // text intact, no literal "TAB"
  expect(await body(page).innerText()).not.toContain('TAB');

  // Tab again → level 2; Shift-Tab → back to 1.
  await page.keyboard.press('Tab');
  await expect.poll(() => paragraphIndent(page)).toBe(2);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => paragraphIndent(page)).toBe(1);

  // Persists across reload (indent is document/Yjs state, not local DOM).
  await expectStatus(page, /synced/i);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator(`${docBody} p[data-indent="1"]`)).toHaveCount(1, { timeout: 20000 });

  await ctx.close();
});

test('Backspace at the start of an indented block removes one indent level at a time', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('bi');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('Hello world');

  // Two Tabs → indent 2 (caret is at the END of the text after typing).
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect.poll(() => paragraphIndent(page)).toBe(2);

  // Caret at the very START of the block; Backspace peels exactly ONE level and the
  // text is untouched (it does NOT delete the previous content).
  await caretToBlockStart(page);
  await page.keyboard.press('Backspace');
  await expect.poll(() => paragraphIndent(page)).toBe(1);
  await expect(body(page)).toContainText('Hello world');

  // …again → level 0, one level removed per press, text still intact.
  await caretToBlockStart(page);
  await page.keyboard.press('Backspace');
  await expect.poll(() => paragraphIndent(page)).toBe(0);
  await expect(body(page)).toContainText('Hello world');

  // At indent 0, Backspace at the start of the FIRST/only block is normal (no-op
  // join, no crash) and the text is preserved.
  await caretToBlockStart(page);
  await page.keyboard.press('Backspace');
  await expect(body(page)).toContainText('Hello world');
  expect(await paragraphIndent(page)).toBe(0);

  // Backspace with the caret NOT at the block start (parentOffset ≠ 0) deletes a
  // character normally and never touches the indent. Re-indent first, then type a
  // leading 'Z' (caret lands right after it, at offset 1) and Backspace it away.
  await page.keyboard.press('Tab'); // re-indent to level 1
  await expect.poll(() => paragraphIndent(page)).toBe(1);
  await caretToBlockStart(page);
  await page.keyboard.type('Z');
  await expect(body(page)).toContainText('ZHello world');
  await page.keyboard.press('Backspace'); // offset 1 → default char delete, not outdent
  await expect(body(page)).toContainText('Hello world');
  await expect(body(page)).not.toContainText('ZHello');
  expect(await paragraphIndent(page)).toBe(1); // indent unchanged by a mid-text delete

  // The indent changes are real document state (currently level 1): they survive a
  // reload — the caret-driven outdent persisted through Yjs, not just the DOM.
  await expectStatus(page, /synced/i);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator(`${docBody} p[data-indent="1"]`)).toHaveCount(1, { timeout: 20000 });

  await ctx.close();
});

test('Backspace joins paragraphs normally when the block is not indented', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('bj');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('First');
  await page.keyboard.press('Enter');
  await body(page).pressSequentially('Second');

  // Caret at the start of the (un-indented) SECOND paragraph → Backspace joins it
  // with the first, exactly as the default editor behavior does (our indent handler
  // returns false at indent 0 and never intercepts the join).
  await caretToBlockStart(page, 1);
  await page.keyboard.press('Backspace');
  await expect(body(page)).toContainText('FirstSecond');

  await ctx.close();
});

test('Tab inside a list sinks the item (list Tab preserved, not paragraph indent)', async ({
  browser,
  request,
}) => {
  const user = uniqueUser('tl');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('first');
  await page.getByRole('button', { name: /bullet list/i }).click();
  await page.keyboard.press('Enter');
  await body(page).pressSequentially('second');

  // Caret is in the second item; Tab must NEST it (sinkListItem), producing a nested list.
  await page.keyboard.press('Tab');
  await expect(page.locator(`${docBody} ul ul`)).toHaveCount(1, { timeout: 5000 });

  // Shift-Tab lifts it back out (list structure intact, single level again).
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(`${docBody} ul ul`)).toHaveCount(0, { timeout: 5000 });
  await expect(body(page)).toContainText('second');

  await ctx.close();
});

test('viewer: Tab does not modify the document', async ({ browser, request }) => {
  const owner = uniqueUser('tvo');
  const viewer = uniqueUser('tvv');
  await registerUser(request, owner);
  await registerUser(request, viewer);

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, viewer.email, 'viewer');
  await body(pageA).click();
  await body(pageA).pressSequentially('viewer text');
  await expectStatus(pageA, /synced/i);

  const ctxV = await browser.newContext();
  const pageV = await ctxV.newPage();
  await loginUI(pageV, viewer);
  await pageV.goto(`/d/${docId}`);
  await expect(body(pageV)).toHaveAttribute('contenteditable', 'false');
  await expect(body(pageV)).toContainText('viewer text', { timeout: 20000 });

  // A viewer pressing Tab must not create an indent (no editing behavior via Tab): the
  // paragraph stays at level 0 (unindented) — Tab falls through to normal browser nav.
  await body(pageV).click();
  await pageV.keyboard.press('Tab');
  await pageV.waitForTimeout(300);
  expect(await paragraphIndent(pageV)).toBe(0);

  await ctxA.close();
  await ctxV.close();
});

test('indent undo/redo works through the collaborative history', async ({ browser, request }) => {
  const user = uniqueUser('tu');
  await registerUser(request, user);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUI(page, user);
  await createDocumentUI(page);
  await expectStatus(page, /synced/i);

  await body(page).click();
  await body(page).pressSequentially('Undo me');
  // Let the typing settle into its own Yjs UndoManager group so the following Tab is
  // captured as a SEPARATE undoable step (the manager coalesces edits within ~500ms).
  await page.waitForTimeout(800);
  await page.keyboard.press('Tab');
  await expect.poll(() => paragraphIndent(page)).toBe(1);

  // Undo removes the indent (it is an ordinary document edit in the Yjs UndoManager)
  // while the text — a separate history step — remains.
  await page.keyboard.press('Control+z');
  await expect.poll(() => paragraphIndent(page)).toBe(0);
  await expect(body(page)).toContainText('Undo me');

  // Redo restores the indent.
  await page.keyboard.press('Control+y');
  await expect.poll(() => paragraphIndent(page)).toBe(1);
  await expect(body(page)).toContainText('Undo me');

  await ctx.close();
});

test('indent changes replicate to a second collaborator', async ({ browser, request }) => {
  const owner = uniqueUser('tco');
  const editor = uniqueUser('tce');
  await registerUser(request, owner);
  await registerUser(request, editor);

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await loginUI(pageA, owner);
  const docId = await createDocumentUI(pageA);
  await grantMembership(docId, editor.email, 'editor');
  await body(pageA).click();
  await body(pageA).pressSequentially('shared indent');
  await expectStatus(pageA, /synced/i);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await loginUI(pageB, editor);
  await pageB.goto(`/d/${docId}`);
  await expect(body(pageB)).toContainText('shared indent', { timeout: 20000 });

  // A indents the paragraph; B must see the indent attribute replicate via Yjs.
  await body(pageA).click();
  await pageA.keyboard.press('Tab');
  await expect.poll(() => paragraphIndent(pageA)).toBe(1);
  await expect(pageB.locator(`${docBody} p[data-indent="1"]`)).toHaveCount(1, { timeout: 20000 });

  await ctxA.close();
  await ctxB.close();
});
