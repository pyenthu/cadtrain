/**
 * Smoke test: navbar links are correct and active-state highlighting
 * tracks the current route. Catches regressions where the +layout.svelte
 * `navLinks` array drifts from the actual route map.
 */

import { test, expect } from '@playwright/test';

const NAV = [
  { href: '/primitives', label: 'Primitives' },
  { href: '/families', label: 'Families' },
  { href: '/author', label: 'Author' },
  { href: '/kb', label: 'KB' },
  { href: '/wells', label: 'Wells' },
  { href: '/archive/tests', label: 'Tests' },
  { href: '/plan', label: 'Plan' },
  { href: '/archive', label: 'Archive' },
] as const;

test('navbar shows the eight top-level links', async ({ page }) => {
  await page.goto('/');
  const navbar = page.locator('nav.navbar');
  await expect(navbar).toBeVisible();

  for (const { href, label } of NAV) {
    const link = navbar.locator(`a.nav-item[href="${href}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveText(label);
  }
});

test('navbar Tests link points to /archive/tests', async ({ page }) => {
  // The Tests link is the recordings + cache stats page (was buried under
  // Archive before). Promoted to top-level so test results are one click away.
  await page.goto('/');
  await page.locator('nav.navbar a.nav-item[href="/archive/tests"]').click();
  await expect(page).toHaveURL('/archive/tests');
});

test('navbar highlights the active route', async ({ page }) => {
  await page.goto('/primitives');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/primitives"]')).toBeVisible();

  await page.goto('/families');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/families"]')).toBeVisible();

  await page.goto('/author');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/author"]')).toBeVisible();

  await page.goto('/archive');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/archive"]')).toBeVisible();

  await page.goto('/archive/tests');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/archive/tests"]')).toBeVisible();

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

test('home page is the menu — links match the navbar', async ({ page }) => {
  // Per "use just the nav menu like SVTC" — home page is a clean list of
  // routes, no marketing copy. Each home link must point at one of the
  // navbar destinations so the home page never drifts from the navbar.
  await page.goto('/');
  const home = page.locator('.menu');
  await expect(home).toBeVisible();
  for (const { href } of NAV) {
    await expect(home.locator(`a.menu-item[href="${href}"]`)).toBeVisible();
  }
});
