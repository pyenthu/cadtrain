/**
 * Ad-hoc visual debug for /primitives — selects profile_extrude_v2,
 * waits for the canvas to render, captures a screenshot to
 * test-results/. Use this to diagnose visual issues (e.g. "the cross
 * looks flat at the bottom") without needing the browser extension.
 *
 * Run with:  bun playwright test tests/e2e/primitives-debug.spec.ts
 */
import { test, expect } from '@playwright/test';

for (const id of ['profile_extrude', 'profile_extrude_v2']) {
  test(`${id} renders`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const previewResponses: Array<{ status: number; body: string }> = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/primitives/preview')) {
        try { previewResponses.push({ status: resp.status(), body: (await resp.text()).slice(0, 240) }); }
        catch {}
      }
    });

    await page.goto('/primitives');
    await expect(page.locator('h2', { hasText: /primitives/i }).first()).toBeVisible();

    // Match the .prim-name span exactly (the .prim-row also contains
    // the bnd/vol tag and the trash button text, so a row-level
    // hasText regex can't anchor cleanly).
    const row = page.locator('.prim-row').filter({
      has: page.locator('.prim-name', { hasText: new RegExp(`^${id}$`) }),
    }).first();
    await row.click();

    // Either canvas mounts OR preview error banner appears — capture
    // whichever happens.
    await Promise.race([
      page.locator('.pv-canvas-pane canvas').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
      page.locator('.pc-error').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/${id}.png`, fullPage: false });

    console.log(`[${id}] preview responses:`, JSON.stringify(previewResponses));
    console.log(`[${id}] console errors:`, consoleErrors);
  });
}
