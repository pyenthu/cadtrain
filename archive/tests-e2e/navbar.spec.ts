/**
 * Smoke test: the SVTC-style corner-button nav menu shows the right links
 * and active-state highlighting tracks the current route. Catches
 * regressions where the +layout.svelte `navSections` drifts from the
 * actual route map.
 */

import { test, expect } from '@playwright/test';

const NAV = [
  { href: '/primitives',    label: 'Primitives' },
  { href: '/wells',         label: 'Wells' },
  { href: '/volume',        label: 'Volume' },
  { href: '/archive/tests', label: 'Tests' },
  { href: '/plan',          label: 'Plan' },
  { href: '/archive',       label: 'Archive' },
] as const;

async function openMenu(page: any) {
  await page.locator('.nav-btn').click();
  await expect(page.locator('nav.navmenu')).toBeVisible();
}

test('nav menu opens and lists every link', async ({ page }) => {
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
  for (const path of ['/primitives', '/volume', '/archive', '/archive/tests', '/plan']) {
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
