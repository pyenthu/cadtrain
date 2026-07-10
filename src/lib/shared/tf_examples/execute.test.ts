import { describe, it, expect } from 'vitest';
import { executeTfRecipe, recipeHasUnsupported, TfUnsupportedError } from './execute';
import type { TfRecipe, TfInstr } from '$lib/cad/graph-to-tf';

/**
 * PURE executor tests — a MOCK `t` (plain object recording every kernel call)
 * stands in for the 31 MB TrueForm WASM kernel, so we prove {@link executeTfRecipe}
 * WALKS a recipe into the right tf ops (revolve/box/cylinder/boolean/transform)
 * without loading tf. The mock's boolean ops return `{ mesh }` and its matrix ops
 * expose `.matMul`, matching the real tf API the demos use; every mesh handle
 * carries the minimal fields `tfResult`/`tfAnalyze` read so the finalise step runs.
 */

function makeMockTf() {
  const calls: { fn: string; args: any[] }[] = [];
  const rec = (fn: string, ...args: any[]) => { calls.push({ fn, args }); };
  let idc = 0;
  // A fake mesh handle — enough for tfMeshData (points/faces .data) + tfAnalyze
  // (numberOf*, and t.isClosed/... below). `transformation` starts null so the
  // executor's applyTransform takes the fresh-mesh branch.
  const handle = (tag: string, extra: Record<string, any> = {}) => ({
    __tag: tag,
    __id: idc++,
    numberOfFaces: 12,
    numberOfPoints: 8,
    points: { data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
    faces: { data: new Int32Array([0, 1, 2]) },
    transformation: null as any,
    ...extra,
  });
  // A fake transform matrix with a chainable matMul (records the compose).
  const mat = (tag: string): any => ({
    __mat: tag,
    matMul(other: any) { rec('matMul', tag, other?.__mat); return mat(`${tag}∘${other?.__mat ?? '?'}`); },
  });

  const t: any = {
    calls,
    boxMesh: (w: number, h: number, d: number) => { rec('boxMesh', w, h, d); return handle('box'); },
    cylinderMesh: (r: number, hgt: number, s: number) => { rec('cylinderMesh', r, hgt, s); return handle('cyl'); },
    tubeMesh: (curve: any, radius: number, segs: number) => { rec('tubeMesh', curve, radius, segs); return handle('tube'); },
    // buildOpenCurve plumbing (trueform-client) — record + return opaque handles.
    ndarray: (data: any, shape: any) => { rec('ndarray', data, shape); return { __nd: true, data, shape }; },
    offsetBlockedBuffer: (offsets: any, data: any) => { rec('offsetBlockedBuffer', offsets, data); return { __obb: true }; },
    curves: (blocks: any, pts: any) => { rec('curves', blocks, pts); return { __curve: true }; },
    mesh: (faces: any, points: any) => { rec('mesh', faces, points); return handle('mesh'); },
    booleanDifference: (obj: any, arg: any) => { rec('booleanDifference', obj, arg); return { mesh: handle('diff', { obj, arg }) }; },
    booleanUnion: (obj: any, arg: any) => { rec('booleanUnion', obj, arg); return { mesh: handle('union', { obj, arg }) }; },
    booleanIntersection: (obj: any, arg: any) => { rec('booleanIntersection', obj, arg); return { mesh: handle('inter', { obj, arg }) }; },
    makeTranslation: (x: number, y: number, z: number) => { rec('makeTranslation', x, y, z); return mat('T'); },
    makeRotation: (deg: number, axis: string) => { rec('makeRotation', deg, axis); return mat(`R${axis}`); },
    positivelyOriented: (m: any) => { rec('positivelyOriented', m); return m; },
    // topology predicates tfAnalyze reads (finalise step)
    isClosed: () => true,
    isManifold: () => true,
    eulerCharacteristic: () => 2,
    boundaryPaths: () => ({ length: 0 }),
    signedVolume: () => 1,
    volume: () => 3.14,
  };
  return t;
}

const recipe = (instrs: TfInstr[]): TfRecipe => ({ instrs, notes: [] });
/** A resolvable half-section (≥ 3 points → a real lathe). */
const SQUARE: [number, number][] = [[1, 0], [1, 2], [0.5, 2], [0.5, 0]];

describe('executeTfRecipe', () => {
  it('walks a revolve recipe → lathes via t.mesh + orients + finalises', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([{ op: 'revolve', profile: SQUARE, segments: 8 }]));
    const fns = t.calls.map((c: any) => c.fn);
    // revolve lowers through tfRevolveProfile → t.mesh(faces, points) + positivelyOriented.
    expect(fns).toContain('mesh');
    expect(fns).toContain('positivelyOriented');
    expect(fns).not.toContain('boxMesh');
    // finalise ran → a TfDemoResult with tf's verdict.
    expect(out.stats.closed).toBe(true);
    expect(out.stats.volume).toBeCloseTo(3.14, 5);
  });

  it('walks a box recipe → boxMesh(w,h,d)', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([{ op: 'box', w: 3, h: 4, d: 5 }]));
    const box = t.calls.find((c: any) => c.fn === 'boxMesh');
    expect(box?.args).toEqual([3, 4, 5]);
  });

  it('walks a subtract recipe → booleanDifference with the two BUILT operands', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'booleanDifference',
        obj: { op: 'box', w: 2, h: 2, d: 2 },
        arg: { op: 'cylinder', radius: 1, height: 3, segments: 16 } },
    ]));
    const diff = t.calls.filter((c: any) => c.fn === 'booleanDifference');
    expect(diff).toHaveLength(1);
    // obj was the built box, arg the built cylinder (the executor recurses first).
    expect(diff[0].args[0].__tag).toBe('box');
    expect(diff[0].args[1].__tag).toBe('cyl');
  });

  it('folds an EXPLICIT union recipe → booleanUnion once per extra child', () => {
    // A single `{op:'union'}` root instr is an explicit grouping/union request →
    // buildInstr STILL folds it (this is the "explicit union/add still folds" case;
    // only SEPARATE top-level roots stop folding — see the next test).
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'union', children: [
        { op: 'box', w: 1, h: 1, d: 1 },
        { op: 'box', w: 2, h: 2, d: 2 },
        { op: 'box', w: 3, h: 3, d: 3 },
      ] },
    ]));
    // 3 children → 2 folds.
    const unions = t.calls.filter((c: any) => c.fn === 'booleanUnion');
    expect(unions).toHaveLength(2);
    expect(t.calls.filter((c: any) => c.fn === 'boxMesh')).toHaveLength(3);
  });

  it('emits multiple ROOT outputs as SEPARATE parts (NO booleanUnion fold)', () => {
    // The behaviour change: the recipe's unconsumed roots are DISTINCT bodies, so
    // they are concatenated (flat vertex append), never union-folded — mirroring
    // Manifold's finalizeSeparateParts, and removing the w_multi_string coincident-
    // face trap (9 concentric tubes whose union aborts TF's mesh boolean).
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([
      { op: 'box', w: 1, h: 1, d: 1 },
      { op: 'box', w: 2, h: 2, d: 2 },
    ]));
    // No top-level fold at all.
    expect(t.calls.filter((c: any) => c.fn === 'booleanUnion')).toHaveLength(0);
    expect(t.calls.filter((c: any) => c.fn === 'boxMesh')).toHaveLength(2);
    // Both parts' render meshes are concatenated into `data`: the mock box carries
    // 3 verts (9 floats) + 3 face indices, so 2 boxes → 18 floats / 6 indices, and
    // the 2nd box's indices are offset by the 1st box's 3 vertices.
    expect(out.data.points.length).toBe(18);
    expect(out.data.faces.length).toBe(6);
    expect(Array.from(out.data.faces)).toEqual([0, 1, 2, 3, 4, 5]);
    // A whole-assembly verdict is still reported (aggregated from the parts).
    expect(out.stats.closed).toBe(true);
  });

  it('recipe.compose:true RE-ENABLES the fold for multiple root outputs (opt-in)', () => {
    // The Priority-2 opt-in: a graph whose ROOT container sets `compose` lowers to
    // `recipe.compose=true`, which restores the historical union-fold.
    const t = makeMockTf();
    const r: TfRecipe = { ...recipe([
      { op: 'box', w: 1, h: 1, d: 1 },
      { op: 'box', w: 2, h: 2, d: 2 },
    ]), compose: true };
    executeTfRecipe(t, t, r);
    // 2 roots → 1 fold when composed.
    expect(t.calls.filter((c: any) => c.fn === 'booleanUnion')).toHaveLength(1);
  });

  it('applies a translate as makeTranslation on the built child', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'translate', offset: [1, 2, 3], child: { op: 'box', w: 1, h: 1, d: 1 } },
    ]));
    const tr = t.calls.find((c: any) => c.fn === 'makeTranslation');
    expect(tr?.args).toEqual([1, 2, 3]);
  });

  it('composes a rotate as one makeRotation per non-zero axis, matMul-ed', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'rotate', deg: [45, 0, 90], child: { op: 'box', w: 1, h: 1, d: 1 } },
    ]));
    const rots = t.calls.filter((c: any) => c.fn === 'makeRotation');
    // x + z axes are non-zero (y is 0 → skipped); the two are matMul-composed.
    expect(rots.map((c: any) => c.args[1])).toEqual(['x', 'z']);
    expect(t.calls.some((c: any) => c.fn === 'matMul')).toBe(true);
  });

  it('walks a sweep recipe → tubeMesh(curve, radius, radialSegments) over the built curve', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'sweep', path: [[0, 0, 0], [0, 0, 1], [0, 0, 2]], radius: 0.6, radialSegments: 24, capped: true },
    ]));
    const tube = t.calls.find((c: any) => c.fn === 'tubeMesh');
    expect(tube).toBeTruthy();
    expect(tube.args[1]).toBe(0.6);   // radius
    expect(tube.args[2]).toBe(24);    // radialSegments
    // curve was built first (buildOpenCurve → curves over the flat point buffer).
    expect(t.calls.some((c: any) => c.fn === 'curves')).toBe(true);
  });

  it('a curved-hollow-tube recipe (sweep − sweep) walks two tubeMesh + one booleanDifference', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'booleanDifference',
        obj: { op: 'sweep', path: [[0, 0, 0], [0, 0, 2]], radius: 0.6, radialSegments: 32, capped: true },
        arg: { op: 'sweep', path: [[0, 0, 0], [0, 0, 2]], radius: 0.5, radialSegments: 32, capped: true } },
    ]));
    expect(t.calls.filter((c: any) => c.fn === 'tubeMesh')).toHaveLength(2);
    expect(t.calls.filter((c: any) => c.fn === 'booleanDifference')).toHaveLength(1);
  });

  it('throws TfUnsupportedError when executing an UNSUPPORTED node', () => {
    const t = makeMockTf();
    expect(() => executeTfRecipe(t, t, recipe([{ op: 'UNSUPPORTED', nodeType: 'call:r_loft' }])))
      .toThrow(TfUnsupportedError);
  });
});

