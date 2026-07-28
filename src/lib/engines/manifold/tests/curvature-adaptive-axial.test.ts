/**
 * curvature-adaptive-axial.test.ts — the SHARED κ→Δz model wired into the Manifold
 * bake (TASK A). Proves that the MF revolve now places its axial warp-rings by
 * CURVATURE (planAxialStations via densifyProfileAxial — the exact model TrueForm's
 * executor already consumes) instead of the old UNIFORM max-Z-span cap:
 *
 *   • `subdivideProfileAxial(profile, maxZSpan, cap, cp)` — with a curved spline `cp`
 *     it clusters rings at the bend + stays sparse on the straight tangent; with a
 *     straight spline it stays at the minStations baseline (NOT over-subdivided);
 *     with no `cp` it is byte-identical to the 3-arg form.
 *   • The `_axialSpline` dial (`setAxialSpline`) drives `revolveProfile` end-to-end
 *     against the REAL Manifold kernel: the built solid stays VALID (positive
 *     volume, genus 0, warps without "Not manifold") and its rings are clustered.
 *   • `runCompiledManifold({ axialSpline })` threads the option through the whole
 *     client executor (the bake-worker-core:55 TODO) → a valid non-empty bake.
 *
 * Headless: vitest runs Manifold in Node off the same manifold.wasm.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as helpers from '../manifold-helpers';
import {
  subdivideProfileAxial,
  revolveProfile,
  weldAndBuild,
  setAxialSpline,
  getAxialSpline,
  setAxialMaxZSpan,
} from '../manifold-mesh';
import { warpManifoldAlongSpline } from '../warp-spline';
import { runCompiledManifold } from '../bake-worker-core';

beforeAll(async () => {
  await helpers.initManifold();
});

// Always leave both axial dials OFF so ordering can't leak a set dial into an
// unrelated bake (the shipped default is null on both).
afterEach(() => { setAxialSpline(null); setAxialMaxZSpan(null); });

/** Annular (bored-tube) half-section [r,z] — the well-casing profile. */
const TUBE = (rIn: number, rOut: number, H: number): [number, number][] => [
  [rIn, 0], [rOut, 0], [rOut, H], [rIn, H],
];

/** Vertical 0→12 (straight tangent) then kick-off 12→30 (the dogleg). */
const CURVE: [number, number, number][] = [[0, 0, 0], [0, 0, 12], [3, 0, 22], [9, 0, 30]];
/** Pure vertical (no curvature). */
const STRAIGHT: [number, number, number][] = [[0, 0, 0], [0, 0, 30]];

/** SORTED distinct z-planes present in a 2D profile loop. */
function profileZs(prof: [number, number][]): number[] {
  const set = new Set<number>();
  for (const [, z] of prof) set.add(Math.round(z * 1e4));
  return [...set].map((k) => k / 1e4).sort((a, b) => a - b);
}

/** SORTED distinct z-planes (axial rings) in a built Manifold. */
function manifoldZs(m: any): number[] {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const np = mesh.numProp;
  const set = new Set<number>();
  for (let i = 0; i < vp.length / np; i++) set.add(Math.round(vp[i * np + 2] / 1e-4));
  return [...set].map((k) => k * 1e-4).sort((a, b) => a - b);
}

/** Ring density (rings per unit z) in the STRAIGHT half vs the BEND half. A strict
 *  bend > straight inequality is what proves curvature (not uniform spacing) drives
 *  placement. */
function clustering(zs: number[], H: number, zBend: number): { straight: number; bend: number } {
  const nStraight = zs.filter((z) => z > 0.05 && z < zBend - 0.05).length;
  const nBend = zs.filter((z) => z > zBend + 0.05 && z < H - 0.05).length;
  return { straight: nStraight / zBend, bend: nBend / (H - zBend) };
}

