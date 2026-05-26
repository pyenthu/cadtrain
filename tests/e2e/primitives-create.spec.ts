/**
 * E2E for the /primitives "+ new primitive" create flow — the bug where adding
 * a component failed (the meta transpile error from a polygon array default) and
 * the function-first move (raw r_revolve/r_extrude removed from the base picker;
 * revolve parts are born from a profile FUNCTION).
 *
 * All /api/primitives + /api/volume calls are forced onto the LOCAL FS via an
 * `X-Volume-Local: 1` header (route-injected) so the test is deterministic and
 * never writes to the shared prod volume. The created part lands in
 * .dev-volume/primitives/completions/drill_pipe/<id>/ and is rm'd in afterAll.
 */
import { test, expect } from '@playwright/test';
import { rm } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd();
const DRILL_PIPE_DIR = join(ROOT, '.dev-volume', 'primitives', 'completions', 'drill_pipe');
const STUB_ID = `e2e_rev_${Date.now()}`;

test.describe.serial('/primitives — create flow (function-first)', () => {
  // Force LOCAL FS for every /api/primitives call (the create flow uses
  // save/list/source) so the test is deterministic + never writes to prod.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/primitives/**', (route) =>
      route.continue({ headers: { ...route.request().headers(), 'x-volume-local': '1' } }));
  });

  test.afterAll(async () => {
    await rm(join(DRILL_PIPE_DIR, STUB_ID), { recursive: true, force: true }).catch(() => {});
  });

  test('raw r_revolve / r_extrude are NOT offered as bases (function-first)', async ({ page }) => {
    await page.goto('/primitives');
    await expect(page.locator('h2', { hasText: /primitives/i }).first()).toBeVisible({ timeout: 15_000 });

    // Open the Drill Pipe family's "+ new primitive" popup.
    await page.locator('.prim-fam', { hasText: 'Drill Pipe' }).locator('.prim-add').click();
    await expect(page.locator('.prim-create')).toBeVisible();

    // The base picker offers profile FUNCTIONS but NOT raw r_revolve/r_extrude.
    await expect(page.locator('.prim-create-opt', { hasText: /◆ profile/i }).first()).toBeVisible();
    await expect(page.locator('.prim-create-opt', { hasText: /^r_revolve$/ })).toHaveCount(0);
    await expect(page.locator('.prim-create-opt', { hasText: /^r_extrude$/ })).toHaveCount(0);
  });

  test('creating from a profile function saves with NO meta error + part appears', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/primitives');
    await expect(page.locator('h2', { hasText: /primitives/i }).first()).toBeVisible({ timeout: 15_000 });

    await page.locator('.prim-fam', { hasText: 'Drill Pipe' }).locator('.prim-add').click();
    await expect(page.locator('.prim-create')).toBeVisible();

    // id + pick the first profile-function base (function-first revolve).
    await page.getByPlaceholder(/e\.g\. dp_pin/i).fill(STUB_ID);
    await page.locator('.prim-create-opt', { hasText: /◆ profile/i }).first().click();

    // Save must return 200 (the transpile bug returned 400) and no error banner.
    const saveResp = page.waitForResponse((r) => r.url().includes('/api/primitives/save'));
    await page.locator('.prim-create .prim-mini-btn.primary', { hasText: /^(Create|…)$/ }).click();
    const resp = await saveResp;
    expect(resp.status(), 'save should succeed (not the 400 transpile error)').toBe(200);
    await expect(page.locator('.prim-create-err')).toHaveCount(0);

    // The new part shows under Drill Pipe (the refresh-retry covers list lag).
    await expect(
      page.locator('.prim-fam', { hasText: 'Drill Pipe' }).locator('.prim-name', { hasText: STUB_ID }),
    ).toBeVisible({ timeout: 10_000 });

    expect(errors, 'no runtime errors').toEqual([]);
  });
});
