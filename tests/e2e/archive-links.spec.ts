/**
 * Smoke test: intra-archive links resolve correctly. After the route
 * move (commit 55b1f43) every internal link inside an archived page
 * must point at /archive/* — none of the bare /author, /library, /tests
 * paths should remain.
 *
 * This catches the most common copy-paste regression (forgetting to
 * update a link when adding a new archive page or modifying an existing
 * one).
 */

import { test, expect } from '@playwright/test';

const STALE_PATTERNS = [
  /\bhref="\/components\b/,
  /\bhref="\/reverse\b/,
  /\bhref="\/training\b/,
  /\bhref="\/tests\b/,        // bare /tests — /archive/tests is fine
  /\bhref="\/author\b/,
  /\bhref="\/library\b/,
  /\bhref="\/tools\b/,
  // /wells is OK — that's the new top-level stub.
];

const ARCHIVED_PAGES = [
  '/archive',
  '/archive/components',
  '/archive/reverse',
  '/archive/training',
  '/archive/tests',
  '/archive/tests/wells',
  '/archive/tests/components',
  '/archive/author',
  '/archive/library',
  '/archive/wells',
  '/archive/tools/bottom-sub',
  '/archive/tools/ratch-latch',
];

for (const path of ARCHIVED_PAGES) {
  test(`no stale top-level links inside ${path}`, async ({ page }) => {
    await page.goto(path);
    // Inspect rendered HTML, exclude the navbar (which links to /plan etc).
    const main = await page.locator('main.content').first().innerHTML();
    for (const pattern of STALE_PATTERNS) {
      expect(main, `${path} body should not contain bare top-level link matching ${pattern}`).not.toMatch(pattern);
    }
  });
}

test('Archive index page lists all canonical archived routes', async ({ page }) => {
  await page.goto('/archive');
  for (const href of [
    '/archive/components',
    '/archive/reverse',
    '/archive/training',
    '/archive/author',
    '/archive/library',
    '/archive/wells',
    '/archive/tests',
    '/archive/tests/wells',
    '/archive/tests/components',
    '/archive/tools/bottom-sub',
    '/archive/tools/ratch-latch',
  ]) {
    await expect(page.locator(`main.content a[href="${href}"]`).first()).toBeVisible();
  }
});

test('archived Tests page links to /archive/tests/wells and /archive/tests/components', async ({ page }) => {
  await page.goto('/archive/tests');
  await expect(page.locator('main.content a[href="/archive/tests/wells"]')).toBeVisible();
  await expect(page.locator('main.content a[href="/archive/tests/components"]')).toBeVisible();
});

test('archived Library back-link points at /archive/author', async ({ page }) => {
  await page.goto('/archive/library');
  await expect(page.locator('main.content a[href="/archive/author"]').first()).toBeVisible();
});

test('archived Author forward-link points at /archive/library', async ({ page }) => {
  await page.goto('/archive/author');
  await expect(page.locator('main.content a[href="/archive/library"]').first()).toBeVisible();
});
