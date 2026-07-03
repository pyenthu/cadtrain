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

  it('folds a union recipe → booleanUnion once per extra child', () => {
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

  it('unions multiple ROOT outputs into one solid', () => {
    const t = makeMockTf();
    executeTfRecipe(t, t, recipe([
      { op: 'box', w: 1, h: 1, d: 1 },
      { op: 'box', w: 2, h: 2, d: 2 },
    ]));
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
