/**
 * E2E tests for the per-instance CSG-op selector.
 *
 * The selector is a leftmost icon on each instance accordion head in
 * the `/components` inspector:
 *   - +  → geom.add(<inst>)        (union, the default)
 *   - −  → geom.subtract(<inst>)   (cut out of running accumulator)
 *   - ∩  → geom.intersect(<inst>)  (overlap-only)
 *
 * State persists in `<volume>/library/<cat>/<id>/meta.json` as
 * `instanceOps[<inst>]`. The loader (component-loader.ts) rewrites
 * `geom.add(<inst>);` calls at execute time based on this map — so
 * the source on disk stays additive and only the executed mesh
 * changes when the user flips an op.
 *
 * Two assertions:
 *
 *   1. **Persistence** — POST instanceOps to /api/components/save,
 *      then GET /api/components/list and confirm the part's
 *      `instanceOps` field round-tripped.
 *
 *   2. **Mesh delta** — render the same part with op='add' vs
 *      op='subtract' for instance B and confirm the rendered mesh
 *      differs (subtract cuts a hole, so the position-buffer shape
 *      MUST differ from the union form).
 *
 * Test artifact: a uniquely-named part lands in `library/test/` and
 * the directory is rm -rf'd in afterAll.
 */

import { test, expect } from '@playwright/test';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd();
const LIBRARY_TEST_DIR = join(ROOT, 'library', 'test');

// Unique id per run keeps tests isolated even if a previous one crashed.
const PART_ID = `e2e_instance_ops_${Date.now()}`;
const PART_DIR = join(LIBRARY_TEST_DIR, PART_ID);

// Two-instance source: A is a big cube, B is a smaller cube intersecting
// it. With A.add + B.add → union (volume = A∪B). With A.add + B.subtract
// → cube-with-bite (volume = A\B). Picking distinct sizes makes the
// rendered-mesh delta easy to confirm via position-count + bounding box.
const SOURCE = `
import { M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: '${PART_ID}',
  name: 'E2E Instance Ops',
  description: '',
  tags: [],
  params: {},
} as const;

export const geom = defineGeom(meta, (_p, geom) => {
  const A = M.cube([4, 4, 4], true);
  geom.add(A);
  const B = M.cube([2, 2, 6], true);
  geom.add(B);
});
`;

test.describe.serial('per-instance CSG op selector', () => {
  test.beforeAll(async () => {
    // Seed the library directly (skips the GUI create flow — this
    // suite only exercises the op-selection layer, not creation).
    await mkdir(PART_DIR, { recursive: true });
    await writeFile(join(PART_DIR, 'component.ts'), SOURCE, 'utf8');
  });

  test.afterAll(async () => {
    await rm(PART_DIR, { recursive: true, force: true }).catch(() => {});
  });

  test('POST /api/components/save persists instanceOps to meta.json', async ({ request }) => {
    // Save with B → subtract. The endpoint merges into meta.json
    // (best-effort) and returns ok.
    const save = await request.post('/api/components/save', {
      data: {
        id: PART_ID,
        source: SOURCE,
        instanceOps: { B: 'subtract' },
      },
    });
    expect(save.status(), `save failed: ${await save.text().catch(() => '?')}`).toBe(200);
    const body = await save.json();
    expect(body.ok).toBe(true);

    // List should surface the persisted ops field.
    const list = await request.get('/api/components/list');
    expect(list.status()).toBe(200);
    const entries = await list.json();
    const part = entries.find((e: any) => e.id === PART_ID);
    expect(part, 'part should be in list').toBeTruthy();
    expect(part.instanceOps, 'instanceOps field should round-trip').toEqual({ B: 'subtract' });
  });

  test('loader rewrites geom.add → geom.subtract; rendered mesh differs', async ({ request }) => {
    // Render with default ops (no instanceOps set on B → 'add').
    // Reset the part first so this test is order-independent.
    const reset = await request.post('/api/components/save', {
      data: { id: PART_ID, source: SOURCE, instanceOps: {} },
    });
    expect(reset.status()).toBe(200);

    const renderUnion = await request.post('/api/components/geom', {
      data: { id: PART_ID, params: {} },
    });
    expect(renderUnion.status(), `union render failed: ${await renderUnion.text().catch(() => '?')}`).toBe(200);
    const union = await renderUnion.json();
    expect(union.full?.positions?.length, 'union positions non-empty').toBeGreaterThan(0);
    const unionPosCount = union.full.positions.length;

    // Flip B to subtract → save invalidates the loader cache + the
    // loader's op-rewrite changes geom.add(B) to geom.subtract(B).
    const flip = await request.post('/api/components/save', {
      data: { id: PART_ID, source: SOURCE, instanceOps: { B: 'subtract' } },
    });
    expect(flip.status()).toBe(200);

    const renderSub = await request.post('/api/components/geom', {
      data: { id: PART_ID, params: {} },
    });
    expect(renderSub.status(), `subtract render failed: ${await renderSub.text().catch(() => '?')}`).toBe(200);
    const sub = await renderSub.json();
    expect(sub.full?.positions?.length, 'subtract positions non-empty').toBeGreaterThan(0);

    // A∪B and A\B have different topologies — the position buffer
    // length WILL differ. (Even if it didn't, the actual triangles
    // would; comparing lengths is the cheapest valid signal.)
    expect(
      sub.full.positions.length,
      'subtract mesh must differ from union mesh — loader op rewrite is the only thing that can change it',
    ).not.toBe(unionPosCount);
  });

  test('UI: leftmost op-icon button is present on instance accordion (renderMode=server)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/components');
    // Wait for the sidebar to populate from /api/components/list.
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 });

    // The part name is "E2E Instance Ops" — open it as a tab.
    const sidebarBtn = page.locator('.sidebar').getByRole('button', { name: 'E2E Instance Ops', exact: true });
    await expect(sidebarBtn).toBeVisible({ timeout: 10_000 });
    await sidebarBtn.click();
    await expect(page.locator('.stage-name')).toContainText('E2E Instance Ops', { timeout: 5_000 });

    // The Parts inspector tab is the default for xml-primitives (see
    // inspectorTab init), so instance accordions are already rendered.
    // If the default ever changes, an explicit Parts click can be added
    // back here.

    // The op-icon button has data-instance="B" set so we can target it
    // unambiguously without depending on accordion ordering.
    const opBtnB = page.locator('button.pg-acc-op[data-instance="B"]');
    await expect(opBtnB, 'op-icon button should render on instance B accordion head').toBeVisible({ timeout: 5_000 });

    // After the previous test set B=subtract, the head should reflect it.
    await expect(opBtnB).toHaveAttribute('data-op', 'subtract');

    expect(errors, 'no runtime errors').toEqual([]);
  });
});