/**
 * A BBOX-AWARE mock kernel for the MATED-STACK test. The real TrueForm WASM boolean
 * kernel can't run in the vitest node env (no cross-origin isolation / SharedArrayBuffer
 * — see mandrel.test.ts), so we can't `ensureTf`. Instead we drive the executor with a
 * mock whose meshes carry REAL geometry: `t.mesh(faces, points)` (called by
 * `tfRevolveProfile`) returns a handle whose `points.data` is the actual pure
 * `buildRevolveMesh` output → real per-child Z-extents. The mock matrix is a pure
 * Z-translation (matMul sums), and `booleanUnion` bakes each operand's transform into a
 * merged handle spanning the combined WORLD Z-range — exactly the extent bookkeeping the
 * real kernel does. So `executeTfRecipe`'s final mesh reports the true stacked Z-extent,
 * letting us prove the children are placed END-TO-END, not overlapped at the origin. */
function makeBboxMockTf() {
  const calls: { fn: string; args: any[] }[] = [];
  const rec = (fn: string, ...args: any[]) => { calls.push({ fn, args }); };
  const handle = (points: Float32Array, tag: string) => ({
    __tag: tag,
    numberOfFaces: 12,
    numberOfPoints: points.length / 3,
    points: { data: points },
    faces: { data: new Int32Array([0, 1, 2]) },
    transformation: null as any,
  });
  // Pure Z-translation matrix (only z matters for a Z-stack); matMul composes by summing.
  const mat = (z: number): any => ({ __tz: z, matMul(other: any) { return mat(z + (other?.__tz ?? 0)); } });
  const worldZ = (mesh: any): [number, number] => {
    const d = mesh.points.data as Float32Array;
    const tz = mesh.transformation?.__tz ?? 0;
    let mn = Infinity, mx = -Infinity;
    for (let i = 2; i < d.length; i += 3) { const z = d[i] + tz; if (z < mn) mn = z; if (z > mx) mx = z; }
    return [mn, mx];
  };
  const t: any = {
    calls,
    // tfRevolveProfile → buildRevolveMesh (pure) → t.mesh(faces, points): keep the real points.
    mesh: (faces: any, points: Float32Array) => { rec('mesh', faces, points); return handle(points, 'rev'); },
    makeTranslation: (x: number, y: number, z: number) => { rec('makeTranslation', x, y, z); return mat(z); },
    makeRotation: (deg: number, axis: string) => { rec('makeRotation', deg, axis); return mat(0); },
    // Bake both operands' world Z-range into the merged handle (transform → null).
    booleanUnion: (a: any, b: any) => {
      rec('booleanUnion', a, b);
      const [amn, amx] = worldZ(a), [bmn, bmx] = worldZ(b);
      const mn = Math.min(amn, bmn), mx = Math.max(amx, bmx);
      return { mesh: handle(new Float32Array([0, 0, mn, 1, 0, mx, 0, 1, (mn + mx) / 2]), 'union') };
    },
    positivelyOriented: (m: any) => { rec('positivelyOriented', m); return m; },
    isClosed: () => true,
    isManifold: () => true,
    eulerCharacteristic: () => 0, // a stack of bored tubes → one genus-1 solid (χ=0)
    boundaryPaths: () => ({ length: 0 }),
    signedVolume: () => 1,
    volume: () => 42,
  };
  return t;
}

