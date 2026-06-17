/**
 * Bench: Manifold build-time smoothing (smoothOut + refineToTolerance).
 *
 * Demonstrates lifting a COARSE/faceted revolve onto a smooth (near-NURBS)
 * surface at build time, crease-aware. Builds a LOW-segment revolve cylinder
 * via the welded toolkit, then compares raw vs `smoothOut(60).refineToTolerance`
 * tri/vert counts + timing, and confirms the top/bottom caps stay sharp (axial
 * normals) while the curved wall gains the new verts.
 *
 * Run:  bun scripts/bench-smooth-refine.ts
 * Not part of the vitest suite (it's a manual prototype harness).
 */
import { initManifold } from '../src/lib/cad/manifold-helpers';
import { revolveProfile, weldAndBuild } from '../src/lib/cad/manifold-mesh';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function main() {
  await initManifold();

  // A solid cylinder: R = 1, H = 3. Profile traversed axis→rim→up→back so the
  // welded winding yields a POSITIVE-volume (outward) solid. The two cap edges
  // touch the axis (r≈0) → triangle fans; the long r=1 wall edge → quad ring.
  const profile: [number, number][] = [[0, 0], [1, 0], [1, 3], [0, 3]];
  const SEGMENTS = 12; // deliberately coarse → a visibly faceted barrel
  const maxOD = 2; // diameter = 2·R

  const m0 = weldAndBuild([revolveProfile(profile, SEGMENTS)]);
  const mesh0 = m0.getMesh();
  const rawTri = mesh0.triVerts.length / 3;
  const rawVert = mesh0.vertProperties.length / mesh0.numProp;
  const bb0 = m0.boundingBox();

  // smoothOut fills the halfedge tangents (geometry UNCHANGED); refineToTolerance
  // then splits edges adaptively so every vertex lands within `tol` of the smooth
  // surface. 60° keeps the 90° wall↔cap seams sharp; the wall (G1) subdivides.
  const tol = maxOD * 0.004; // 0.008
  const t0 = now();
  const m1 = m0.smoothOut(60, 0).refineToTolerance(tol);
  const mesh1 = m1.getMesh();
  const t1 = now();
  const smTri = mesh1.triVerts.length / 3;
  const smVert = mesh1.vertProperties.length / mesh1.numProp;
  const bb1 = m1.boundingBox();

  // ── Roundness (silhouette) metric ──────────────────────────────────────
  // A cylinder's ONLY curvature is circumferential, so smoothing adds angular
  // samples around the rim → the cross-section goes from a 12-gon toward a true
  // circle. Count DISTINCT theta angles among rim verts (r≈1) as a proxy for
  // the silhouette resolution; also report max radial deviation from R=1.
  const rimAngles = (mesh: any) => {
    const np = mesh.numProp;
    const set = new Set<number>();
    let maxR = 0, minR = Infinity;
    for (let i = 0; i < mesh.vertProperties.length; i += np) {
      const x = mesh.vertProperties[i], y = mesh.vertProperties[i + 1];
      const r = Math.hypot(x, y);
      if (r > 0.5) { // a rim/wall vert (excludes the axis cap-center points)
        set.add(Math.round((Math.atan2(y, x) * 180 / Math.PI) * 10) / 10);
        maxR = Math.max(maxR, r); minR = Math.min(minR, r);
      }
    }
    return { angles: set.size, maxR, minR };
  };
  const r0 = rimAngles(mesh0);
  const r1 = rimAngles(mesh1);

  // ── Cap-flatness / crease check via FACE normals ────────────────────────
  // Classify each triangle: bottom-cap faces should have a purely -z normal,
  // top-cap +z, wall faces a radial (≈0 z) normal. If smoothOut(60) kept the
  // 90° wall↔cap seam sharp AND flat faces flat, the cap faces stay perfectly
  // axial (|nz|≈1) — no doming. Any cap face that bulged would tilt its normal.
  const faceNormalStats = (mesh: any) => {
    const np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
    let botMaxTilt = 0, topMaxTilt = 0, botN = 0, topN = 0, wallN = 0;
    const v = (idx: number, c: number) => vp[idx * np + c];
    for (let t = 0; t < tv.length; t += 3) {
      const a = tv[t], b = tv[t + 1], c = tv[t + 2];
      const ax = v(a, 0), ay = v(a, 1), az = v(a, 2);
      const bx = v(b, 0), by = v(b, 1), bz = v(b, 2);
      const cx = v(c, 0), cy = v(c, 1), cz = v(c, 2);
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
      const zc = (az + bz + cz) / 3;
      if (Math.abs(zc) < 1e-3) { botN++; botMaxTilt = Math.max(botMaxTilt, Math.hypot(nx, ny)); }
      else if (Math.abs(zc - 3) < 1e-3) { topN++; topMaxTilt = Math.max(topMaxTilt, Math.hypot(nx, ny)); }
      else wallN++;
    }
    // tilt = sin of the angle off the z-axis; ~0 ⇒ a perfectly axial (flat) cap.
    return { botN, topN, wallN, botMaxTilt, topMaxTilt };
  };
  const fn0 = faceNormalStats(mesh0);
  const fn1 = faceNormalStats(mesh1);

  const f = (n: number) => n.toFixed(3);
  console.log('\n=== Manifold build-time smoothing bench (12-seg cylinder R=1 H=3) ===\n');
  console.log(`raw      : ${rawTri} tris, ${rawVert} verts`);
  console.log(`           rim angular samples=${r0.angles}, radius=[${f(r0.minR)}, ${f(r0.maxR)}]`);
  console.log(`           cap faces: bottom=${fn0.botN} top=${fn0.topN} wall=${fn0.wallN}`);
  console.log(`           bbox z=[${f(bb0.min[2])}, ${f(bb0.max[2])}]  x=[${f(bb0.min[0])}, ${f(bb0.max[0])}]`);
  console.log(`smoothed : ${smTri} tris, ${smVert} verts   (smoothOut(60).refineToTolerance(${tol}))`);
  console.log(`           rim angular samples=${r1.angles}, radius=[${f(r1.minR)}, ${f(r1.maxR)}]`);
  console.log(`           cap faces: bottom=${fn1.botN} top=${fn1.topN} wall=${fn1.wallN}`);
  console.log(`           bbox z=[${f(bb1.min[2])}, ${f(bb1.max[2])}]  x=[${f(bb1.min[0])}, ${f(bb1.max[0])}]`);
  console.log(`timing   : smoothOut+refineToTolerance+getMesh = ${(t1 - t0).toFixed(2)} ms`);
  console.log(`ratios   : tris ×${(smTri / rawTri).toFixed(1)}, verts ×${(smVert / rawVert).toFixed(1)}, rim-samples ×${(r1.angles / Math.max(1, r0.angles)).toFixed(1)}`);
  const bboxStable = Math.abs(bb1.min[2] - bb0.min[2]) < 1e-3 && Math.abs(bb1.max[2] - bb0.max[2]) < 1e-3;
  const capsFlat = fn1.botMaxTilt < 1e-3 && fn1.topMaxTilt < 1e-3;
  const rounder = r1.angles > r0.angles * 2;
  console.log(`\ncaps stayed FLAT (face normals axial, |xy-tilt|<1e-3): ${capsFlat ? 'PASS' : 'FAIL'}  (bottom tilt=${fn1.botMaxTilt.toExponential(1)}, top=${fn1.topMaxTilt.toExponential(1)})`);
  console.log(`silhouette ROUNDER (rim samples ${r0.angles}→${r1.angles}): ${rounder ? 'PASS' : 'FAIL'}`);
  console.log(`bbox stable (smooth within hull, no bloat): ${bboxStable ? 'PASS' : 'FAIL'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