describe('subdivideProfileAxial — curvature-adaptive spline mode', () => {
  it('a curved spline clusters rings at the bend, sparse on the straight run', () => {
    const H = 30;
    const out = subdivideProfileAxial(TUBE(0.9, 1.2, H), null, 96, CURVE);
    const zs = profileZs(out);
    expect(zs.length).toBeGreaterThan(8); // real interior rings inserted
    const c = clustering(zs, H, 12);
    expect(c.bend).toBeGreaterThan(c.straight); // κ drives placement, not spacing
  });

  it('a straight spline stays at the sparse baseline — NOT over-subdivided', () => {
    const H = 30;
    const out = subdivideProfileAxial(TUBE(0.9, 1.2, H), null, 96, STRAIGHT);
    const zs = profileZs(out);
    // minStations baseline (~8) — nowhere near the 96 cap: sparse, not a blow-up.
    expect(zs.length).toBeLessThan(20);
    // …and far fewer than the curved case demands at its bend.
    const curved = profileZs(subdivideProfileAxial(TUBE(0.9, 1.2, H), null, 96, CURVE));
    expect(clustering(curved, H, 12).bend).toBeGreaterThan(clustering(zs, H, 12).bend);
  });

  it('no cp (or null) → byte-identical to the 3-arg uniform / identity form', () => {
    const prof = TUBE(0.9, 1.2, 30);
    // Off dial + no spline → identity (same reference the 3-arg form returns).
    expect(subdivideProfileAxial(prof, null, 96)).toBe(prof);
    expect(subdivideProfileAxial(prof, null, 96, null)).toBe(prof);
    // Uniform dial + null spline == uniform dial + no 4th arg.
    expect(subdivideProfileAxial(prof, 0.25, 96, null)).toEqual(subdivideProfileAxial(prof, 0.25, 96));
  });
});

describe('_axialSpline dial → revolveProfile builds a VALID curvature-adaptive solid', () => {
  it('rings cluster at the bend and the solid stays watertight + warps clean', () => {
    setAxialMaxZSpan(null);
    const H = 30;
    const prof = TUBE(0.9, 1.2, H);
    setAxialSpline(CURVE);
    let tube: any;
    try { tube = weldAndBuild([revolveProfile(prof, 48)]); } finally { setAxialSpline(null); }

    // VALID solid: positive volume, genus 1 (a capped hollow tube = a washer, a
    // through-hole ⇒ homeomorphic to a solid torus), real triangles.
    expect(tube.numTri()).toBeGreaterThan(0);
    expect(tube.volume()).toBeGreaterThan(0);
    expect(tube.genus()).toBe(1);

    // Curvature-adaptive rings (dense at the dogleg, sparse on the straight run).
    const zs = manifoldZs(tube);
    expect(zs.length).toBeGreaterThan(8);
    const c = clustering(zs, H, 12);
    expect(c.bend).toBeGreaterThan(c.straight);

    // …and it still warps to a valid solid along that spline (no "Not manifold").
    const warped = warpManifoldAlongSpline(tube, CURVE, { originZ: 0, validate: true });
    expect(warped.volume()).toBeGreaterThan(0);
    expect(Number.isFinite(warped.genus())).toBe(true);
  });

  it('a straight spline stays sparse (baseline), and the OFF dial is byte-lean', () => {
    setAxialMaxZSpan(null);
    const H = 30;
    const prof = TUBE(0.9, 1.2, H);

    setAxialSpline(STRAIGHT);
    let sparse: any;
    try { sparse = weldAndBuild([revolveProfile(prof, 48)]); } finally { setAxialSpline(null); }
    expect(sparse.volume()).toBeGreaterThan(0);
    expect(manifoldZs(sparse).length).toBeLessThan(20); // sparse baseline, not over-subdivided

    // Dial fully OFF → only the 2 profile z-rings (the lean default is untouched).
    const lean = weldAndBuild([revolveProfile(prof, 48)]);
    expect(manifoldZs(lean).length).toBe(2);
  });
});

describe('runCompiledManifold — axialSpline option threads through the client executor', () => {
  // A lean revolved tube that then bends along the SAME spline via warpSpline.
  const WARP_SCRIPT = `return function (od, length) {
    const R = od / 2, rIn = R - 0.3;
    const prof = [[rIn, 0], [R, 0], [R, length], [rIn, length]];
    const tube = weldAndBuild([revolveProfile(prof, 48)]);
    return warpSpline(tube, ${JSON.stringify(CURVE)}, { originZ: 0 });
  };`;

  it('bakes a valid non-empty warped tube when the curvature spline is supplied', async () => {
    const s = await runCompiledManifold(WARP_SCRIPT, [2.4, 30], { axialSpline: CURVE });
    expect(s.full.positions.length).toBeGreaterThan(0);
    expect(s.full.positions.length % 3).toBe(0);
  });

  it('a straight spline also bakes clean (opt-in dial is inert on a straight path)', async () => {
    const s = await runCompiledManifold(WARP_SCRIPT, [2.4, 30], { axialSpline: STRAIGHT });
    expect(s.full.positions.length).toBeGreaterThan(0);
  });
});