/** Half-section (r,z) revolving to a bored genus-1 tube of local Z-extent [0, len]. */
const boredSection = (len: number): [number, number][] => [[3, 0], [3, len], [1.7, len], [1.7, 0]];
/** [minZ, maxZ] of a mesh's world vertex buffer (post-finalise, transforms baked). */
function pointsZExtent(points: Float32Array): [number, number] {
  let mn = Infinity, mx = -Infinity;
  for (let i = 2; i < points.length; i += 3) { const z = points[i]; if (z < mn) mn = z; if (z > mx) mx = z; }
  return [mn, mx];
}

describe('executeTfRecipe — mated stack (g_dp_joint bug)', () => {
  // g_dp_joint-shaped: box (z 0..6) + tube (z 0..25) + pin (z 0..7), each a bored
  // revolve authored at its OWN local origin. The bug: a plain union piles all three
  // at z=0 (total extent = the longest child, 25) so the pin is buried inside the tube.
  const BOX = 6, TUBE = 25, PIN = 7;
  const SUM = BOX + TUBE + PIN; // 38 — the end-to-end total
  const matedRecipe: TfRecipe = recipe([
    { op: 'union', mated: true, children: [
      { op: 'revolve', profile: boredSection(BOX), segments: 24 },
      // the tube arrives wrapped in an identity translate (as g_dp_joint's graph emits)
      { op: 'translate', offset: [0, 0, 0], child: { op: 'revolve', profile: boredSection(TUBE), segments: 24 } },
      { op: 'revolve', profile: boredSection(PIN), segments: 24 },
    ] },
  ]);

  it('stacks box→tube→pin END-TO-END (total Z-extent ≈ Σ child extents), not overlapped at origin', () => {
    const t = makeBboxMockTf();
    const out = executeTfRecipe(t, t, matedRecipe);
    const [mn, mx] = pointsZExtent(out.data.points);
    const total = mx - mn;
    // Two 0.1 junction overlaps → total = 38 - 0.2 = 37.8; a wide margin proves it is
    // NOT the broken 25 (all three piled at the origin).
    expect(total).toBeCloseTo(SUM - 2 * 0.1, 4);
    expect(total).toBeGreaterThan(TUBE + 5);
    // Each child slid onto the running cursor: box dz≈0, tube dz≈5.9, pin dz≈30.8.
    const dzs = t.calls.filter((c: any) => c.fn === 'makeTranslation').map((c: any) => c.args[2]);
    // (the tube's identity [0,0,0] wrapper also records a makeTranslation(0,0,0))
    expect(dzs).toContain(0);
    expect(dzs.some((z: number) => Math.abs(z - 5.9) < 1e-6)).toBe(true);
    expect(dzs.some((z: number) => Math.abs(z - 30.8) < 1e-6)).toBe(true);
    // Two folds weld the three parts into one solid; the analyse verdict passes through
    // (real χ=0 of the welded solid is verified in-browser, like every tf boolean —
    // per dp_joint.test.ts; the pure per-part genus-1 proof lives there too).
    expect(t.calls.filter((c: any) => c.fn === 'booleanUnion')).toHaveLength(2);
    expect(out.stats.closed).toBe(true);
    expect(out.stats.euler).toBe(0);
  });

  it('a PLAIN (non-mated) union of the same three children leaves them overlapped at origin', () => {
    const t = makeBboxMockTf();
    const plain: TfRecipe = recipe([{ op: 'union', children: (matedRecipe.instrs[0] as any).children }]);
    const out = executeTfRecipe(t, t, plain);
    const [mn, mx] = pointsZExtent(out.data.points);
    // No mating → all three at z=0 → total extent is just the longest child (the tube).
    expect(mx - mn).toBeCloseTo(TUBE, 4);
    expect(t.calls.filter((c: any) => c.fn === 'makeTranslation')).toHaveLength(1); // only the identity wrapper
  });
});

