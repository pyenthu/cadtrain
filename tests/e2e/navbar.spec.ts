/**
 * Smoke test: navbar segments are correct and active-state highlighting
 * tracks the current route. Catches regressions where the +layout.svelte
 * `segments` array drifts from the actual route map.
 */

import { test, expect } from '@playwright/test';

test('navbar shows the four expected segments', async ({ page }) => {
  await page.goto('/');
  const navbar = page.locator('nav.navbar');
  await expect(navbar).toBeVisible();

  for (const label of ['CAD', 'Wells', 'Archive', 'Meta']) {
    await expect(navbar.locator('.seg-label', { hasText: label })).toBeVisible();
  }
});

test('navbar Archive segment links to /archive index (collapsed)', async ({ page }) => {
  // Archive nav was collapsed from 10 items to a single "Browse" link to /archive.
  // The /archive index page itself lists every archived route — the navbar just
  // points there. Cuts navbar length from ~13 items to 4.
  await page.goto('/');
  const navbar = page.locator('nav.navbar');
  await expect(navbar.locator('a.nav-item[href="/archive"]')).toBeVisible();
});

test('navbar highlights the active route', async ({ page }) => {
  // Tests the top-level navbar entries that exist after the Archive collapse.
  // Individual archived routes no longer have their own navbar entries — they
  // live in the /archive index page instead.
  await page.goto('/cad');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/cad"]')).toBeVisible();

  await page.goto('/archive');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/archive"]')).toBeVisible();

  await page.goto('/plan');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/plan"]')).toBeVisible();
});

test('clicking the Archive nav link navigates to the archive index', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.navbar a.nav-item[href="/archive"]').click();
  await expect(page).toHaveURL('/archive');
  // From the archive index, every archived route should be reachable.
  await expect(page.locator('main.content a[href="/archive/wells"]').first()).toBeVisible();
});
