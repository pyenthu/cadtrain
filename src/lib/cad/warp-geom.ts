// Pure warp deformation math — the single source of truth for the sinusoidal
// Z-axis displacement that finalizeManifold bakes into the Manifold geometry
// (so the mesh AND its EdgesGeometry both follow the bulge). Mirrors the
// now-retired render-time vertex shader in `src/lib/shared/warp.ts` EXACTLY:
//
//   disp = amp * sin(z * freq)
//   axis 'x' → x += disp ;  axis 'y' → y += disp
//
// Kept dependency-free so it's cheap to unit-test in isolation.

export type WarpAxis = 'x' | 'y';

export interface WarpSpec {
  amp: number;
  freq: number;
  axis: WarpAxis;
}

/**
 * Mutate a Manifold vertex `[x, y, z]` IN PLACE by the sinusoidal warp and
 * return it (for test convenience). `Manifold.warp(cb)` hands each vertex to
 * `cb` as a `Vec3` tuple `[x, y, z]` and reads the (mutated) tuple back —
 * verified against the installed manifold-3d 3.4.1 types
 * (`manifold-encapsulated-types.d.ts`: `warp(warpFunc: (vert: Vec3) => void)`,
 * with `Vec3 = [number, number, number]`) and the existing in-tree callback in
 * `warp-spline.ts` (which indexes `p[0..2]`).
 */
export function warpVertex(
  v: [number, number, number],
  amp: number,
  freq: number,
  axis: WarpAxis,
): [number, number, number] {
  const disp = amp * Math.sin(v[2] * freq);
  if (axis === 'y') v[1] += disp;
  else v[0] += disp;
  return v;
}

// ─── Z-targeted pre-warp subdivision ────────────────────────────────────────
//
// `Manifold.warp()` only MOVES existing vertices; it never adds them. On a
// coarse part (a cylinder side wall is two tall triangles) the sine therefore
// renders as a few straight chords — FACETED, not smooth. The fix is to add
// vertex samples ALONG Z (the warp's independent variable, `disp = amp·sin(z·
// freq)`) BEFORE warping, so the displaced surface has enough samples to trace
// the curve. We split ONLY edges whose Z-span is large — NOT a uniform
// `refineToLength`/`refine`, which also subdivides the already-dense perimeter
// rings (no Z-span, nothing to gain) and is ~4× slower paired with warp
// (`src/lib/cad/CLAUDE.md` → bench_extrude_findings). This is the Manifold-mesh
// port of the retired client-side `subdivideAlongZ` in `src/lib/shared/warp.ts`.
//
// Manifold-safety: an edge is split iff its Z-span exceeds the target. That
// predicate depends ONLY on the edge's two endpoints, so BOTH triangles
// sharing an edge agree — the inserted midpoint is shared (keyed by the vertex
// index pair), producing NO T-junctions, so the rebuilt mesh is still a valid
// closed 2-manifold (templates below preserve CCW winding → volume sign).

export interface MeshSoup {
  numProp: number;
  vertProperties: number[]; // length numVert · numProp; slots 0,1,2 = x,y,z
  triVerts: number[]; // length numTri · 3 (indices into vertProperties)
}

// Samples per sine CYCLE we aim for along Z. The warp is `sin(z·freq)`, so its
// period in Z is `2π/freq`; the target edge length is `period / SAMPLES`. 16 is
// comfortably above the ~8 needed to "beat" the sine, and — not by accident —
// reproduces the old client default of maxZSpan ≈ 0.25 at the scene's default
// freq 1.5 (2π/(1.5·16) ≈ 0.26), so existing parts look as they did before.
export const WARP_SAMPLES_PER_CYCLE = 16;

/** Target Z edge length for a given warp frequency. Higher freq → shorter
 *  target → more samples, so a busy warp gets the density it needs while a
 *  gentle one stays cheap. `freq ≤ 0` ⇒ `sin(z·0) ≡ 0` (a flat, identity warp)
 *  ⇒ Infinity (no edge can exceed it ⇒ no subdivision). */