describe('executeTfRecipe — stack-mode repeat (g_dp_stand bug)', () => {
  // g_dp_stand-shaped: a graph `stack` of N counted JOINTS. graph-to-tf lowers the
  // counted child to { op:'repeat', count:N, mode:'stack', child }. The bug: the
  // repeat used to fold N copies of the SAME child at the SAME local origin, so all
  // N joints piled at z=0 (total extent = ONE joint) instead of stacking down-hole.
  const JOINT = 20; // one demo joint's local Z-extent [0, 20]
  const N = 3;
  const jointInstr: TfInstr = { op: 'revolve', profile: boredSection(JOINT), segments: 24 };

  it('a stack-mode repeat ×N places the copies END-TO-END (total Z ≈ N×extent), not piled at origin', () => {
    const t = makeBboxMockTf();
    const out = executeTfRecipe(t, t, recipe([
      { op: 'union', mated: true, children: [
        { op: 'repeat', count: N, mode: 'stack', child: jointInstr },
      ] },
    ]));
    const [mn, mx] = pointsZExtent(out.data.points);
    const total = mx - mn;
    // N joints, each JOINT tall, welded with (N-1) junction overlaps of 0.1.
    expect(total).toBeCloseTo(N * JOINT - (N - 1) * 0.1, 4);
    // Emphatically NOT the broken single-joint extent (all piled at origin).
    expect(total).toBeGreaterThan(JOINT * (N - 0.5));
    // Copies slide onto the running cursor 0, 19.9, 39.8. The FIRST copy's dz is 0
    // (its top already sits at the cursor) so no translation is emitted; copies 2+3
    // slide to distinct DOWN-HOLE cursors — the proof they are NOT piled at origin.
    const dzs = t.calls.filter((c: any) => c.fn === 'makeTranslation').map((c: any) => c.args[2]);
    expect(dzs.some((z: number) => Math.abs(z - (JOINT - 0.1)) < 1e-6)).toBe(true);
    expect(dzs.some((z: number) => Math.abs(z - 2 * (JOINT - 0.1)) < 1e-6)).toBe(true);
    expect(new Set(dzs).size).toBe(N - 1); // (N-1) distinct non-zero cursors, none coincident
    // N copies → (N-1) folds.
    expect(t.calls.filter((c: any) => c.fn === 'booleanUnion')).toHaveLength(N - 1);
  });

  it('a NON-stack-mode repeat (mode absent) leaves the copies piled at origin (v0 approximation)', () => {
    const t = makeBboxMockTf();
    const out = executeTfRecipe(t, t, recipe([
      { op: 'repeat', count: N, child: jointInstr },
    ]));
    const [mn, mx] = pointsZExtent(out.data.points);
    // No stride captured → all copies coincide → extent is just ONE joint.
    expect(mx - mn).toBeCloseTo(JOINT, 4);
    expect(t.calls.filter((c: any) => c.fn === 'makeTranslation')).toHaveLength(0);
  });
});

