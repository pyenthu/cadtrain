/**
 * annular-sweep.test.ts — annular / region cross-section sweep (Phase 1).
 *
 * Pins the durable, engine-agnostic fix for DEFECT 2 (memory
 * `r_sweep_normals_and_twist`): a curved concentric HOLLOW tube built as
 * `sweep(outer).subtract(sweep(inner))` gives two tilted, coincident cap planes
 * whose independent triangulations don't align → Manifold's mesh boolean
 * corrupts them into degenerate/sliver caps + wrong topology. Building the same
 * hollow tube as ONE annular sweep (outer wall + hole wall + a HOLES-AWARE cap,
 * no 3D boolean) → 0 degenerate tris, a valid watertight pipe, and the SAME
 * volume as the subtract. Plan: docs/plans/annular-csg2d-section-sweep.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold } from '$lib/engines/manifold/manifold-helpers';
import { sweepAnnular, sweepAlongPath } from '$lib/engines/manifold/manifold-mesh';
import { resampleSpline } from '../spline-resample';

type V2 = [number, number];
type V3 = [number, number, number];

const TAU = Math.PI * 2;
const circle2d = (rad: number, n: number): V2[] => {
  const p: V2[] = [];
  for (let i = 0; i < n; i++) p.push([rad * Math.cos((TAU * i) / n), rad * Math.sin((TAU * i) / n)]);
  return p;
};
const circle3d = (rad: number, n: number): V3[] => circle2d(rad, n).map(([x, y]): V3 => [x, y, 0]);

function polyArea2D(p: V2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lenV = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dotV = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Decode a Manifold mesh → per-triangle vertex-position triples. */
function decode(m: any): { tris: V3[][]; numTris: number } {
  const mesh = m.getMesh();
  const v: Float32Array = mesh.vertProperties;
  const np: number = mesh.numProp;
  const tv: Uint32Array = mesh.triVerts;
  const tris: V3[][] = [];
  for (let t = 0; t < tv.length; t += 3) {
    const ia = tv[t], ib = tv[t + 1], ic = tv[t + 2];
    tris.push([
      [v[ia * np], v[ia * np + 1], v[ia * np + 2]],
      [v[ib * np], v[ib * np + 1], v[ib * np + 2]],
      [v[ic * np], v[ic * np + 1], v[ic * np + 2]],
    ]);
  }
  return { tris, numTris: tris.length };
}
const triArea = (t: V3[]) => lenV(crossV(sub3(t[1], t[0]), sub3(t[2], t[0]))) / 2;
function degenerateCount(m: any, eps = 1e-9): number {
  let n = 0;
  for (const t of decode(m).tris) if (triArea(t) < eps) n++;
  return n;
}
/** Sum the 3D areas of triangles lying in the plane through `o` with normal `n`. */
function capAreaInPlane(m: any, o: V3, n: V3, eps = 1e-4): number {
  let s = 0;
  for (const t of decode(m).tris) {
    if (t.every((p) => Math.abs(dotV(sub3(p, o), n)) < eps)) s += triArea(t);
  }
  return s;
}

// The s_tube_demo curved path (control points resampled 32×) — the case that
// slivers under subtract-two-sweeps.
const CTRL: V3[] = [[0, 0, 0], [0, 0, 1.522071596816624], [0, 0, 2.498], [2.344, -0.348, 4.418], [0, 0, 7.531]];

describe('sweepAnnular — curved concentric hollow tube as ONE welded mesh', () => {
  beforeAll(async () => { await initManifold(); });

  it('0 degenerate cap tris, watertight pipe (genus 1), cap area == polygonal annulus', () => {
    const path = resampleSpline(CTRL, 32, false) as V3[];
    const outer = circle2d(0.4, 32);
    const hole = circle2d(0.25, 32);
    const m = sweepAnnular(path, outer, [hole], { caps: true });

    expect(m.status()).toBe('NoError'); // status() returns a STRING
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.genus()).toBe(1);          // a through-bore pipe (open annular ends) is genus 1
    expect(degenerateCount(m)).toBe(0); // NO degenerate/sliver cap tris

    // Both caps flat-cover exactly the polygonal annulus area (no gap / overlap).
    const expectAnnulus = polyArea2D(outer) - polyArea2D(hole);
    const t0: V3 = ((): V3 => { const d = sub3(path[1], path[0]); const l = lenV(d); return [d[0] / l, d[1] / l, d[2] / l]; })();
    const tN: V3 = ((): V3 => { const d = sub3(path[path.length - 1], path[path.length - 2]); const l = lenV(d); return [d[0] / l, d[1] / l, d[2] / l]; })();
    expect(capAreaInPlane(m, path[0], t0)).toBeCloseTo(expectAnnulus, 4);
    expect(capAreaInPlane(m, path[path.length - 1], tN)).toBeCloseTo(expectAnnulus, 4);
  });

  it('produces the SAME material volume as sweep(outer).subtract(sweep(inner)) — but the subtract slivers', () => {
    const path = resampleSpline(CTRL, 32, false) as V3[];
    const outer = circle2d(0.4, 32);
    const hole = circle2d(0.25, 32);

    const annular = sweepAnnular(path, outer, [hole], { caps: true });
    const subtract = sweepAlongPath(path, outer, { caps: true }).subtract(
      sweepAlongPath(path, hole, { caps: true }),
    );

    // Same solid → same volume (to boolean tolerance).
    expect(annular.volume()).toBeCloseTo(subtract.volume(), 3);
    // The annular build is clean; the 3D subtract corrupts the coincident caps.
    expect(degenerateCount(annular)).toBe(0);
    expect(degenerateCount(subtract)).toBeGreaterThan(0);
  });

  it('straight annular tube is also clean (0 degenerate, genus 1)', () => {
    const m = sweepAnnular([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]], circle2d(0.4, 32), [circle2d(0.25, 32)], { caps: true });
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.genus()).toBe(1);
    expect(degenerateCount(m)).toBe(0);
  });

  it('routes via sweepAlongPath for both {outer,holes} and CrossSection sections', () => {
    const path = resampleSpline(CTRL, 32, false) as V3[];
    const outer = circle2d(0.4, 32);
    const hole = circle2d(0.25, 32);

    // Object form.
    const viaObj = sweepAlongPath(path, { outer, holes: [hole] }, { caps: true });
    expect(viaObj.status()).toBe('NoError');
    expect(degenerateCount(viaObj)).toBe(0);
    expect(viaObj.genus()).toBe(1);

    // CrossSection form (outer minus hole) — same hollow tube.
    const wasm = (globalThis as any).__cadtrain_manifold__.wasm;
    const region = new wasm.CrossSection([outer]).subtract(new wasm.CrossSection([hole]));
    const viaCS = sweepAlongPath(path, region, { caps: true });
    expect(viaCS.status()).toBe('NoError');
    expect(degenerateCount(viaCS)).toBe(0);
    expect(viaCS.genus()).toBe(1);
    expect(viaObj.volume()).toBeCloseTo(viaCS.volume(), 3);
  });

  it('back-compat: a plain single-loop section still builds a solid tube (genus 0)', () => {
    const path = resampleSpline(CTRL, 32, false) as V3[];
    const m = sweepAlongPath(path, circle2d(0.4, 32), { caps: true });
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.genus()).toBe(0); // no bore → solid rod → topological sphere
    expect(degenerateCount(m)).toBe(0);
  });
});
