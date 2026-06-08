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
  // Click the + rounded button in the Params card title bar. The button uses
  // onpointerdown (not click) AND can sit behind the bake pane at narrow
  // widths — dispatchEvent fires the handler directly.
  await page.locator('circle.ge-params-add-btn').dispatchEvent('pointerdown',
    { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.locator('.ge-wire-pop input[type="text"]').fill(name);
  await page.locator('.ge-wire-pop input[type="number"]').fill(String(defaultValue));
  await page.locator('.ge-wire-pop button', { hasText: 'add' }).click();
  await page.locator('.ge-wire-pop').waitFor({ state: 'detached' });
}

/** Drag from one element's center to another's center.
 *
 *  Strategy: dispatch pointerdown DIRECTLY on the source element + pointerup
 *  DIRECTLY on the target element via .dispatchEvent(). Browser-native mouse
 *  hit-testing inside SVG circles is unreliable when the circle is small
 *  (radius 4–6) and the page is zoomed — by dispatching on the locator we
 *  guarantee the handlers fire on the right elements.
 *
 *  Mouse position is still moved so the editor's wireMouse state tracks
 *  during the drag (cosmetic bezier rendering, not required for state).
 */
async function dragBetween(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const f = await from.boundingBox();
  const t = await to.boundingBox();
  if (!f || !t) throw new Error('socket missing bounding box');
  const fx = f.x + f.width / 2;
  const fy = f.y + f.height / 2;
  const tx = t.x + t.width / 2;
  const ty = t.y + t.height / 2;

  await page.mouse.move(fx, fy);
  await from.dispatchEvent('pointerdown', { button: 0, clientX: fx, clientY: fy, pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.mouse.move(tx, ty, { steps: 10 });
  await to.dispatchEvent('pointerup', { button: 0, clientX: tx, clientY: ty, pointerId: 1, pointerType: 'mouse', bubbles: true });
}

// ─── smoke ──────────────────────────────────────────────────────────────

test.describe('graph-editor — smoke', () => {
  test('loads with empty canvas + working title bar', async ({ page }) => {
    await openEditor(page);
    // Headline elements present.
    await expect(page.locator('.ge-bar h1')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Drop' })).toBeVisible();
    await expect(page.locator('.ge-bar', { hasText: /Save/ })).toBeVisible();
    // Canvas hint + zero nodes. Two .ge-canvas-hint elements render in the
    // empty state (one for params, one for nodes); pick the +Drop one.
    await expect(page.locator('.ge-canvas-hint', { hasText: '+ Drop' })).toBeVisible();
    expect(await callCount(page)).toBe(0);
    expect(await methodCount(page)).toBe(0);
    expect(await paramChipCount(page)).toBe(0);
  });

  test('drops a Call → source pane reflects it', async ({ page }) => {
    await openEditor(page);
    await pickPrimitive(page, 'dt_shaft');
    // One Call card on the canvas.
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    // The title shows the alias + src. Scope to the Call card — the ▶ Output
    // root-list card ALSO has a .ge-node-title now.
    await expect(
      page.locator('g.ge-node:has(rect.ge-node-bg.call) text.ge-node-title').first(),
    ).toContainText('A · dt_shaft');
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
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(0);
  });
});

// ─── build (mule_shoe-ish) — generates a real .asm.ts via the UI ────────

// ─── Phase 1 acceptance — mv axis param wiring ──────────────────────────
//
// The user-confirmed flow from 2026-06-06 — every step here corresponds 1:1
// to a step in the manual verification list. If a step fails, the
// regression is structural; the GUI lost a piece of the param→transform
// wiring contract.
//
// Run visually with: PWHEAD=1 bun run test:graph:headed
//   — slow_mo 250 ms lets you watch every click + drag.

test.describe('graph-editor — phase 1: mv axis param wiring', () => {
  test('p.outerOD → A.mv.z renders + bakes end-to-end', async ({ page }) => {
    test.setTimeout(40_000);
    await openEditor(page);
    await setExemplar(page, 'test_phase1_mv_wire');

    // Step 1 — drop a Call (dt_box).
    await pickPrimitive(page, 'dt_box');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    await expect(
      page.locator('g.ge-node:has(rect.ge-node-bg.call) text.ge-node-title').first(),
    ).toContainText('A · dt_box');

    // Step 2 — toggle ⇄ on the Call card. The toggle is an SVG <text>
    // with class .ge-xform-btn and the glyph ⇄.
    const mvToggle = page.locator('.ge-xform-btn', { hasText: '⇄' }).first();
    await expect(mvToggle).toBeVisible();
    await mvToggle.click({ position: { x: 5, y: 5 } });
    // The inline mv label appears in the card.
    await expect(page.locator('.ge-inline-label', { hasText: 'mv' })).toBeVisible();

    // Step 3 — three tiny amber axis sockets appear on the LEFT edge.
    const axisSockets = page.locator('.ge-sock.in.param.tiny');
    await expect(axisSockets).toHaveCount(3);

    // Step 0 of params — add the dial we'll wire from.
    await addParam(page, 'outerOD', 4);
    await expect(page.locator('.ge-param-card')).toHaveCount(1);

    // Step 4 — drag from param output socket → release on mv.z (3rd axis socket).
    const paramOut = page.locator('.ge-param-card .ge-sock.out.param').first();
    const mvZ = axisSockets.nth(2); // z is index 2
    await dragBetween(page, paramOut, mvZ);

    // Step 5 — z slot now renders as the amber p.outerOD chip with × to unwire.
    const zChip = page.locator('.ge-inline-xform.mv .ge-arg-pchip', { hasText: 'p.outerOD' });
    await expect(zChip).toBeVisible();
    await expect(zChip.locator('.ge-arg-pchip-x')).toBeVisible();

    // Step 6 — a param wire bezier renders (class .ge-wire.param). At least
    // one — there could be more if other args got wired too.
    await expect(page.locator('path.ge-wire.param')).toHaveCount(1);

    // Step 7 — emitted source contains `mv(A, [0, 0, p.outerOD])` (or
    // equivalent — exact spacing is up to the emitter, but the call shape
    // is invariant).
    await expect(page.locator('.ge-source')).toContainText('p.outerOD');
    // The mv() function call should sit in the function body.
    await expect(page.locator('.ge-source')).toContainText(/mv\(\s*A,\s*\[/);

    // Step 8 — editing the param's default value drives a re-bake.
    // The param chip's foreignObject input — we fill via .ge-param-card-input.
    const defaultInput = page.locator('.ge-param-card-input').first();
    await defaultInput.fill('6.5');
    // Source pane reflects the new default.
    await expect(page.locator('.ge-source')).toContainText('default: 6.5');

    // Sanity — unwiring restores a literal slot + drops the wire from canvas.
    await zChip.locator('.ge-arg-pchip-x').click();
    await expect(page.locator('.ge-inline-xform.mv .ge-arg-pchip')).toHaveCount(0);
    await expect(page.locator('path.ge-wire.param')).toHaveCount(0);
  });
});

// ─── Phase 2 acceptance — CSG composition (drag-wire two Calls into a method) ─
//
// Drops two Calls A and B, drops a ⊖ subtract method node, drag-wires
// A's output to method.obj and B's output to method.arg, then asserts:
//   • both wires render (red for obj, amber for arg)
//   • source emits A.subtract(B) somewhere in the function body
//   • bake pane shows no error (canvas mounts or is still loading)
//
// Then repeats for add (⊕) and intersect (⊗) as quick variants — covers
// the full CSG family without redundant assertion bloat.
//
// Run visually: PWHEAD=1 bun run test:graph:headed -- --grep 'phase 2'

test.describe('graph-editor — phase 2: CSG composition', () => {
  for (const { op, glyph, wireClass, methodCall } of [
    { op: 'subtract'  as const, glyph: '⊖', wireClass: 'arg', methodCall: 'subtract' },
    { op: 'add'       as const, glyph: '⊕', wireClass: 'arg', methodCall: 'add' },
    { op: 'intersect' as const, glyph: '⊗', wireClass: 'arg', methodCall: 'intersect' },
  ]) {
    test(`A ${glyph} B (${op}) — drag-wire renders + emits source`, async ({ page }) => {
      test.setTimeout(40_000);
      await openEditor(page);
      await setExemplar(page, `test_phase2_${op}`);

      // Step 1 — drop two Calls.
      await pickPrimitive(page, 'dt_box');
      await pickPrimitive(page, 'dt_pin');
      await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

      // Step 2 — drop a method node for this op.
      await pickCsg(page, op);
      await expect(page.locator('.ge-node-bg.method')).toHaveCount(1);

      // Step 3 — drag A's output socket → method.obj input socket.
      const callAGroup  = page.locator('g.ge-node:has(rect.ge-node-bg.call)').first();
      const callAOut    = callAGroup.locator('circle.ge-sock.out');
      const methodGroup = page.locator('g.ge-node:has(rect.ge-node-bg.method)').first();
      const methodObj   = methodGroup.locator('circle.ge-sock.in.obj');
      await dragBetween(page, callAOut, methodObj);
      await expect(page.locator('path.ge-wire.obj')).toHaveCount(1);

      // Step 4 — drag B's output → method.arg.
      const callBGroup = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(1);
      const callBOut   = callBGroup.locator('circle.ge-sock.out');
      const methodArg  = methodGroup.locator('circle.ge-sock.in.arg');
      await dragBetween(page, callBOut, methodArg);
      await expect(page.locator(`path.ge-wire.${wireClass}`)).toHaveCount(1);

      // Step 5 — source contains A.<op>(B).
      const callRe = new RegExp(`A\\.${methodCall}\\(B\\)`);
      await expect(page.locator('.ge-source')).toContainText(callRe);

      // Step 6 — bake pane has no error (canvas mounting OR baking are both OK).
      await expect(page.locator('.ge-bake-pane .ge-err')).toHaveCount(0);
    });
  }
});

// ─── Phase 3 acceptance — save round-trip ───────────────────────────────
//
// Builds a small graph, clicks Save, fetches the saved .asm.ts via the
// /api/primitives/source endpoint, and asserts the on-disk source carries
// the meta.graph + meta.params + the wired-param emit pattern.
//
// Doubles as a part generator — `test_phase3_save.asm.ts` lands on the
// volume on every passing run.
//
// Run visually: PWHEAD=1 bun run test:graph:headed -- --grep 'phase 3'

test.describe('graph-editor — phase 3: save round-trip', () => {
  test('build → save → re-fetch — disk file has meta.graph + p.outerR wire', async ({ page }) => {
    test.setTimeout(40_000);
    await openEditor(page);
    const exId = 'test_phase3_save';
    await setExemplar(page, exId);

    // Build a small graph: one Call, one param, wired.
    await pickPrimitive(page, 'dt_shaft');
    await addParam(page, 'outerR', 1.5);
    const paramOut    = page.locator('.ge-param-card .ge-sock.out.param').first();
    const callAGroup  = page.locator('g.ge-node:has(rect.ge-node-bg.call)').first();
    const callAArg0   = callAGroup.locator('circle.ge-sock.in.param:not(.tiny)').first();
    await dragBetween(page, paramOut, callAArg0);

    // Click Save → status confirms.
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('.ge-save-stat')).toContainText(/saved to basic\//);

    // Re-fetch via API — verify the source file round-tripped.
    const r = await page.request.get(`/api/primitives/source?name=${exId}`);
    expect(r.ok()).toBe(true);
    const data = await r.json();

    // The on-disk meta object MUST carry:
    //   1. a graph JSON literal — proof the new architecture is the on-disk format
    //   2. the wired param — proof the visual edit reached disk faithfully
    //   3. the param schema in meta.params for runtime resolution
    expect(data.source).toContain('graph: {');
    expect(data.source).toMatch(/outerR/);
    expect(data.source).toContain('p.outerR');
    expect(data.params).toBeDefined();
    expect(Object.keys(data.params)).toContain('outerR');
  });
});

// ─── Phase 4 acceptance — shared dial across multiple Calls ────────────
//
// Drops two instances of the same primitive (A and B = dt_shaft), adds
// p.outerR, drag-wires BOTH Calls' first arg to the same param, edits the
// dial. Verifies:
//   • two param wires render on canvas
//   • both Calls show the p.outerR chip
//   • source contains p.outerR TWICE (once per Call's args block)
//   • editing the dial bubbles through (source's params.outerR.default changes)
//
// Run visually: PWHEAD=1 bun run test:graph:headed -- --grep 'phase 4'

test.describe('graph-editor — phase 4: shared dial across multiple Calls', () => {
  test('A.r + B.r both wired to p.outerR — single dial', async ({ page }) => {
    test.setTimeout(40_000);
    await openEditor(page);
    await setExemplar(page, 'test_phase4_shared');

    // Two dt_shaft Calls — A and B.
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

    // Add the dial.
    await addParam(page, 'outerR', 1.5);

    // Wire A.r → p.outerR.
    const paramOut = page.locator('.ge-param-card .ge-sock.out.param').first();
    const callA    = page.locator('g.ge-node:has(rect.ge-node-bg.call)').first();
    const callB    = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(1);
    const aArg0    = callA.locator('circle.ge-sock.in.param:not(.tiny)').first();
    const bArg0    = callB.locator('circle.ge-sock.in.param:not(.tiny)').first();
    await dragBetween(page, paramOut, aArg0);
    await expect(page.locator('path.ge-wire.param')).toHaveCount(1);

    // Wire B.r → p.outerR.
    await dragBetween(page, paramOut, bArg0);
    await expect(page.locator('path.ge-wire.param')).toHaveCount(2);

    // Both Call cards carry a p.outerR chip in their first arg row.
    await expect(callA.locator('.ge-arg-pchip', { hasText: 'p.outerR' })).toBeVisible();
    await expect(callB.locator('.ge-arg-pchip', { hasText: 'p.outerR' })).toBeVisible();

    // Edit the dial — both Calls should keep referencing p.outerR (the literal
    // value bubbles through the param resolution at bake time).
    const defaultInput = page.locator('.ge-param-card-input').first();
    await defaultInput.fill('7.5');
    await expect(page.locator('.ge-source')).toContainText('default: 7.5');

    // p.outerR appears AT LEAST TWICE in the emitted source — once per
    // Call's args block.
    const src = await page.locator('.ge-source').textContent();
    const occurrences = (src?.match(/p\.outerR/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

test.describe('graph-editor — generates parts via UI', () => {
  test('builds_dt_box_with_param_wired and saves to volume', async ({ page }) => {
    test.setTimeout(40_000);
    await openEditor(page);
    await setExemplar(page, 'test_graph_built');

    // 1. Drop a Call.
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);

    // 2. Add an outer param.
    await addParam(page, 'outerR', 1.5);
    await expect(page.locator('.ge-param-card')).toHaveCount(1);

    // 3. Wire the param chip → A.r via drag from param output socket
    //    onto A's r input socket (the first NON-TINY param-input on A's left edge).
    const paramOut = page.locator('.ge-param-card .ge-sock.out.param').first();
    const callA    = page.locator('g.ge-node:has(rect.ge-node-bg.call)').first();
    const callArgIn = callA.locator('circle.ge-sock.in.param:not(.tiny)').first();
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

// ─── Phase 5 — vocabulary replication (dt_tube) ──────────────────────────
//
// This is the first proof that the new graph editor can express the
// vocabulary's canonical compose pattern: A.subtract(B) where each arg
// is either a literal, a param wire, or a free-text expression
// (e.g. `p.od / 2 - p.wall`). Matches the on-disk shape of `dt_tube`
// (the vocab term `tube` translated to a flat .asm.ts).
//
// If this test passes, the graph editor is structurally capable of
// expressing every K.68 vocab compose-rule. The next slice can either
//   (a) port the rule-translator to emit meta.graph natively, OR
//   (b) leave the translator alone and use the editor as the authoring
//       surface for new vocab terms.

test.describe('graph-editor — phase 5: vocab replication (dt_tube)', () => {
  test('rebuilds dt_tube — A.subtract(B) with expressions + shared length param', async ({ page }) => {
    test.setTimeout(60_000);
    await openEditor(page);
    await setExemplar(page, 'dt_tube_v2');

    // ── 1. Add params: od (outer dia), wall, length — vocab `tube` schema.
    await addParam(page, 'od', 4.5);
    await addParam(page, 'wall', 0.5);
    await addParam(page, 'length', 3);
    await expect(page.locator('.ge-param-card')).toHaveCount(3);

    // ── 2. Drop two dt_shaft Calls — A (outer body), B (inner bore).
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

    const callA = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(0);
    const callB = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(1);

    // ── 3. A.r := expression `p.od / 2` — flip the r-arg to expr mode + fill.
    //    Arg rows render in meta.params order (dt_shaft: r, len, segments)
    //    so .nth(0) targets the r row.
    //    `dispatchEvent('click')` routes the event directly to the ƒ button
    //    bypassing the 3D bake pane that can intercept pointer events when the
    //    Call card overlaps with it at small viewport widths. Same pattern as
    //    dragBetween for SVG wires — we're testing data flow, not actionability.
    const aRowR = callA.locator('.ge-arg-row').nth(0);
    await aRowR.locator('.ge-arg-fx').dispatchEvent('click');
    await aRowR.locator('input.ge-arg-input.expr').fill('p.od / 2', { force: true });

    // ── 4. Wire p.length output → A.len input (socket index 1).
    const pLenOut = page.locator('.ge-param-card', { hasText: 'length' })
      .locator('circle.ge-sock.out.param').first();
    const aLenIn = callA.locator('circle.ge-sock.in.param:not(.tiny)').nth(1);
    await dragBetween(page, pLenOut, aLenIn);

    // ── 5. B.r := expression `p.od / 2 - p.wall` — inner bore radius.
    const bRowR = callB.locator('.ge-arg-row').nth(0);
    await bRowR.locator('.ge-arg-fx').dispatchEvent('click');
    await bRowR.locator('input.ge-arg-input.expr').fill('p.od / 2 - p.wall', { force: true });

    // ── 6. Wire p.length → B.len.
    const bLenIn = callB.locator('circle.ge-sock.in.param:not(.tiny)').nth(1);
    await dragBetween(page, pLenOut, bLenIn);

    // ── 7. Drop the subtract method node.
    await pickCsg(page, 'subtract');
    await expect(page.locator('.ge-node-bg.method')).toHaveCount(1);

    // ── 8. Wire A → method.obj (subject) and B → method.arg (cutter).
    const method = page.locator('g.ge-node:has(rect.ge-node-bg.method)').first();
    const aOut   = callA.locator('circle.ge-sock.out:not(.in)').first();
    const bOut   = callB.locator('circle.ge-sock.out:not(.in)').first();
    const mObj   = method.locator('circle.ge-sock.in.obj').first();
    const mArg   = method.locator('circle.ge-sock.in.arg').first();
    await dragBetween(page, aOut, mObj);
    await dragBetween(page, bOut, mArg);

    // ── 9. Source assertions — the live source pane has the full vocab pattern.
    const src = page.locator('.ge-source');
    await expect(src).toContainText(/A\.subtract\(B\)/);
    await expect(src).toContainText('p.od / 2');
    await expect(src).toContainText('p.od / 2 - p.wall');
    await expect(src).toContainText('p.length');

    // ── 10. No bake error.
    await expect(page.locator('.ge-err')).toHaveCount(0);

    // ── 11. Save → volume.
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('.ge-save-stat')).toContainText(/saved to basic\//);

    // ── 12. Fetch back from volume; the on-disk source carries:
    //       (a) meta.graph block (proof of new format)
    //       (b) kind: 'expr' for the two r-args
    //       (c) kind: 'param' for the len wires
    //       (d) all three params in the params schema.
    const r = await page.request.get('/api/primitives/source?name=dt_tube_v2');
    expect(r.ok()).toBe(true);
    const data = await r.json();
    expect(data.source).toContain('graph: {');
    expect(data.source).toMatch(/kind:\s*['"]expr['"]/);
    expect(data.source).toMatch(/kind:\s*['"]param['"]/);
    expect(data.source).toContain('p.od / 2');
    expect(data.source).toContain('p.od / 2 - p.wall');
    expect(data.params?.od).toBeTruthy();
    expect(data.params?.wall).toBeTruthy();
    expect(data.params?.length).toBeTruthy();
    // Function signature must take `p` since the body references p.od + p.wall
    // + p.length — without it, the loader can't evaluate the assembly.
    // (Render-correctness is covered by the in-editor .ge-err assertion above.)
    expect(data.source).toMatch(/export function dt_tube_v2\(p\)/);
  });
});

// ─── Phase 6 — URL load (?id=<...>) + legacy banner ──────────────────────
//
// Two cases:
//   (a) Loading dt_tube_v2 (built by phase 5) hydrates the canvas — 2 Calls,
//       1 method, the right expressions, the right params. Proves round-trip
//       through the serialize → save → hydrate path.
//   (b) Loading dt_tube (the LEGACY text-format part on the volume, no
//       meta.graph) surfaces the amber legacy banner. Proves the editor
//       refuses to silently translate; the user knows when they're on
//       legacy ground.

test.describe('graph-editor — phase 6: URL load + legacy banner', () => {
  test('hydrates dt_tube_v2 from ?id= URL param — full graph rebuilt', async ({ page }) => {
    test.setTimeout(30_000);
    // Direct navigation with the load param. The phase 5 test must have run
    // earlier in the same suite to deposit dt_tube_v2.asm.ts on the volume.
    await page.goto('/graph-editor?id=dt_tube_v2');
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
    await page.locator('.ge-canvas').waitFor({ state: 'visible' });

    // 1. Exemplar id picked up from the URL.
    await expect(page.locator('input.ge-id')).toHaveValue('dt_tube_v2');

    // 2. Two Call cards + one method node (A.subtract(B)).
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);
    await expect(page.locator('.ge-node-bg.method')).toHaveCount(1);

    // 3. Three params on the canvas.
    await expect(page.locator('.ge-param-card')).toHaveCount(3);

    // 4. The expression args round-tripped — visible as ƒ-styled inputs.
    await expect(page.locator('input.ge-arg-input.expr').first()).toHaveValue('p.od / 2');

    // 5. No bake error — the hydrated graph compiles + previews.
    await expect(page.locator('.ge-err')).toHaveCount(0);

    // 6. Live source pane mirrors the loaded graph.
    await expect(page.locator('.ge-source')).toContainText(/A\.subtract\(B\)/);
    await expect(page.locator('.ge-source')).toContainText('p.od / 2');
    await expect(page.locator('.ge-source')).toContainText('p.od / 2 - p.wall');

    // 7. No legacy banner — meta.graph is present.
    await expect(page.locator('.ge-legacy-banner')).toHaveCount(0);
  });

  test('shows legacy banner when ?id= points at a part without meta.graph', async ({ page }) => {
    test.setTimeout(30_000);
    // Phase 14 regenerates dt_tube into graph format — so to test the legacy
    // banner reliably we own the fixture: write a hand-crafted text-body
    // source (no meta.graph block) to a dedicated id, then load.
    const legacyId = 'dt_test_legacy_banner';
    const legacySource = `
export const meta = {
  id: '${legacyId}',
  name: '${legacyId}',
  kind: 'asm',
  uses: ['dt_shaft'],
  params: {
    r: { default: 2, min: 0.5, max: 10, step: 0.05 },
    len: { default: 3, min: 0.5, max: 20, step: 0.1 },
  },
};

export function ${legacyId}(p) {
  return dt_shaft(p.r, p.len);
}
`.trim();

    const save = await page.request.post('/api/primitives/save', {
      data: { id: legacyId, source: legacySource, kind: 'asm', dir: 'basic' },
    });
    expect(save.ok()).toBe(true);

    await page.goto(`/graph-editor?id=${legacyId}`);
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);

    // 1. Exemplar id picked up from the URL.
    await expect(page.locator('input.ge-id')).toHaveValue(legacyId);

    // 2. Canvas stays empty — no node cards hydrated.
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(0);
    await expect(page.locator('.ge-node-bg.method')).toHaveCount(0);

    // 3. Amber legacy banner surfaced above the source pane.
    await expect(page.locator('.ge-legacy-banner')).toBeVisible();
    await expect(page.locator('.ge-legacy-banner')).toContainText(legacyId);
    await expect(page.locator('.ge-legacy-banner')).toContainText('legacy');
  });
});

// ─── Phase 14 — translator round-trip (vocab.json → graph editor) ────────
//
// The K.68 authoring loop closes here. The rule-translator now emits
// meta.graph as its default for compose rules (kind:'asm'). Regenerating
// a term via /api/vocab/regenerate writes a graph-format part to the
// volume; loading via /graph-editor?id= then hydrates it.
//
// Before Phase 14: regen wrote a text body → /graph-editor showed the
// amber legacy banner.
// After  Phase 14: regen writes meta.graph → /graph-editor hydrates +
// shows the actual composition.

test.describe('graph-editor — phase 14: vocab.json → translator → editor', () => {
  test('regenerates `tube` as meta.graph + hydrates in the editor', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Regenerate the `tube` vocab term — this now emits meta.graph by default.
    //    The endpoint returns `{ ok, regenerated: [{term, bake}], failures }`
    //    after filtering — successful runs land in regenerated[], errors in failures[].
    const regen = await page.request.post('/api/vocab/regenerate?term=tube');
    expect(regen.ok()).toBe(true);
    const regenJson = await regen.json();
    expect(regenJson.ok).toBe(true);
    expect(regenJson.regenerated?.[0]?.term).toBe('tube');
    expect(regenJson.regenerated?.[0]?.bake?.verts).toBeGreaterThan(0);
    expect(regenJson.failures ?? []).toHaveLength(0);

    // 2. Fetch the regenerated source — verify it carries the new format.
    const srcResp = await page.request.get('/api/primitives/source?name=dt_tube');
    expect(srcResp.ok()).toBe(true);
    const srcData = await srcResp.json();
    expect(srcData.source).toContain('graph: {');
    expect(srcData.source).toMatch(/alias:\s*['"]A['"]/);
    expect(srcData.source).toMatch(/alias:\s*['"]B['"]/);
    expect(srcData.source).toMatch(/op:\s*['"]subtract['"]/);
    expect(srcData.source).toContain('p.od / 2');
    expect(srcData.source).toContain('p.od/2 - p.wall');
    expect(srcData.source).toMatch(/export function dt_tube\(p\)/);

    // 3. Load in /graph-editor — canvas should hydrate, NO legacy banner.
    await page.goto('/graph-editor?id=dt_tube');
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
    await expect(page.locator('input.ge-id')).toHaveValue('dt_tube');

    // 4. Two Call cards + one method node — A.subtract(B) shape.
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);
    await expect(page.locator('.ge-node-bg.method')).toHaveCount(1);

    // 5. Three params — od, wall, length.
    await expect(page.locator('.ge-param-card')).toHaveCount(3);

    // 6. Expression args round-tripped — first ƒ input shows `p.od / 2`.
    await expect(page.locator('input.ge-arg-input.expr').first()).toHaveValue('p.od / 2');

    // 7. NO legacy banner — Phase 6b's banner case is closed for tube now.
    await expect(page.locator('.ge-legacy-banner')).toHaveCount(0);

    // 8. No bake error — the hydrated graph compiles + renders.
    await expect(page.locator('.ge-err')).toHaveCount(0);
  });
});

// ─── Phase 10 — multi-axis wiring on a single transform ─────────────────
//
// Three params bound to the three xyz axes of an inline mv. Each axis
// chip becomes its own param-wire — no slot can be wired to two params,
// no two slots wired to the same param accidentally. The source emits
// `mv(A, [p.x, p.y, p.z])` proving the three wires reached the three
// distinct slots.

test.describe('graph-editor — phase 10: multi-axis wiring on a transform', () => {
  test('p.x/y/z → mv.x/y/z on a single Call — three separate wires + chips', async ({ page }) => {
    test.setTimeout(45_000);
    await openEditor(page);
    await setExemplar(page, 'test_phase10_xyz');

    // 1. Three params: x, y, z (defaults 0, 0, 3).
    await addParam(page, 'x', 0);
    await addParam(page, 'y', 0);
    await addParam(page, 'z', 3);
    await expect(page.locator('.ge-param-card')).toHaveCount(3);

    // 2. Drop one Call + toggle inline mv on it.
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    const callA = page.locator('g.ge-node:has(rect.ge-node-bg.call)').first();
    await callA.locator('text.ge-xform-btn').nth(0).dispatchEvent('pointerdown',
      { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true });
    await expect(callA.locator('.ge-inline-label')).toHaveText(/mv/);

    // 3. The Call card now has 3 tiny axis sockets on its LEFT edge (one per xyz).
    const tinySockets = callA.locator('circle.ge-sock.in.param.tiny');
    await expect(tinySockets).toHaveCount(3);

    // 4. Wire each param to its matching axis. Param-card outputs are in
    //    creation order (x, y, z); axis sockets are top-to-bottom (x, y, z).
    //    A param-card is an SVG <g> with multiple <text>/<input>/<circle>
    //    children, so hasText:'^p.x$' fails (aggregates ALL text). Filter
    //    via a sub-locator on the name <text> instead.
    const paramByName = (name: string) =>
      page.locator('g.ge-param-card')
        .filter({ has: page.locator('text.ge-param-card-name', { hasText: new RegExp(`^p\\.${name}$`) }) })
        .locator('circle.ge-sock.out.param').first();
    const paramX = paramByName('x');
    const paramY = paramByName('y');
    const paramZ = paramByName('z');
    await dragBetween(page, paramX, tinySockets.nth(0));
    await dragBetween(page, paramY, tinySockets.nth(1));
    await dragBetween(page, paramZ, tinySockets.nth(2));

    // 5. Three wires render — one per axis.
    await expect(page.locator('path.ge-wire.param')).toHaveCount(3);

    // 6. Three chips on the mv card (the inline mv block shows
    //    `p.x` / `p.y` / `p.z` in the xyz slots).
    const mvBlock = callA.locator('.ge-inline-xform.mv');
    await expect(mvBlock.locator('.ge-arg-pchip')).toHaveCount(3);
    await expect(mvBlock.locator('.ge-arg-pchip', { hasText: 'p.x' })).toHaveCount(1);
    await expect(mvBlock.locator('.ge-arg-pchip', { hasText: 'p.y' })).toHaveCount(1);
    await expect(mvBlock.locator('.ge-arg-pchip', { hasText: 'p.z' })).toHaveCount(1);

    // 7. Source emits `mv(A, [p.x, p.y, p.z])` — proves all 3 axes resolved.
    const src = page.locator('.ge-source');
    await expect(src).toContainText(/mv\(\s*A,\s*\[/);
    await expect(src).toContainText('p.x');
    await expect(src).toContainText('p.y');
    await expect(src).toContainText('p.z');

    // 8. No bake error.
    await expect(page.locator('.ge-err')).toHaveCount(0);
  });
});

// ─── Phase 11 — param schema drift detection ─────────────────────────────
//
// When the underlying primitive's params change behind a saved assembly's
// back, the editor surfaces a ⚠ drift badge on the affected Call. Clicking
// it syncs the Call's args to the primitive's CURRENT param shape
// (preserving values where keys survive, filling new keys with defaults,
// dropping orphans).
//
// The test scripts the full life-cycle: write a target with [r, len],
// build a graph that uses it, save; rewrite the target with [r, len, tag];
// reload — ⚠ visible. Click it — args refresh. Source now references `tag`.

test.describe('graph-editor — phase 11: param schema drift', () => {
  test('rewriting a primitive marks its consumers drifted; refresh syncs them', async ({ page }) => {
    test.setTimeout(60_000);
    const targetId = 'test_phase11_target';
    const graphId  = 'test_phase11_graph';

    // ── 1. v1 target: params { r, len }.
    const targetV1 = `
export const meta = {
  id: '${targetId}',
  name: '${targetId}',
  kind: 'prim',
  uses: [],
  params: {
    r:   { default: 1.5, min: 0.1, max: 5, step: 0.05 },
    len: { default: 4,   min: 0.5, max: 20, step: 0.1 },
  },
};
export function ${targetId}(r, len) {
  return r_cylinder(r, len, 32);
}
`.trim();
    const saveV1 = await page.request.post('/api/primitives/save', {
      data: { id: targetId, source: targetV1, kind: 'prim', dir: 'basic' },
    });
    expect(saveV1.ok()).toBe(true);

    // ── 2. Build a graph that uses targetId. Save it.
    await openEditor(page);
    await setExemplar(page, graphId);
    await pickPrimitive(page, targetId);
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    // No drift yet — the target's params match the dropped Call's args.
    await expect(page.locator('.ge-drift-btn')).toHaveCount(0);
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('.ge-save-stat')).toContainText(/saved to basic\//);

    // ── 3. v2 target: params { r, len, tag } — tag is the NEW param.
    const targetV2 = `
export const meta = {
  id: '${targetId}',
  name: '${targetId}',
  kind: 'prim',
  uses: [],
  params: {
    r:   { default: 1.5, min: 0.1, max: 5, step: 0.05 },
    len: { default: 4,   min: 0.5, max: 20, step: 0.1 },
    tag: { default: 0.5, min: 0,   max: 2,  step: 0.05 },
  },
};
export function ${targetId}(r, len, tag) {
  // tag unused for now — the test just cares about schema drift.
  return r_cylinder(r, len, 32);
}
`.trim();
    const saveV2 = await page.request.post('/api/primitives/save', {
      data: { id: targetId, source: targetV2, kind: 'prim', dir: 'basic' },
    });
    expect(saveV2.ok()).toBe(true);

    // ── 4. Reload the saved graph — drift badge should appear after the
    //    editor's $effect fetches the target's NEW params.
    await page.goto(`/graph-editor?id=${graphId}`);
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);

    // Drift badge surfaces once the async fetch completes.
    await expect(page.locator('text.ge-drift-btn')).toBeVisible();

    // ── 5. Click ⚠ — args refresh to match v2's [r, len, tag].
    await page.locator('text.ge-drift-btn').dispatchEvent('pointerdown',
      { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true });

    // Badge clears (no more drift).
    await expect(page.locator('text.ge-drift-btn')).toHaveCount(0);

    // ── 6. The Call card now has 3 arg rows (was 2 before refresh).
    const callA = page.locator('g.ge-node:has(rect.ge-node-bg.call)').first();
    await expect(callA.locator('.ge-arg-row')).toHaveCount(3);

    // ── 7. Source contains the new `tag` arg name.
    await expect(page.locator('.ge-source')).toContainText(/tag\s*:/);
  });
});

// ─── Phase 13 — CSG chain (A ⊖ B ⊖ C) ────────────────────────────────────
//
// Three Calls + two subtract methods chained: A.subtract(B).subtract(C).
// Tests that the second method's `obj` socket can wire from the first
// method's output — proving transitive output→input wiring across CSG
// nodes. Without that, multi-step CSG (the common case for real parts)
// can't be built.

test.describe('graph-editor — phase 13: CSG chain A ⊖ B ⊖ C', () => {
  test('two chained subtracts emit A.subtract(B).subtract(C)', async ({ page }) => {
    test.setTimeout(45_000);
    await openEditor(page);
    await setExemplar(page, 'test_phase13_csg_chain');

    // 1. Three Calls A, B, C.
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(3);

    const callA = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(0);
    const callB = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(1);
    const callC = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(2);

    // 2. Two subtract methods.
    await pickCsg(page, 'subtract');
    await pickCsg(page, 'subtract');
    await expect(page.locator('.ge-node-bg.method')).toHaveCount(2);

    const method1 = page.locator('g.ge-node:has(rect.ge-node-bg.method)').nth(0);
    const method2 = page.locator('g.ge-node:has(rect.ge-node-bg.method)').nth(1);

    // 3. Wire chain: A → M1.obj, B → M1.arg, M1 → M2.obj, C → M2.arg.
    const aOut = callA.locator('circle.ge-sock.out:not(.in)').first();
    const bOut = callB.locator('circle.ge-sock.out:not(.in)').first();
    const cOut = callC.locator('circle.ge-sock.out:not(.in)').first();
    const m1Obj = method1.locator('circle.ge-sock.in.obj').first();
    const m1Arg = method1.locator('circle.ge-sock.in.arg').first();
    const m1Out = method1.locator('circle.ge-sock.out:not(.in)').first();
    const m2Obj = method2.locator('circle.ge-sock.in.obj').first();
    const m2Arg = method2.locator('circle.ge-sock.in.arg').first();
    await dragBetween(page, aOut, m1Obj);
    await dragBetween(page, bOut, m1Arg);
    await dragBetween(page, m1Out, m2Obj);
    await dragBetween(page, cOut, m2Arg);

    // 4. Source contains the chained subtraction. The emit pattern uses
    //    intermediate vars, so we look for both methods + the chain shape.
    const src = page.locator('.ge-source');
    await expect(src).toContainText(/A\.subtract\(B\)/);
    // M2's obj is M1's output (the var name varies but the second subtract
    // must reference that intermediate result + C as the arg).
    await expect(src).toContainText(/\.subtract\(\s*C\s*\)/);

    // 5. No bake error — the full chain compiles.
    await expect(page.locator('.ge-err')).toHaveCount(0);
  });
});

// ─── Phase 9 — inline transforms compose with CSG ────────────────────────
//
// Toggling ⇄ on a Call wraps it in an inline mv. When that Call's output
// then feeds a method, the method's subject is the TRANSFORMED result —
// not the bare Call. Emit becomes `mv(A, [0,0,N]).subtract(B)` rather
// than `A.subtract(B)`. Tests the "inline xform survives downstream wiring"
// contract; without the same-card-output-uses-wrapper-id fix, the mv would
// stand orphaned in the source and the cut would happen in the wrong frame.

test.describe('graph-editor — phase 9: inline transforms compose with CSG', () => {
  test('⇄ mv on A + ⊖ subtract B emits mv(A, [...]).subtract(B)', async ({ page }) => {
    test.setTimeout(45_000);
    await openEditor(page);
    await setExemplar(page, 'test_phase9_mv_csg');

    // 1. Two dt_shaft Calls A + B.
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

    const callA   = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(0);
    const callB   = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(1);

    // 2. Toggle ⇄ on A — inline mv block appears inside A's card.
    //    .ge-xform-btn renders BOTH ⇄ and ↻ as siblings; nth(0) = ⇄.
    //    Uses onpointerdown (NOT onclick), so dispatchEvent('pointerdown')
    //    fires the handler directly — sidesteps any bake-pane hit-test.
    await callA.locator('text.ge-xform-btn').nth(0).dispatchEvent('pointerdown',
      { button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true });
    await expect(callA.locator('.ge-inline-label')).toHaveText(/mv/);

    // 3. Edit mv.z to 3 — the third axis input on the inline mv block.
    const mvZ = callA.locator('.ge-inline-xform.mv .ge-arg-row').nth(2).locator('input.ge-arg-input');
    await mvZ.fill('3', { force: true });

    // 4. Drop a ⊖ subtract method node.
    await pickCsg(page, 'subtract');
    await expect(page.locator('.ge-node-bg.method')).toHaveCount(1);

    // 5. Wire A.out → method.obj and B.out → method.arg. A.out now reports
    //    the inline mv's id (not A's), so the wire targets the wrapper.
    const method = page.locator('g.ge-node:has(rect.ge-node-bg.method)').first();
    const aOut   = callA.locator('circle.ge-sock.out:not(.in)').first();
    const bOut   = callB.locator('circle.ge-sock.out:not(.in)').first();
    const mObj   = method.locator('circle.ge-sock.in.obj').first();
    const mArg   = method.locator('circle.ge-sock.in.arg').first();
    await dragBetween(page, aOut, mObj);
    await dragBetween(page, bOut, mArg);

    // 6. Source has the transformed subject + the cutter.
    const src = page.locator('.ge-source');
    await expect(src).toContainText(/mv\(\s*A,/);
    await expect(src).toContainText(/\.subtract\(/);
    // The method's obj should be the mv variable, not bare A.
    await expect(src).toContainText(/subtract\(\s*B\s*\)/);
    // Source carries the z=3 offset.
    await expect(src).toContainText(/\b3\b/);

    // 7. No bake error — the mv-wrapped subtraction compiles end-to-end.
    await expect(page.locator('.ge-err')).toHaveCount(0);
  });
});

// ─── Phase 8 — /vocab embeds the graph editor in an iframe panel ─────────
//
// The chip now toggles an inline iframe panel below the term-detail header
// (mounts /graph-editor?id=<exemplar>&embed=1). The iframe's embed=1 mode
// hides the SvelteKit nav inside so the iframe is just the editor chrome.
// Phase 14's dt_tube graph format hydrates inside the iframe — the user
// stays in /vocab the whole time.

test.describe('graph-editor — phase 8: /vocab inline iframe embed', () => {
  test('toggling 🧬 Graph editor opens an iframe + the editor hydrates inside', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/vocab');
    await expect(page.locator('.vocab-bar')).toBeVisible();

    // 1. Open Browse + select `tube` (whose exemplar dt_tube is graph format after Phase 14).
    await page.locator('.left-tab', { hasText: 'Browse' }).click();
    await page.locator('.browser-row', { hasText: 'tube' }).first().click();

    // 2. No iframe panel by default.
    await expect(page.locator('.vocab-graph-embed')).toHaveCount(0);

    // 3. Click the 🧬 Graph editor button (now a toggle, not a link).
    await page.locator('button.head-graph-link').click();

    // 4. Embed panel appears; iframe has the right src.
    const embed = page.locator('.vocab-graph-embed');
    await expect(embed).toBeVisible();
    await expect(embed.locator('iframe.vge-iframe')).toHaveAttribute('src', /\/graph-editor\?id=dt_tube&embed=1/);

    // 5. Switch into the iframe and verify the editor hydrated inside it.
    const frame = page.frameLocator('iframe.vge-iframe');
    await expect(frame.locator('.ge-canvas')).toBeVisible();
    await expect(frame.locator('.ge-node-bg.call')).toHaveCount(2);
    await expect(frame.locator('.ge-node-bg.method')).toHaveCount(1);
    await expect(frame.locator('.ge-param-card')).toHaveCount(3);

    // 6. The global SvelteKit nav-menu-wrapper is hidden inside the iframe.
    await expect(frame.locator('#nav-menu-wrapper')).toBeHidden();

    // 7. Closing the panel via ✕ removes the iframe.
    await page.locator('.vge-close').click();
    await expect(embed).toHaveCount(0);
  });
});

// ─── Phase 15 — stack composition (sub / xover / joint) hydrates ─────────
//
// Vocab terms `sub`, `xover`, `joint` all use `kind:'stack'` composition
// — end-to-end mate via manifold-helpers.stack(). Phase 14 wired the
// translator's graph emit path for `call` / `method` / `mv` / `list`;
// Phase 15 widens it to `stack`, closing the gap. After this lands, all
// 4 K.68 compose-rule assemblies (tube + sub + xover + joint) regen as
// graph format and hydrate in the editor.

test.describe('graph-editor — phase 15: stack composition round-trip', () => {
  test('regenerates `sub` as graph format + hydrates (3 Calls + stack node)', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Regenerate `sub` — should now emit graph format, NOT fall back to text.
    const regen = await page.request.post('/api/vocab/regenerate?term=sub');
    expect(regen.ok()).toBe(true);
    const data = await regen.json();
    expect(data.ok).toBe(true);
    expect(data.regenerated?.[0]?.format).toBe('graph');
    // Bake numbers should match the historical text-format output —
    // ~8640 verts, z≈19.25 for the box+pin stack.
    expect(data.regenerated?.[0]?.bake?.verts).toBeGreaterThan(5000);
    expect(data.regenerated?.[0]?.bake?.z_extent).toBeGreaterThan(15);

    // 2. Fetch the saved source — verify it carries the stack-array form.
    const srcResp = await page.request.get('/api/primitives/source?name=dt_sub');
    expect(srcResp.ok()).toBe(true);
    const srcData = await srcResp.json();
    expect(srcData.source).toContain('graph: {');
    // Emit MUST use the array form `stack([A, B])` — positional `stack(A, B)`
    // collapses to an empty manifold (the helper signature is array-of-children).
    expect(srcData.source).toMatch(/stack\(\[/);

    // 3. Load in /graph-editor — canvas hydrates with the box + pin Calls
    //    + the stack container. NO legacy banner.
    await page.goto('/graph-editor?id=dt_sub');
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
    await expect(page.locator('input.ge-id')).toHaveValue('dt_sub');

    // Two Call cards (box + pin). The stack container itself is a list-like
    // node — it currently has no visible card on the canvas (renders only
    // its children + the stack(...) expression in source).
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

    // No legacy banner — graph block was present + hydrated cleanly.
    await expect(page.locator('.ge-legacy-banner')).toHaveCount(0);

    // No bake error either — the hydrated graph compiles + renders.
    await expect(page.locator('.ge-err')).toHaveCount(0);
  });
});

// ─── Phase 18 — layout persists across save → reload ────────────────────
//
// Without this, every reload snapped nodes back to the default-grid
// auto-layout — defeating any careful arrangement the user made. Now
// serialiseGraph includes `layout` in meta.graph, and hydrateGraph reads
// it back (falling through to defaults only for nodes that don't have
// a saved entry — keeps legacy files working).

test.describe('graph-editor — phase 18: layout persists across reload', () => {
  test('drag a node, save, reload — node lands at the same x, not the default grid', async ({ page }) => {
    test.setTimeout(45_000);
    await openEditor(page);
    await setExemplar(page, 'test_phase18_layout');

    // 1. Drop two Calls + 1 method so there's a layout to remember.
    await pickPrimitive(page, 'dt_shaft');
    await pickPrimitive(page, 'dt_shaft');
    await pickCsg(page, 'subtract');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

    // 2. Drag the FIRST Call far to the right (+ 300, + 80). The default
    //    grid would have placed it at x≈80; we'll move it to ~380.
    const callA = page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(0);
    const before = await callA.boundingBox();
    if (!before) throw new Error('callA has no bounding box');
    await page.mouse.move(before.x + before.width / 2, before.y + 12);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 300, before.y + 12 + 80, { steps: 8 });
    await page.mouse.up();
    const after = await callA.boundingBox();
    if (!after) throw new Error('callA has no bounding box after drag');
    expect(after.x - before.x).toBeGreaterThan(200);

    // Capture the post-drag x to compare after the reload.
    const xAfterDrag = after.x;

    // 3. Save the graph.
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('.ge-save-stat')).toContainText(/saved to basic\//);

    // 4. Reload via URL — fresh page, fresh hydrate.
    await page.goto('/graph-editor?id=test_phase18_layout');
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(2);

    // 5. The reloaded card lands at (about) the same x — NOT back at the
    //    default-grid position. Tolerance ±25 px to absorb any sub-pixel
    //    rounding / scroll differences.
    const reloaded = await page.locator('g.ge-node:has(rect.ge-node-bg.call)').nth(0).boundingBox();
    if (!reloaded) throw new Error('reloaded callA has no bounding box');
    expect(Math.abs(reloaded.x - xAfterDrag)).toBeLessThan(25);

    // 6. Saved source has a `layout: {` block — proves the data path.
    const r = await page.request.get('/api/primitives/source?name=test_phase18_layout');
    expect(r.ok()).toBe(true);
    const data = await r.json();
    expect(data.source).toMatch(/layout:\s*\{/);
  });
});

// ─── Phase 17 — repeat composition (stand) hydrates ─────────────────────
//
// Closes the LAST K.68 rule-shape gap. The `stand` vocab term uses
// `kind:'repeat'` with `count: 'p.n'` + a child Call. Phase 15 added
// `stack` to ruleToGraph; Phase 17 adds `repeat`. After this, every
// BUILD_ORDER term (13 / 13) regens as the correct format and
// hydrates / bakes cleanly.

test.describe('graph-editor — phase 17: repeat composition (stand)', () => {
  test('regenerates `stand` as graph format + 3× joint stacks correctly', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Regenerate `stand` — should emit graph format, NOT throw or fall back.
    const regen = await page.request.post('/api/vocab/regenerate?term=stand');
    expect(regen.ok()).toBe(true);
    const data = await regen.json();
    expect(data.ok).toBe(true);
    expect(data.regenerated?.[0]?.format).toBe('graph');
    // 3 joints stacked. Each joint ≈ 11328 verts, so the stack should be
    // close to 33984. z_extent ≈ 3 * 49.25 = 147.75.
    expect(data.regenerated?.[0]?.bake?.verts).toBeGreaterThan(30000);
    expect(data.regenerated?.[0]?.bake?.z_extent).toBeGreaterThan(140);

    // 2. Source has the Array.from + stack repeat idiom.
    const srcResp = await page.request.get('/api/primitives/source?name=dt_stand');
    expect(srcResp.ok()).toBe(true);
    const srcData = await srcResp.json();
    expect(srcData.source).toContain('graph: {');
    expect(srcData.source).toMatch(/stack\(\s*Array\.from\(/);
    // The count is `p.n` — proves the param wire reached the repeat node.
    expect(srcData.source).toContain('p.n');

    // 3. Load in /graph-editor — canvas hydrates, no legacy banner, no bake error.
    await page.goto('/graph-editor?id=dt_stand');
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
    await expect(page.locator('input.ge-id')).toHaveValue('dt_stand');

    // One Call card (J = joint). The repeat container itself isn't a Call
    // and renders differently; the Call count is the child Call.
    await expect(page.locator('.ge-node-bg.call')).toHaveCount(1);
    await expect(page.locator('.ge-legacy-banner')).toHaveCount(0);
    await expect(page.locator('.ge-err')).toHaveCount(0);
  });
});

// ─── Phase 7 — /vocab → /graph-editor cross-page launch ──────────────────
//
// The K.69 vocab GUI gains a 🧬 Graph editor link per term — click it and
// you arrive at the graph editor with the term's exemplar pre-loaded.
// This is the user-facing integration: 'go from "I'm looking at the tube
// vocabulary entry" → "I'm editing tube's graph" in one click'.

test.describe('graph-editor — phase 7: /vocab launches the graph editor', () => {
  test('selecting a term in /vocab shows the graph-editor link + navigates correctly', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/vocab');
    await expect(page.locator('.vocab-bar')).toBeVisible();

    // 1. Open the Browse tab (the term list — Topology is the Mermaid graph).
    await page.locator('.left-tab', { hasText: 'Browse' }).click();

    // 2. Select the `tube` term — its exemplar is dt_tube, the canonical
    //    compose example used by the rule-translator. Click the row directly.
    await page.locator('.browser-row', { hasText: 'tube' }).first().click();

    // 3. The 🧬 Graph editor toggle appears in the term detail header.
    //    (Was an <a> link before Phase 8; now a <button> that opens an
    //    inline iframe panel — Phase 8 covers that flow. This test asserts
    //    the cross-page launch is still available via the panel's open-full link.)
    const toggle = page.locator('button.head-graph-link');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Graph editor');

    // 4. Click the toggle → embed panel appears with an "open full" link
    //    that holds the cross-page href. Navigate via that link.
    await toggle.click();
    const fullLink = page.locator('.vge-link');
    await expect(fullLink).toHaveAttribute('href', /\/graph-editor\?id=dt_/);
    const href = await fullLink.getAttribute('href');
    await page.goto(href!);

    // 5. Lands on /graph-editor with the exemplar pre-filled.
    await expect(page.locator('.ge-bar h1')).toHaveText(/Graph editor/);
    await expect(page.locator('input.ge-id')).toHaveValue(/^dt_/);

    // 6. Either hydrates or shows the legacy banner — both are acceptable;
    //    this test cares that the cross-page contract holds, not which
    //    branch the loaded part hits.
    const hasNodes  = await page.locator('.ge-node-bg.call').count();
    const hasBanner = await page.locator('.ge-legacy-banner').count();
    expect(hasNodes + hasBanner).toBeGreaterThan(0);
  });
});