describe('executeTfRecipe — cutaway returns BOTH full + cut, and parts regardless of cutaway', () => {
  // BUG-1 fix: a cutaway build must carry the UNCUT `fullData` alongside the CUT
  // `data`/`cutPlanes` so the cross-section toggle is a pure view-switch (no
  // re-bake, no blank on ON→OFF). BUG-2 fix: per-part `parts` (material) must be
  // built REGARDLESS of cutaway so the full view always shows its material.
  const appearanceRecipe: TfRecipe = {
    instrs: [{ op: 'box', w: 4, h: 4, d: 4 }],
    notes: [],
    partAppearance: [{ material: 'steel' }],
  } as any;

  it('a cutaway build returns BOTH the uncut full mesh AND the cut section (+ planes)', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([{ op: 'box', w: 4, h: 4, d: 4 }]), { cutaway: true });
    // Cut section + the two exposed planes (x=0, y=0) — the merged grey/red view.
    expect(out.cutPlanes).toEqual([{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }]);
    expect(out.data.points.length).toBeGreaterThan(0);
    // AND the uncut full mesh, so the toggle can switch full ↔ cut with no re-bake.
    expect(out.fullData).toBeDefined();
    expect(out.fullData!.points.length).toBeGreaterThan(0);
    // The cut actually ran (booleanDifference), proving `data` != `fullData` handle.
    expect(t.calls.filter((c: any) => c.fn === 'booleanDifference')).toHaveLength(1);
  });

  it('a non-cutaway build has NO fullData (data already IS the full mesh)', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([{ op: 'box', w: 4, h: 4, d: 4 }]), { cutaway: false });
    expect(out.cutPlanes).toBeUndefined();
    expect(out.fullData).toBeUndefined();
    expect(out.data.points.length).toBeGreaterThan(0);
  });

  it('builds per-part meshes even with cutaway ON when the recipe has per-part appearance', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, appearanceRecipe, { cutaway: true });
    expect(out.parts).toBeDefined();
    expect(out.parts).toHaveLength(1);
    expect(out.parts![0].appearance).toEqual({ material: 'steel' });
    // and the cutaway still produced both the uncut full mesh + the cut section.
    expect(out.fullData).toBeDefined();
    expect(out.cutPlanes).toEqual([{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }]);
  });

  it('a recipe with NO appearance stays on the merged single-mesh path (no parts)', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([{ op: 'box', w: 4, h: 4, d: 4 }]), { cutaway: false });
    expect(out.parts).toBeUndefined();
  });
});

