/**
 * Loads /primitives, selects inner_threaded_pipe, captures the console
 * + a canvas screenshot. Use to confirm the CSG renders in the browser
 * matches the Node-level result (12.7k verts, carved bore).
 *
 *   bunx playwright test tests/e2e/inner-threaded-debug.spec.ts
 */
import { test, expect } from '@playwright/test';

test('inner_threaded_pipe renders the carved tube', async ({ page }) => {
  const consoleLines: string[] = [];
  const previews: Array<{ status: number; preview_verts?: number; bake_size?: number; body?: string }> = [];

  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/primitives/preview')) {
      try {
        const j = await resp.json();
        previews.push({
          status: resp.status(),
          preview_verts: j?.full?.positions?.length ? j.full.positions.length / 3 : undefined,
        });
      } catch { previews.push({ status: resp.status(), body: (await resp.text()).slice(0, 200) }); }
    } else if (url.includes('/api/primitives/bake-preview')) {
      try {
        const j = await resp.json();
        previews.push({
          status: resp.status(),
          bake_size: j?.full?.length ?? 0,
        });
      } catch { previews.push({ status: resp.status(), body: (await resp.text()).slice(0, 200) }); }
    }
  });

  await page.goto('/primitives');

  const row = page.locator('.prim-row').filter({
    has: page.locator('.prim-name', { hasText: /^inner_threaded_pipe$/ }),
  }).first();
  await row.click();

  // Wait for the canvas to mount + render.
  await Promise.race([
    page.locator('.pv-canvas-pane canvas').first().waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {}),
    page.locator('.pc-error').first().waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {}),
  ]);
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'test-results/inner-threaded-pipe.png', fullPage: false });

  console.log('--- previews / bakes ---');
  for (const p of previews) console.log(JSON.stringify(p));
  console.log('--- console ---');
  for (const l of consoleLines.slice(0, 60)) console.log(l);
});
