import { describe, it, expect } from 'vitest';
import { buildTfRecipe, packTfResult, type TfWorkerRequest } from './tf-worker-core';
import type { TfDemoResult } from './trueform-client';
import type { TfRecipe } from '$lib/engines/trueform/graph-to-tf';

/**
 * PURE tf-worker-core tests — the WASM kernel only runs in-browser (cross-origin
 * isolation + pthreads), so the actual TF bake is verified in the browser, NOT
 * here. What we CAN prove headlessly with a MOCK kernel (same approach as
 * execute.test.ts): (1) `buildTfRecipe` dispatches the NATIVE recipe path through
 * executeTfRecipe against the injected handle, and (2) `packTfResult` copies the
 * mesh onto FRESH, transferable (non-shared) ArrayBuffers + collects the transfer
 * list, preserving cutPlanes + per-part data.
 */

/** A minimal mock tf handle — enough for executeTfRecipe + tfResult/tfAnalyze. */
function makeMockTf() {
  let idc = 0;
  const handle = (tag: string, extra: Record<string, any> = {}) => ({
    __tag: tag,
    __id: idc++,
    numberOfFaces: 1,
    numberOfPoints: 3,
    points: { data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
    faces: { data: new Int32Array([0, 1, 2]) },
    transformation: null as any,
    ...extra,
  });
  const t: any = {
    boxMesh: (w: number, h: number, d: number) => handle('box', { __dims: [w, h, d] }),
    cylinderMesh: () => handle('cyl'),
    booleanUnion: (obj: any, arg: any) => ({ mesh: handle('union', { obj, arg }) }),
    positivelyOriented: (m: any) => m,
    makeTranslation: () => ({ __mat: 'T', matMul: (o: any) => ({ __mat: 'T∘' + (o?.__mat ?? '?') }) }),
    // topology/geometry predicates (tfAnalyze)
    isClosed: () => true,
    isManifold: () => true,
    eulerCharacteristic: () => 2,
    boundaryPaths: () => ({ length: 0, get: () => ({ data: new Int32Array() }) }),
    signedVolume: () => 64,
    volume: () => 64,
  };
  return t;
}

describe('buildTfRecipe (native dispatch)', () => {
  it('executes a native recipe against the injected kernel → a TfDemoResult', async () => {
    const t = makeMockTf();
    const recipe: TfRecipe = { instrs: [{ op: 'box', w: 4, h: 4, d: 4 }] } as any;
    const req: TfWorkerRequest = { id: 1, mode: 'native', recipe, cutaway: false };
    const res = await buildTfRecipe(t, req);
    expect(res.data.points.length).toBe(9);
    expect(res.data.faces.length).toBe(3);
    expect(res.stats.closed).toBe(true);
    expect(res.stats.manifold).toBe(true);
    expect(res.cutPlanes).toBeUndefined();
  });

  it('throws when a native build is requested with no recipe', async () => {
    const t = makeMockTf();
    await expect(buildTfRecipe(t, { id: 1, mode: 'native', cutaway: false }))
      .rejects.toThrow(/requires a recipe/);
  });
});

describe('packTfResult (transferable pack)', () => {
  it('copies mesh onto fresh non-shared buffers + collects the transfer list', () => {
    const result: TfDemoResult = {
      data: { points: new Float32Array([0, 0, 0, 1, 2, 3]), faces: new Int32Array([0, 1, 2]) },
      stats: { tris: 1, verts: 2, closed: true, manifold: true, euler: 2, boundaryLoops: 0, signedVolume: 1, volume: 1 },
    };
    const { payload, transfer } = packTfResult(result);
    // Values preserved, buffers fresh (transferable) + in the transfer list.
    expect(Array.from(payload.data.points)).toEqual([0, 0, 0, 1, 2, 3]);
    expect(Array.from(payload.data.faces)).toEqual([0, 1, 2]);
    expect(transfer).toContain(payload.data.points.buffer);
    expect(transfer).toContain(payload.data.faces.buffer);
    expect(payload.data.points.buffer).not.toBe(result.data.points.buffer);
  });

  it('carries cutPlanes through unchanged', () => {
    const result: TfDemoResult = {
      data: { points: new Float32Array([0, 0, 0]), faces: new Int32Array([0, 0, 0]) },
      stats: { tris: 1, verts: 1, closed: true, manifold: true, euler: 2, boundaryLoops: 0, signedVolume: 1, volume: 1 },
      cutPlanes: [{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }],
    };
    const { payload } = packTfResult(result);
    expect(payload.cutPlanes).toEqual([{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }]);
  });

  it('carries the uncut fullData mesh through on its OWN transferable buffer', () => {
    const result: TfDemoResult = {
      data: { points: new Float32Array([1, 1, 1, 2, 2, 2]), faces: new Int32Array([0, 1, 2]) },
      stats: { tris: 1, verts: 2, closed: true, manifold: true, euler: 2, boundaryLoops: 0, signedVolume: 1, volume: 1 },
      cutPlanes: [{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }],
      fullData: { points: new Float32Array([9, 9, 9, 8, 8, 8]), faces: new Int32Array([0, 1, 2]) },
    };
    const { payload, transfer } = packTfResult(result);
    expect(Array.from(payload.fullData!.points)).toEqual([9, 9, 9, 8, 8, 8]);
    // Fresh (owned) buffers + in the transfer list, distinct from the source.
    expect(transfer).toContain(payload.fullData!.points.buffer);
    expect(transfer).toContain(payload.fullData!.faces.buffer);
    expect(payload.fullData!.points.buffer).not.toBe(result.fullData!.points.buffer);
    // cut `data` + `fullData` = 4 transferable buffers (points+faces each).
    expect(transfer.length).toBe(4);
  });

  it('omits fullData when the result carries none (non-cutaway path)', () => {
    const result: TfDemoResult = {
      data: { points: new Float32Array([0, 0, 0]), faces: new Int32Array([0]) },
      stats: { tris: 0, verts: 1, closed: true, manifold: true, euler: 2, boundaryLoops: 0, signedVolume: 1, volume: 1 },
    };
    const { payload, transfer } = packTfResult(result);
    expect(payload.fullData).toBeUndefined();
    expect(transfer.length).toBe(2);
  });

  it('packs per-part meshes + appearance, each on its own transferable buffer', () => {
    const result: TfDemoResult = {
      data: { points: new Float32Array([0, 0, 0]), faces: new Int32Array([0]) },
      stats: { tris: 0, verts: 1, closed: true, manifold: true, euler: 2, boundaryLoops: 0, signedVolume: 1, volume: 1 },
      parts: [
        { data: { points: new Float32Array([1, 1, 1]), faces: new Int32Array([0]) }, appearance: { color: '#ff0000' } as any },
        { data: { points: new Float32Array([2, 2, 2]), faces: new Int32Array([0]) } },
      ],
    };
    const { payload, transfer } = packTfResult(result);
    expect(payload.parts).toHaveLength(2);
    expect(Array.from(payload.parts![0].data.points)).toEqual([1, 1, 1]);
    expect(payload.parts![0].appearance).toEqual({ color: '#ff0000' });
    // merged data + 2 part meshes = 6 transferable buffers (points+faces each).
    expect(transfer.length).toBe(6);
  });
});