export function targetZLenForFreq(freq: number): number {
  const f = Math.abs(freq);
  if (!(f > 0)) return Infinity;
  return (2 * Math.PI) / (f * WARP_SAMPLES_PER_CYCLE);
}

// ─── Cost caps (a tall stack must not explode) ──────────────────────────────
// Identical stacks warp via the INSTANCED path (builder.ts → tryInstanceFinalize),
// where this runs on the small CANONICAL child only, so the common big case is
// already cheap. These caps bound the rest:
//  • MAX_INPUT_TRIS  — skip subdivision entirely on an already-huge merged mesh
//    (warping + cutaway-CSG on hundreds of k tris is the slow path the bench
//    warns about); leave it faceted rather than melt the bake.
//  • MAX_OUTPUT_TRIS — stop splitting once the output reaches this size.
//  • MAX_ITER        — bisection passes; a starting Z-span Z reaches the target
//    in ⌈log2(Z/target)⌉ passes, so 7 covers a ~128× edge-span range.
const MAX_INPUT_TRIS = 200_000;
const MAX_OUTPUT_TRIS = 600_000;
const MAX_ITER = 7;

/**
 * PURE Z-targeted subdivision of a triangle-soup `MeshSoup`. Repeatedly bisects
 * every edge whose |Δz| exceeds `targetZLen`, sharing each inserted midpoint
 * between the two triangles that touch the edge (so the result stays a watertight
 * manifold). Returns a NEW soup; the input is not mutated. Unit-testable without
 * a Manifold runtime — `subdivideForWarp` wraps it with getMesh/rebuild.
 */
export function subdivideMeshAlongZ(
  mesh: MeshSoup,
  targetZLen: number,
  opts?: { maxIter?: number; maxOutputTris?: number },
): MeshSoup {
  const np = mesh.numProp;
  if (!(targetZLen > 0) || !isFinite(targetZLen)) {
    return { numProp: np, vertProperties: Array.from(mesh.vertProperties), triVerts: Array.from(mesh.triVerts) };
  }
  const maxIter = opts?.maxIter ?? MAX_ITER;
  const maxOutputTris = opts?.maxOutputTris ?? MAX_OUTPUT_TRIS;
  // Growable copies (typed-array inputs are coerced to plain arrays so we can
  // push new midpoint props past the original length).
  const vp: number[] = Array.from(mesh.vertProperties);
  let tris: number[] = Array.from(mesh.triVerts);
  let vertCount = vp.length / np;
  const zOf = (i: number) => vp[i * np + 2];

  for (let iter = 0; iter < maxIter; iter++) {
    if (tris.length / 3 > maxOutputTris) break;
    // All edge endpoints this pass are vertices that existed at pass START
    // (indices < base); midpoints we append get indices ≥ base and are never
    // re-split until the next pass — so `lo·base + hi` is a collision-free key.
    const base = vertCount;
    const mids = new Map<number, number>();
    const needSplit = (i: number, j: number) => Math.abs(zOf(i) - zOf(j)) > targetZLen;
    const midOf = (i: number, j: number): number => {
      const key = i < j ? i * base + j : j * base + i;
      const hit = mids.get(key);
      if (hit !== undefined) return hit;
      const m = vertCount++;
      const bi = i * np, bj = j * np, bm = m * np;
      for (let k = 0; k < np; k++) vp[bm + k] = (vp[bi + k] + vp[bj + k]) / 2;
      mids.set(key, m);
      return m;
    };

    const nt: number[] = [];
    let changed = false;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const sAB = needSplit(a, b), sBC = needSplit(b, c), sCA = needSplit(c, a);
      const n = (sAB ? 1 : 0) + (sBC ? 1 : 0) + (sCA ? 1 : 0);
      if (n === 0) { nt.push(a, b, c); continue; }
      changed = true;
      const mAB = sAB ? midOf(a, b) : -1;
      const mBC = sBC ? midOf(b, c) : -1;
      const mCA = sCA ? midOf(c, a) : -1;
      // Winding-preserving templates (CCW A→B→C). Shared edges always carry the
      // shared midpoint, so adjacent triangles tile without T-junctions.
      if (n === 3) {
        nt.push(a, mAB, mCA,  mAB, b, mBC,  mCA, mBC, c,  mAB, mBC, mCA);
      } else if (n === 1) {
        if (sAB) nt.push(a, mAB, c,  mAB, b, c);
        else if (sBC) nt.push(a, b, mBC,  a, mBC, c);
        else nt.push(a, b, mCA,  b, c, mCA);
      } else { // n === 2
        if (sAB && sBC) nt.push(a, mAB, mBC,  a, mBC, c,  mAB, b, mBC);
        else if (sBC && sCA) nt.push(a, b, mBC,  a, mBC, mCA,  mCA, mBC, c);
        else nt.push(mCA, a, mAB,  mAB, b, c,  mAB, c, mCA); // sCA && sAB
      }
    }
    tris = nt;
    if (!changed) break;
  }
  return { numProp: np, vertProperties: vp, triVerts: tris };
}