describe('executeTfRecipe — per-part CUT (v2: per-part material on the cutaway)', () => {
  // v2: under a cutaway of an appearance-bearing recipe, EACH part is cut on its
  // own quadrant box → `cutParts` (one entry per part, carrying its appearance) so
  // the CUT view can render per-part material on the outer skin (interior stays a
  // grey section). Same world x=0/y=0 planes as the merged section.
  const twoPartAppearance: TfRecipe = {
    instrs: [
      { op: 'box', w: 4, h: 4, d: 4 },
      { op: 'box', w: 2, h: 2, d: 2 },
    ],
    notes: [],
    partAppearance: [{ material: 'steel' }, { material: 'brass' }],
  } as any;

  it('a cutaway build returns per-part CUT data carrying each part appearance.material', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, twoPartAppearance, { cutaway: true });
    expect(out.cutParts).toBeDefined();
    expect(out.cutParts).toHaveLength(2);
    expect(out.cutParts![0].appearance).toEqual({ material: 'steel' });
    expect(out.cutParts![1].appearance).toEqual({ material: 'brass' });
    // Each per-part cut mesh has real geometry.
    for (const cp of out.cutParts!) expect(cp.data.points.length).toBeGreaterThan(0);
    // Cut planes are present (the render arm gates the per-part-cut arm on them).
    expect(out.cutPlanes).toEqual([{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }]);
    // The per-part cut is INDEPENDENT of the merged section: still get both full + cut.
    expect(out.fullData).toBeDefined();
    // The full-view per-part meshes are still built (material shows on full view too).
    expect(out.parts).toHaveLength(2);
  });

  it('does NOT build cutParts when the cutaway is OFF (nothing to section per part)', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, twoPartAppearance, { cutaway: false });
    expect(out.cutParts).toBeUndefined();
    // full-view per-part material still built regardless of cutaway.
    expect(out.parts).toHaveLength(2);
  });

  it('does NOT build cutParts when the recipe has NO per-part appearance', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([{ op: 'box', w: 4, h: 4, d: 4 }]), { cutaway: true });
    expect(out.cutParts).toBeUndefined();
    expect(out.parts).toBeUndefined();
  });
});

