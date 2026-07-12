/**
 * bore-extend-sweep.test.ts — N6: port the TF bore-extend (defect-2 prevention)
 * to the Manifold hollow-SWEEP boolean path.
 *
 * A hollow swept tube authored as `sweep(outer).subtract(sweep(inner))` (two
 * SOLID sweeps, a 3D mesh boolean) slivers on a CURVED path: both sweeps ride the
 * SAME path, so their end caps are COINCIDENT + tilted, and Manifold's mesh
 * boolean stitches the two cap disks into PHANTOM HANDLES → wrong genus /
 * negative Euler characteristic + a degenerate-sliver fan (defect 2, memory
 * `r_sweep_normals_and_twist`). PROVEN not repairable post-hoc (drop-degenerate /
 * simplify / setTolerance all preserve genus).
 *
 * `boredSweep` PREVENTS it: it rides the bore (subtrahend) sweep on the path
 * EXTENDED past both ends (`extendPathEnds`) so the bore's caps punch clean
 * THROUGH the outer caps → NO coincident caps → clean genus-1 (χ=0) pipe.
 *
 * We assert the TOPOLOGY (genus + Euler characteristic), not a triangle-count
 * proxy (guardrail 6): the defect satisfies "still watertight + more verts", so
 * only χ/genus catches it. Volume must be unchanged and the solid stays closed.
 * Degenerate/sliver counts are asserted as a SECONDARY signal only.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold } from '$lib/engines/manifold/manifold-helpers';
import {
  sweepAlongPath,
  sweepAnnular,
  boredSweep,
  extendPathEnds,
  getBoreExtFactor,
  setBoreExtFactor,
} from '$lib/engines/manifold/manifold-mesh';
import { resampleSpline } from '../spline-resample';

type V2 = [number, number];
type V3 = [number, number, number];

const TAU = Math.PI * 2;
const circle2d = (rad: number, n: number): V2[] => {
  const p: V2[] = [];
  for (let i = 0; i < n; i++) p.push([rad * Math.cos((TAU * i) / n), rad * Math.sin((TAU * i) / n)]);
  return p;
};

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lenV = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Decode a Manifold mesh → per-triangle vertex-position triples + the raw mesh. */
function decode(m: any): { tris: V3[][]; mesh: any } {
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
  return { tris, mesh };
}

const triArea = (t: V3[]) => lenV(crossV(sub3(t[1], t[0]), sub3(t[2], t[0]))) / 2;

/** Zero-area (weld-collapsed) triangles. */
function degenerateCount(m: any, eps = 1e-9): number {
  let n = 0;
  for (const t of decode(m).tris) if (triArea(t) < eps) n++;
  return n;
}

/** Very thin (high aspect-ratio) triangles — the sliver fan a corrupted cap emits.
 *  aspect = longestEdge² / (2·area); a well-shaped tri is O(1..10), a sliver ≫ that. */
function sliverCount(m: any, aspect = 1e3): number {
  let n = 0;
  for (const t of decode(m).tris) {
    const a = triArea(t);
    const e0 = lenV(sub3(t[1], t[0])), e1 = lenV(sub3(t[2], t[1])), e2 = lenV(sub3(t[0], t[2]));
    const longest = Math.max(e0, e1, e2);
    if (a < 1e-12) continue; // counted as degenerate, not sliver
    if ((longest * longest) / (2 * a) > aspect) n++;
  }
  return n;
}

/** Full topology snapshot for the before/after table.
 *
 *  χ is taken from Manifold's OWN `genus()` (χ = 2 − 2·genus for a connected
 *  closed orientable surface). `genus()` reads Manifold's internal HALFEDGE
 *  topology, which is a clean simplicial complex — the AUTHORITATIVE topology.
 *  A naive V−E+F over the EXPORTED display mesh (`getMesh()`) is NOT reliable
 *  here: a 3D boolean's display mesh carries T-junctions + property-split /
 *  position-coincident verts, so position-welding it miscounts edges and gives a
 *  wrong χ. That's exactly why the task says "assert genus", not a mesh proxy. */
function snapshot(m: any) {
  const genus: number = m.genus();
  return {
    status: m.status() as string,
    volume: m.volume() as number,
    genus,
    chi: 2 - 2 * genus, // Euler characteristic
    degenerate: degenerateCount(m),
    sliver: sliverCount(m),
  };
}

const OUTER = 0.4;
const HOLE = 0.25;
const SEG = 32;

const STRAIGHT: V3[] = [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]];
// The s_tube_demo curved control points, resampled 32× — the case that slivers.
const CURVED_CTRL: V3[] = [[0, 0, 0], [0, 0, 1.522071596816624], [0, 0, 2.498], [2.344, -0.348, 4.418], [0, 0, 7.531]];

function samePathSubtract(path: V3[]): any {
  return sweepAlongPath(path, circle2d(OUTER, SEG), { caps: true }).subtract(
    sweepAlongPath(path, circle2d(HOLE, SEG), { caps: true }),
  );
}

