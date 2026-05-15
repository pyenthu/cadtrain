/**
 * Smoke test: every registered route loads (HTTP 200) and renders without
 * runtime errors. Catches the most common breakage from route moves and
 * import-path renames.
 *
 * Old top-level URLs (/components, /reverse, /library, /tools/*, /tests,
 * /training) should now 404 — they live under /archive/* after the
 * two-product split (commit 55b1f43). /library was removed entirely when
 * the library panel was merged into /author.
 */

import { test, expect } from '@playwright/test';

const TOP_LEVEL = [
  { path: '/', heading: /CAD Train/i },
  { path: '/wells', heading: /Wells/i },
  { path: '/archive', heading: /Archive/i },
  { path: '/plan', heading: /Plan/i },
];

const ARCHIVED = [
  '/archive/components',
  '/archive/reverse',
  '/archive/training',
  '/archive/tests',
  '/archive/tests/wells',
  '/archive/tests/components',
  '/archive/wells',
  '/archive/tools/bottom-sub',
  '/archive/tools/ratch-latch',
];

const REMOVED_TOP_LEVEL = [
  '/components',
  '/reverse',
  '/training',
  '/tests',
  '/tools/bottom-sub',
  '/tools/ratch-latch',
  '/library', // removed when the library panel was merged into /author
  '/author',  // unified workbench retired; library + AI prompt now live inside /primitives
];

for (const route of TOP_LEVEL) {
  test(`top-level route loads: ${route.path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const response = await page.goto(route.path);
    expect(response?.status(), `${route.path} should return 200`).toBe(200);
    if (route.path === '/') {
      // Home is the SVTC-style nav menu — no <h1>, just the .menu-header
      // ('CAD Train') + the route list.
      await expect(page.locator('.menu-header')).toContainText(route.heading);
    } else {
      await expect(page.locator('h1').first()).toContainText(route.heading);
    }
    expect(errors, `${route.path} should not throw runtime errors`).toEqual([]);
  });
}

for (const path of ARCHIVED) {
  test(`archived route loads: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const response = await page.goto(path);
    expect(response?.status(), `${path} should return 200`).toBe(200);
    // Don't check h1 — some archived pages have varied headings; rely on no runtime errors.
    expect(errors, `${path} should not throw runtime errors`).toEqual([]);
  });
}

for (const path of REMOVED_TOP_LEVEL) {
  test(`removed top-level URL 404s: ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    // SvelteKit 404s return 404, not redirects.
    expect(response?.status(), `${path} should be 404 after archive move`).toBe(404);
  });
}