describe('executeTfRecipe — authored cutaway (graph cutaway node)', () => {
  it('walks a cutaway instr → builds wedge + booleanDifference on the child', () => {
    const t = makeMockTf();
    const child: TfInstr = { op: 'box', w: 4, h: 4, d: 8 };
    const out = executeTfRecipe(t, t, recipe([{ op: 'cutaway', child, az: 90, offset: 0 }]));
    const fns = t.calls.map((c: any) => c.fn);
    expect(fns).toContain('boxMesh');
    expect(fns).toContain('mesh');          // tfExtrudeProfile wedge
    expect(fns).toContain('booleanDifference');
    expect(out.stats.closed).toBe(true);
  });

  it('recipeHasUnsupported is false for a cutaway wrapping a supported child', () => {
    expect(recipeHasUnsupported(recipe([
      { op: 'cutaway', az: 90, offset: 0, child: { op: 'box', w: 2, h: 2, d: 4 } },
    ]))).toBe(false);
  });
});

describe('recipeHasUnsupported', () => {
  it('is false for a clean revolve/boolean recipe', () => {
    expect(recipeHasUnsupported(recipe([
      { op: 'booleanDifference',
        obj: { op: 'revolve', profile: SQUARE, segments: 8 },
        arg: { op: 'cylinder', radius: 1, height: 3, segments: 16 } },
    ]))).toBe(false);
  });

  it('detects a nested UNSUPPORTED (under a transform, under a boolean)', () => {
    expect(recipeHasUnsupported(recipe([
      { op: 'booleanUnion',
        obj: { op: 'box', w: 1, h: 1, d: 1 },
        arg: { op: 'translate', offset: [0, 0, 1],
          child: { op: 'UNSUPPORTED', nodeType: 'call:r_weld_extrude' } } },
    ]))).toBe(true);
  });

  it('detects an UNSUPPORTED inside a union child list', () => {
    expect(recipeHasUnsupported(recipe([
      { op: 'union', children: [
        { op: 'box', w: 1, h: 1, d: 1 },
        { op: 'UNSUPPORTED', nodeType: 'sketch' },
      ] },
    ]))).toBe(true);
  });

  it('treats a revolve with an unresolved (< 3 pt) profile as unsupported', () => {
    expect(recipeHasUnsupported(recipe([{ op: 'revolve', profile: [], segments: 64 }]))).toBe(true);
    expect(recipeHasUnsupported(recipe([{ op: 'revolve', profile: [[1, 0], [1, 2]], segments: 64 }]))).toBe(true);
  });

  it('a resolved sweep (≥ 2 path pts) is SUPPORTED; an empty/1-pt path is not', () => {
    expect(recipeHasUnsupported(recipe([
      { op: 'booleanDifference',
        obj: { op: 'sweep', path: [[0, 0, 0], [0, 0, 2]], radius: 0.6, radialSegments: 32 },
        arg: { op: 'sweep', path: [[0, 0, 0], [0, 0, 2]], radius: 0.5, radialSegments: 32 } },
    ]))).toBe(false);
    expect(recipeHasUnsupported(recipe([{ op: 'sweep', path: [[0, 0, 0]], radius: 1, radialSegments: 8 }]))).toBe(true);
    expect(recipeHasUnsupported(recipe([{ op: 'sweep', path: [], radius: 1, radialSegments: 8 }]))).toBe(true);
  });
});
