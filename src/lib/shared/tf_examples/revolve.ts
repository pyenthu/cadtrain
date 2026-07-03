/**
 * tf_examples/revolve — a REUSABLE lathe for TrueForm.
 *
 * TrueForm has NO native revolve/lathe (see trueform-api-notes.md § ⛔) — its only
 * generator that follows a path is `tubeMesh` (a fixed CIRCULAR section). To build
 * a downhole revolved solid (a pin, a cone, a shouldered mandrel) we revolve a
 * CLOSED half-section polyline `[r,z][]` around the Z axis into a watertight
 * triangle mesh, then hand the faces+points to `tf.mesh(faces, points)`.
 *
 * The heavy lifting — `buildRevolveMesh` — is a PURE function (no WASM): it emits
 * the flat point + face buffers, so it is unit-testable for closed-ness / manifold
 * -ness without loading the 31 MB kernel (same split as `buildCappedMesh`).
 * `tfRevolveProfile` is the thin WASM wrapper: `tf.mesh(...)` + `positivelyOriented`.
 *
 * WHY IT'S WATERTIGHT: revolving a *closed* profile a full 360° connects every
 * profile edge across every angular segment AND wraps the last segment back to the
 * first — so every mesh edge is shared by exactly two triangles (a closed
 * 2-manifold), no separate end-caps needed. A profile whose min r > 0 (e.g. a bored
 * pin) gives a genus-1 solid (χ=0, a tube with a hole through it); a profile that
 * touches the axis (r=0, e.g. a cone apex / disk centre) collapses those points to
 * a SINGLE shared axis vertex so the fan closes cleanly (genus 0, χ=2).
 */
import type { FlatMesh } from '../trueform-client';

/** A half-section profile point `[r, z]` (r = radius from the Z axis, ≥ 0). */
export type ProfilePoint = readonly [number, number];

/** Points with |r| below this collapse onto the axis (shared single vertex). */
const AXIS_EPS = 1e-6;

/**
 * PURE lathe (no WASM) — revolve a CLOSED half-section profile `[r,z][]` a full
 * 360° into a flat triangle mesh (`{points:[V*3], faces:[F*3]}`). The profile is
 * an implicitly-closed loop: the last point connects back to the first.
 *
 * For each angular segment j (θ = 2π·j/segments) we place a RING of the profile
 * points (x = r·cosθ, y = r·sinθ, z). Consecutive rings j → j+1 (wrapping at the
 * end) are stitched: each profile edge k → k+1 becomes a quad (2 tris) spanning
 * the two rings. Profile points on the axis (r ≈ 0) are ONE shared vertex across
 * all rings, so a quad touching the axis degenerates to a single triangle (the
 * fan that closes a disk/apex) — degenerate tris (a repeated index) are dropped.
 * An axis→axis edge (both ends on the Z axis) contributes no surface and is
 * skipped entirely.
 *
 * Winding: every quad is emitted with the same corner order
 * (ring_j·k, ring_j·k+1, ring_{j+1}·k+1, ring_{j+1}·k) → tris (A,B,C)+(A,C,D), so
 * adjacent triangles traverse shared edges in opposite directions (consistent
 * orientation). The absolute in/out sign is fixed at build time by tf's
 * `positivelyOriented` in {@link tfRevolveProfile}.
 */
export function buildRevolveMesh(profile: readonly ProfilePoint[], segments: number): FlatMesh {
  const P = profile.length;
  const S = Math.max(3, Math.floor(segments));
  if (P < 2) return { points: new Float32Array(0), faces: new Int32Array(0) };

  const pts: number[] = [];
  // vid[k][j] = vertex index of profile point k at angular segment j. Axis points
  // (r≈0) get ONE vertex reused for every j.
  const vid: number[][] = new Array(P);
  const isAxis: boolean[] = new Array(P);

  for (let k = 0; k < P; k++) {
    const r = profile[k][0];
    const z = profile[k][1];
    if (Math.abs(r) < AXIS_EPS) {
      isAxis[k] = true;
      const idx = pts.length / 3;
      pts.push(0, 0, z);
      vid[k] = new Array(S).fill(idx); // shared across all segments
    } else {
      isAxis[k] = false;
      const row = new Array<number>(S);
      for (let j = 0; j < S; j++) {
        const a = (j / S) * 2 * Math.PI;
        row[j] = pts.length / 3;
        pts.push(r * Math.cos(a), r * Math.sin(a), z);
      }
      vid[k] = row;
    }
  }

  const faces: number[] = [];
  const pushTri = (a: number, b: number, c: number) => {
    if (a === b || b === c || c === a) return; // drop degenerate (axis-collapsed)
    faces.push(a, b, c);
  };
  for (let k = 0; k < P; k++) {
    const kn = (k + 1) % P;
    if (isAxis[k] && isAxis[kn]) continue; // axis segment → no surface
    for (let j = 0; j < S; j++) {
      const jn = (j + 1) % S;
      const A = vid[k][j], B = vid[kn][j], C = vid[kn][jn], D = vid[k][jn];
      pushTri(A, B, C);
      pushTri(A, C, D);
    }
  }
  return { points: Float32Array.from(pts), faces: Int32Array.from(faces) };
}

/**
 * Revolve a CLOSED half-section profile into a watertight TrueForm `Mesh` (the
 * WASM wrapper around {@link buildRevolveMesh}). Builds the flat buffers, hands
 * them to `tf.mesh(faces, points)`, then runs `positivelyOriented` so walls +
 * caps share ONE outward orientation (positive signed volume) — tf's freshly
 * built walls can come back inward, exactly like `capOpenEnds`'s note. `t` is the
 * initialised tf module (`ensureTf()`'d by the caller). Returns the tf `Mesh`.
 */
export function tfRevolveProfile(t: any, profile: readonly ProfilePoint[], segments = 64): any {
  const { points, faces } = buildRevolveMesh(profile, segments);
  let m = t.mesh(faces, points);
  try { m = t.positivelyOriented(m); } catch { /* keep the plain revolved mesh */ }
  return m;
}
