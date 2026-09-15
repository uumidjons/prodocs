import { type APIRequestContext, type BrowserContext, type Page, expect } from '@playwright/test';

/**
 * Shared E2E helpers. Users are created through the REAL REST API and documents
 * through the REAL app UI/API, so nothing here bypasses the server contract.
 */

/** The dev-only convergence probe the app installs (collabDiagnostics.ts). */
declare global {
  interface Window {
    __scribeConvergence?: { documentJson(): unknown };
  }
}

export interface TestUser {
  email: string;
  password: string;
  displayName: string;
}

let seq = 0;
export function uniqueUser(prefix = 'user'): TestUser {
  seq += 1;
  const tag = `${Date.now().toString(36)}-${seq}`;
  return {
    email: `${prefix}-${tag}@example.com`,
    password: 'Sup3r-Secret-Passw0rd',
    displayName: `${prefix} ${tag}`,
  };
}

/** Register a user via the API (independent of any browser context). */
export async function registerUser(request: APIRequestContext, user: TestUser): Promise<void> {
  const res = await request.post('/api/auth/register', {
    data: { email: user.email, password: user.password, displayName: user.displayName },
  });
  expect(res.ok(), `register ${user.email}: ${res.status()}`).toBeTruthy();
}

/**
 * Log a browser context in through the UI so the httpOnly refresh cookie + the
 * in-memory access token are established exactly as in real use.
 */
export async function loginUI(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login'); // unauthenticated app redirects here; login is the default mode
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Land on the documents home.
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Create a BLANK document via the app and return its id (from the URL). "New
 * Document" now opens a creation dialog (task §4) rather than creating immediately,
 * so we click through to "Blank document".
 */
export async function createDocumentUI(page: Page): Promise<string> {
  await page.goto('/');
  // Both the sidebar and the empty-home body offer a "New Document" button; either
  // works — take the first.
  await page.getByRole('button', { name: 'New Document' }).first().click();
  // Choose "Blank document" in the dialog.
  await page.getByRole('dialog', { name: 'New document' }).getByText('Blank document').click();
  await page.waitForURL(/\/d\/[0-9a-f-]{36}/);
  const m = page.url().match(/\/d\/([0-9a-f-]{36})/);
  if (!m) throw new Error('did not navigate to a document');
  return m[1]!;
}

/** The contenteditable body of the editor. */
export function body(page: Page) {
  return page.locator('[aria-label="Document body"]');
}

/**
 * Wait until the sync status pill shows a state matching `re`. Scoped to the header
 * so it targets the StatusPill and never the document body (whose seed content
 * legitimately contains the word "offline").
 */
export async function expectStatus(page: Page, re: RegExp): Promise<void> {
  await expect(page.locator('header').getByText(re)).toBeVisible();
}

/** Put a whole context offline / online at the real network layer (§18). */
export async function setOffline(context: BrowserContext, offline: boolean): Promise<void> {
  await context.setOffline(offline);
}

/**
 * The editor's document text with remote-cursor widgets stripped. CollaborationCursor
 * injects each peer's caret + name label into the DOM, so raw innerText differs
 * between peers by those labels even when the underlying document is identical — we
 * remove them to compare the actual content.
 */
export async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-label="Document body"]');
    if (!el) return '';
    const clone = el.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(
        '.collaboration-cursor__caret, .collaboration-cursor__label, .ProseMirror-yjs-cursor',
      )
      .forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/**
 * Poll until both editors render identical document text (cursor widgets excluded) —
 * DOM-level convergence in real browsers. Byte-level CRDT convergence is asserted by
 * the server integration suite; this proves the user-visible result.
 */
export async function expectConverged(a: Page, b: Page, timeout = 40_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const ta = await editorText(a);
        const tb = await editorText(b);
        return ta.length > 0 && ta === tb ? ta : null;
      },
      { timeout, message: 'editors did not converge to identical text' },
    )
    .not.toBeNull();
}

/**
 * The CANONICAL LOGICAL document JSON for a page — the ProseMirror doc exposed by the
 * dev-only convergence probe (collabDiagnostics.ts). Unlike {@link editorText} this
 * carries the full structure: marks (bold/italic/underline), node attributes
 * (`textAlign`, heading level), `pageBreak` nodes, and list nesting. It excludes
 * client-only presentation (pagination decorations, remote cursors), so two converged
 * replicas produce byte-identical JSON. Returns null until the probe is installed.
 */
export async function documentJson(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const probe = window.__scribeConvergence;
    if (!probe) return null;
    // Stable stringify (sorted keys) so key ordering never causes a false mismatch.
    const sort = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(sort);
      if (v && typeof v === 'object') {
        return Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = sort((v as Record<string, unknown>)[k]);
            return acc;
          }, {});
      }
      return v;
    };
    return JSON.stringify(sort(probe.documentJson()));
  });
}

/**
 * STRUCTURAL convergence (correctness contract §17): poll until both editors expose
 * identical canonical logical document JSON — proving marks, attributes, page breaks,
 * and list structure converged, not merely the visible text. This is the browser-level
 * analogue of the server suite's Yjs state-vector equality check.
 */
export async function expectStructurallyConverged(
  a: Page,
  b: Page,
  timeout = 40_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const ja = await documentJson(a);
        const jb = await documentJson(b);
        return ja && jb && ja === jb ? ja : null;
      },
      { timeout, message: 'editors did not converge to identical document STRUCTURE' },
    )
    .not.toBeNull();
}
