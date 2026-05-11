/**
 * Smoke test: the SVTC-style corner-button nav menu shows the right links
 * and active-state highlighting tracks the current route. Catches
 * regressions where the +layout.svelte `navSections` drifts from the
 * actual route map.
 */

import { test, expect } from '@playwright/test';

const NAV = [
  { href: '/author', label: 'Author' },
  { href: '/primitives', label: 'Primitives' },
  { href: '/families', label: 'Families' },
  { href: '/kb', label: 'KB' },
  { href: '/wells', label: 'Wells' },
  { href: '/archive/tests', label: 'Tests' },
  { href: '/plan', label: 'Plan' },
  { href: '/archive', label: 'Archive' },
] as const;

async function openMenu(page: any) {
  await page.locator('.nav-btn').click();
  await expect(page.locator('nav.navmenu')).toBeVisible();
}

test('nav menu opens and lists all eight links', async ({ page }) => {
  await page.goto('/');
  await openMenu(page);
  const menu = page.locator('nav.navmenu');
  for (const { href, label } of NAV) {
    const link = menu.locator(`a.nav-item[href="${href}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveText(label);
  }
});

test('nav menu Tests link navigates to /archive/tests', async ({ page }) => {
  await page.goto('/');
  await openMenu(page);
  await page.locator('nav.navmenu a.nav-item[href="/archive/tests"]').click();
  await expect(page).toHaveURL('/archive/tests');
});

test('nav menu highlights the active route', async ({ page }) => {
  for (const path of ['/primitives', '/families', '/author', '/archive', '/archive/tests', '/plan']) {
    await page.goto(path);
    await openMenu(page);
    await expect(page.locator(`nav.navmenu a.nav-item.active[href="${path}"]`)).toBeVisible();
    // Close so the next iteration opens fresh.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
  }
});

test('Archive link navigates to the archive index', async ({ page }) => {
  await page.goto('/');
  await openMenu(page);
  await page.locator('nav.navmenu a.nav-item[href="/archive"]').click();
  await expect(page).toHaveURL('/archive');
  await expect(page.locator('main.content a[href="/archive/wells"]').first()).toBeVisible();
});

test('home page is the menu — links match the nav menu', async ({ page }) => {
  // Home is a plain list of routes (no marketing copy). Every home menu link
  // must also be in the nav so the two never drift.
  await page.goto('/');
  const home = page.locator('.menu');
  await expect(home).toBeVisible();
  for (const { href } of NAV) {
    await expect(home.locator(`a.menu-item[href="${href}"]`)).toBeVisible();
  }
});
