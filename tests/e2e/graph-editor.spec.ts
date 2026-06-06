/**
 * /graph-editor smoke + part-generation tests.
 *
 * RUN MODES:
 *
 *   Headless (CI / fast):      bun run test:e2e -- graph-editor
 *   Headed (visual confirm):   PWHEAD=1 bun run test:e2e:headed -- graph-editor
 *   Open report after:         bun run test:e2e:report
 *
 * The headed mode runs at slow_mo: 250 ms — you can watch every click,
 * every drag, and every node land on the canvas. Recommended whenever
 * you've changed the editor's interaction layer.
 *
 * The build test (`builds_mule_shoe_composition`) doubles as a part
 * generator: when it passes, it has just written `test_graph_built.asm.ts`
 * to the volume via /api/primitives/save. You can grep the volume for
 * that file to verify the round-trip.
 *
 * Selectors used are stable class hooks from /graph-editor/+page.svelte.
 * If you rename them, update here too.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

// ─── helpers ────────────────────────────────────────────────────────────

async function openEditor(page: Page) {
  await page.goto('/graph-editor');
  await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
  await page.locator('.ge-canvas').waitFor({ state: 'visible' });
}

async function setExemplar(page: Page, id: string) {
  const idInput = page.locator('input.ge-id');
  await idInput.fill(id);
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: '+ Drop' }).click();
  await page.locator('.ge-picker').waitFor({ state: 'visible' });
}

async function pickPrimitive(page: Page, name: string) {
  await openPicker(page);
  await page.locator('.ge-picker-search').fill(name);
  // Pick exact match
  await page.locator('.ge-pick', { hasText: new RegExp(`^${name}$`) }).first().click();
}

async function pickCsg(page: Page, op: 'subtract' | 'add' | 'intersect') {
  await openPicker(page);
  await page.locator('.ge-pick.csg', { hasText: op }).click();
}

async function callCount(page: Page): Promise<number> {
  return await page.locator('.ge-node-bg.call').count();
}

async function methodCount(page: Page): Promise<number> {
  return await page.locator('.ge-node-bg.method').count();
}

async function paramChipCount(page: Page): Promise<number> {
  return await page.locator('.ge-param-card').count();
}

async function addParam(page: Page, name: string, defaultValue: number) {
  // Click + param canvas button (the dashed amber rect).
  await page.locator('.ge-param-add-bg').click();
  await page.locator('.ge-wire-pop input[type="text"]').fill(name);
  await page.locator('.ge-wire-pop input[type="number"]').fill(String(defaultValue));
  await page.locator('.ge-wire-pop button', { hasText: 'add' }).click();
  await page.locator('.ge-wire-pop').waitFor({ state: 'detached' });
}

/** Drag from one element's center to another's center via mouse events.
 *  Used for the canvas socket → socket wire mechanic. */
async function dragBetween(page: Page, from: Locator, to: Locator) {
  const f = await from.boundingBox();
  const t = await to.boundingBox();
  if (!f || !t) throw new Error('socket missing bounding box');
  const fx = f.x + f.width / 2;
  const fy = f.y + f.height / 2;
  const tx = t.x + t.width / 2;
  const ty = t.y + t.height / 2;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  // Multi-step move so the drag overlay animation has time to track.
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(fx + ((tx - fx) * i) / 6, fy + ((ty - fy) * i) / 6, { steps: 2 });
  }
  await page.mouse.move(tx, ty);
  await page.mouse.up();
}

// ─── smoke ──────────────────────────────────────────────────────────────

test.describe('graph-editor — smoke', () => {
  test('loads with empty canvas + working title bar', async ({ page }) => {
    await openEditor(page);
    // Headline elements present.
    await expect(page.locator('.ge-bar h1')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Drop' })).toBeVisible();
    await expect(page.locator('.ge-bar', { hasText: /Save/ })).toBeVisible();
    // Canvas hint + zero nodes.
    await expect(page.locator('.ge-canvas-hint')).toContainText('+ Drop');
    expect(await callCount(page)).toBe(0);
    expect(await methodCount(page)).toBe(0);
    expect(await paramChipCount(page)).toBe(0);
  });

  test('drops a Call → source pane reflects it', async ({ page }) => {
    await openEditor(page);
    await pickPrimitive(page, 'dt_shaft');
    // One Call card on the canvas.
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    // The title shows the alias + src.
    await expect(page.locator('.ge-node-title').first()).toContainText('A · dt_shaft');
    // Source pane updates to include the function call.
    await expect(page.locator('.ge-source')).toContainText('dt_shaft(');
    await expect(page.locator('.ge-source')).toContainText("alias: 'A'");
  });

  test('+ param adds a chip to the canvas', async ({ page }) => {
    await openEditor(page);
    await addParam(page, 'outerOD', 4);
    await expect(page.locator('.ge-param-card')).toHaveCount(1);
    await expect(page.locator('.ge-param-card-name')).toContainText('p.outerOD');
    // Inline value input has the default.
    await expect(page.locator('.ge-param-card-input')).toHaveValue('4');
    // Source pane includes the param in meta.params.
    await expect(page.locator('.ge-source')).toContainText('outerOD');
  });

  test('inline param value edit re-bakes', async ({ page }) => {
    await openEditor(page);
    await addParam(page, 'outerOD', 4);
    await pickPrimitive(page, 'dt_shaft');
    const input = page.locator('.ge-param-card-input').first();
    await input.fill('6.5');
    // Source pane reflects the new default in meta.params (params: { outerOD: { default: 6.5 } }).
    await expect(page.locator('.ge-source')).toContainText('default: 6.5');
  });

  test('reset clears the canvas', async ({ page }) => {
    await openEditor(page);
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    expect(await callCount(page)).toBe(2);
    await page.getByRole('button', { name: 'Reset' }).click();
    expect(await callCount(page)).toBe(0);
  });
});

// ─── build (mule_shoe-ish) — generates a real .asm.ts via the UI ────────

test.describe('graph-editor — generates parts via UI', () => {
  test('builds_dt_box_with_param_wired and saves to volume', async ({ page }) => {
    test.setTimeout(40_000);
    await openEditor(page);
    await setExemplar(page, 'test_graph_built');

    // 1. Drop a Call.
    await pickPrimitive(page, 'dt_shaft');
    expect(await callCount(page)).toBe(1);

    // 2. Add an outer param.
    await addParam(page, 'outerR', 1.5);
    expect(await paramChipCount(page)).toBe(1);

    // 3. Wire the param chip → A.r via drag from param output socket
    //    onto A's r input socket. The 'r' arg is the first row of the
    //    Call card, so its input socket is the first .ge-sock.in.param.
    const paramOut = page.locator('.ge-param-card .ge-sock.out.param');
    const callArgIn = page.locator('.ge-node-bg.call ~ .ge-sock.in.param, .ge-sock.in.param').first();
    await dragBetween(page, paramOut, callArgIn);

    // 4. Source should show p.outerR in the call's r arg.
    await expect(page.locator('.ge-source')).toContainText('p.outerR');

    // 5. Save → status confirms write to basic/.
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('.ge-save-stat')).toContainText(/saved to basic\//);

    // 6. Verify via API — the file exists with the expected source.
    const r = await page.request.get('/api/primitives/source?name=test_graph_built');
    expect(r.ok()).toBe(true);
    const data = await r.json();
    expect(data.source).toContain('test_graph_built');
    expect(data.source).toContain('graph: {');
    expect(data.source).toContain('p.outerR');
  });
});