describe('boredSweep — bore-extend prevents defect-2 on a hollow 3D-subtract sweep', () => {
  beforeAll(async () => { await initManifold(); });

  it('extendPathEnds adds one collinear point past each end along the end tangent', () => {
    const p: V3[] = [[0, 0, 0], [0, 0, 1], [0, 0, 2]];
    const e = extendPathEnds(p, 0.5);
    expect(e.length).toBe(p.length + 2);
    expect(e[0]).toEqual([0, 0, -0.5]);              // punched back past the first
    expect(e[e.length - 1]).toEqual([0, 0, 2.5]);    // punched forward past the last
    // interior points unchanged
    expect(e.slice(1, -1)).toEqual(p);
    // ext ≤ 0 / <2-pt → unchanged
    expect(extendPathEnds(p, 0)).toBe(p);
    expect(extendPathEnds([[0, 0, 0]] as V3[], 1)).toEqual([[0, 0, 0]]);
  });

  it('derives the bore-extend margin from section size (exposed dial)', () => {
    expect(getBoreExtFactor()).toBe(2);
    setBoreExtFactor(3);
    expect(getBoreExtFactor()).toBe(3);
    setBoreExtFactor(-5);
    expect(getBoreExtFactor()).toBe(0); // clamped ≥ 0
    setBoreExtFactor(2);                 // restore default
  });

  it('CURVED: same-path subtract corrupts topology (defect); boredSweep restores genus 1 / χ=0', () => {
    const path = resampleSpline(CURVED_CTRL, SEG, false) as V3[];

    const before = snapshot(samePathSubtract(path));
    const after = snapshot(boredSweep(path, circle2d(OUTER, SEG), circle2d(HOLE, SEG)));
    const annular = snapshot(sweepAnnular(path, circle2d(OUTER, SEG), [circle2d(HOLE, SEG)], { caps: true }));

    // eslint-disable-next-line no-console
    console.table({ 'curved same-path': before, 'curved boredSweep': after, 'curved sweepAnnular': annular });

    // BEFORE — the defect: coincident tilted caps → phantom handles → genus ≫ 1
    // → χ < 0, plus a degenerate/sliver fan. Still a CLOSED 2-manifold ('NoError')
    // — which is exactly the trap: only genus/χ catches it (guardrail 6).
    expect(before.status).toBe('NoError');
    expect(before.genus).toBeGreaterThan(1);
    expect(before.chi).toBeLessThan(0);
    expect(before.degenerate + before.sliver).toBeGreaterThan(0);

    // AFTER — the PRIMARY property is restored: bore-extend removes the phantom
    // handles → genus 1 ⇒ χ = 0, the topology of a clean through-pipe. This is the
    // actual defect-2 fix (χ is asserted from genus, not a mesh proxy).
    expect(after.status).toBe('NoError');
    expect(after.genus).toBe(1);
    expect(after.chi).toBe(0);

    // Volume unchanged (same material removed) — solid stays closed + correct.
    expect(after.volume).toBeGreaterThan(0);
    expect(after.volume).toBeCloseTo(before.volume, 2);

    // SECONDARY signal + the honest FINDING: bore-extend fixes the TOPOLOGY, but a
    // 3D mesh boolean still re-triangulates the punch-through ring into some thin
    // cap tris, so it does NOT reach 0 slivers. The no-boolean fix `sweepAnnular`
    // reaches the SAME genus-1 pipe AND 0 degenerate/sliver — it is strictly
    // cleaner on Manifold and remains the recommended hollow-sweep path.
    expect(annular.genus).toBe(1);
    expect(annular.degenerate).toBe(0);
    expect(annular.sliver).toBe(0);
    expect(after.volume).toBeCloseTo(annular.volume, 2);
  });

  it('STRAIGHT: axis-perpendicular caps subtract cleanly either way (genus 1, χ=0)', () => {
    const before = snapshot(samePathSubtract(STRAIGHT));
    const after = snapshot(boredSweep(STRAIGHT, circle2d(OUTER, SEG), circle2d(HOLE, SEG)));

    // eslint-disable-next-line no-console
    console.table({ 'straight same-path': before, 'straight boredSweep': after });

    // A straight path caps perpendicular to the axis → the same-path subtract is
    // already clean (docs: "Straight path = clean"). Both are a genus-1 pipe.
    expect(before.status).toBe('NoError');
    expect(before.genus).toBe(1);
    expect(before.chi).toBe(0);

    expect(after.status).toBe('NoError');
    expect(after.genus).toBe(1);
    expect(after.chi).toBe(0);
    expect(after.volume).toBeCloseTo(before.volume, 3);
  });

  it('boredSweep matches sweepAnnular on the load-bearing properties (genus + volume)', () => {
    const path = resampleSpline(CURVED_CTRL, SEG, false) as V3[];
    const bored = boredSweep(path, circle2d(OUTER, SEG), circle2d(HOLE, SEG));
    const annular = sweepAnnular(path, circle2d(OUTER, SEG), [circle2d(HOLE, SEG)], { caps: true });

    // Both engine-agnostic fixes converge on the SAME genus-1 pipe + volume; only
    // sweepAnnular is additionally sliver-free (asserted in the CURVED test above).
    expect(bored.genus()).toBe(1);
    expect(annular.genus()).toBe(1);
    expect(bored.volume()).toBeCloseTo(annular.volume(), 2);
  });

  it('an explicit boreExt override still restores clean genus-1 topology', () => {
    const path = resampleSpline(CURVED_CTRL, SEG, false) as V3[];
    const m = boredSweep(path, circle2d(OUTER, SEG), circle2d(HOLE, SEG), { boreExt: 0.75 });
    expect(m.status()).toBe('NoError');
    expect(m.genus()).toBe(1);
  });
});