/**
 * Z-subdivide a real Manifold ahead of `applyWarp`, so the baked sine is smooth
 * rather than faceted. Returns a NEW (denser) Manifold, or the ORIGINAL
 * untouched on any of: freq ≤ 0 (flat warp), no Manifold runtime, a
 * property-duplicated mesh (would T-junction), input over the tri cap, nothing
 * to split, or a non-manifold rebuild (volume drift / 0 tris). `axis` is taken
 * for symmetry with the warp call — Z is ALWAYS the sampling axis because the
 * displacement is `sin(z·freq)` whichever lateral axis it moves.
 */
export function subdivideForWarp(manifold: any, freq: number, _axis: WarpAxis): any {
  const targetZLen = targetZLenForFreq(freq);
  if (!isFinite(targetZLen)) return manifold;
  const wasm = (globalThis as any).__cadtrain_manifold__?.wasm;
  if (!wasm?.Manifold || !wasm?.Mesh || typeof manifold?.getMesh !== 'function') return manifold;
  try {
    const src = manifold.getMesh();
    const numProp: number = src.numProp;
    if (numProp < 3) return manifold;
    // A property-split mesh (mergeFromVert non-empty) duplicates a position into
    // several indices, so index-keyed edges wouldn't match across the seam → the
    // rebuild would be non-manifold. The pre-normals CSG manifolds we warp are
    // position-only (numProp 3, no merges); bail safely on anything richer.
    const mergeLen = src.mergeFromVert ? src.mergeFromVert.length : 0;
    if (mergeLen > 0) return manifold;

    const inTris = src.triVerts.length / 3;
    if (inTris > MAX_INPUT_TRIS) {
      console.warn(`[warp] skip Z-subdivide: input ${inTris} tris exceeds ${MAX_INPUT_TRIS} cap (left faceted to protect bake time)`);
      return manifold;
    }

    const out = subdivideMeshAlongZ(
      { numProp, vertProperties: Array.from(src.vertProperties as Float32Array), triVerts: Array.from(src.triVerts as Uint32Array) },
      targetZLen,
    );
    if (out.triVerts.length === src.triVerts.length) return manifold; // nothing split

    const mesh = new wasm.Mesh({
      numProp,
      vertProperties: new Float32Array(out.vertProperties),
      triVerts: new Uint32Array(out.triVerts),
    });
    const refined = new wasm.Manifold(mesh);
    if (typeof refined.numTri === 'function' && refined.numTri() === 0) return manifold;
    // Subdivision must not change the SHAPE — only the triangulation. A volume
    // mismatch means the rebuild went non-manifold; fall back rather than ship
    // garbage (and dodge a downstream cutaway-CSG throw).
    const v0 = typeof manifold.volume === 'function' ? manifold.volume() : NaN;
    const v1 = typeof refined.volume === 'function' ? refined.volume() : NaN;
    if (Number.isFinite(v0) && Number.isFinite(v1) && v0 !== 0 && Math.abs(v1 - v0) / Math.abs(v0) > 1e-3) {
      return manifold;
    }
    return refined;
  } catch {
    return manifold;
  }
}
