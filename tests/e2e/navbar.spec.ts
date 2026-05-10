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

test('navbar Archive segment lists the canonical archived routes', async ({ page }) => {
  await page.goto('/');
  const navbar = page.locator('nav.navbar');

  for (const href of [
    '/archive',
    '/archive/components',
    '/archive/reverse',
    '/archive/author',
    '/archive/library',
    '/archive/training',
    '/archive/wells',
    '/archive/tests',
    '/archive/tools/bottom-sub',
    '/archive/tools/ratch-latch',
  ]) {
    await expect(navbar.locator(`a.nav-item[href="${href}"]`)).toBeVisible();
  }
});

test('navbar highlights the active route', async ({ page }) => {
  await page.goto('/cad');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/cad"]')).toBeVisible();

  await page.goto('/archive/components');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/archive/components"]')).toBeVisible();

  await page.goto('/plan');
  await expect(page.locator('nav.navbar a.nav-item.active[href="/plan"]')).toBeVisible();
});

test('clicking an Archive nav link navigates correctly', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.navbar a.nav-item[href="/archive/wells"]').click();
  await expect(page).toHaveURL('/archive/wells');
});
