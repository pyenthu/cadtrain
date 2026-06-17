/**
 * PROBE: (A) run the gyroid levelSet (SDF) to confirm it works in our core
 * manifold-3d; (B) the smoothing proof — on a WELDED revolve, compare
 * smoothOut (geometry tangents) vs calculateNormals(0,60)+smoothByNormals(0),
 * plus a clean Manifold.cylinder control. Metric = wall-vertex radius spread
 * (a true circle → all ≈ R; a wavy reconstruction → dips well below R).
 *   bun scripts/test-gyroid-and-smooth.ts
 */
import { initManifold, M } from '../src/lib/cad/manifold-helpers';
import { revolveProfile, weldAndBuild } from '../src/lib/cad/manifold-mesh';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// RIM radius spread: a cylinder's circle lives on the rim circles (z≈0 / z≈H);
// refine fills the 8-gon corners in toward the true circle. r>0.5 excludes the
// axis cap-centre. min dipping toward 0.7x = wavy reconstruction; ≈R = clean.
function wallRadius(m: any, H = 3) {
  const mesh = m.getMesh(); const np = mesh.numProp, vp = mesh.vertProperties;
  let min = Infinity, max = 0, n = 0;
  for (let i = 0; i < vp.length; i += np) {
    const x = vp[i], y = vp[i + 1], z = vp[i + 2];
    const onRim = z < 0.05 || z > H - 0.05;
    if (onRim) { const r = Math.hypot(x, y); if (r > 0.5) { min = Math.min(min, r); max = Math.max(max, r); n++; } }
  }
  const tris = mesh.triVerts.length / 3;
  return `rim r=[${(min === Infinity ? 0 : min).toFixed(4)}, ${max.toFixed(4)}]  rimVerts=${n}  tris=${tris}`;
}

async function main() {
  await initManifold();

  // ── A. Gyroid via levelSet (SDF) ────────────────────────────────────────
  const pi = 3.14159;
  const gyroid = (p: number[]) => {
    const x = p[0] - pi / 4, y = p[1] - pi / 4, z = p[2] - pi / 4;
    return Math.cos(x) * Math.sin(y) + Math.cos(y) * Math.sin(z) + Math.cos(z) * Math.sin(x);
  };
  const period = 2 * pi;
  const bounds = { min: [-period, -period, -period], max: [period, period, period] };
  console.log('=== A. Gyroid levelSet (SDF) ===');
  try {
    const t0 = now();
    const g = M.levelSet(gyroid, bounds, period / 20, -0.4);
    const t1 = now();
    const gm = g.getMesh();
    console.log(`  levelSet OK: ${gm.triVerts.length / 3} tris, ${gm.vertProperties.length / gm.numProp} verts, ${(t1 - t0).toFixed(1)} ms`);
    console.log(`  → smooth organic surface from a math function, no profile/segments.\n`);
  } catch (e: any) { console.log(`  levelSet FAILED: ${e?.message ?? e}\n`); }

  // ── B. Smoothing proof — REPLICATE Manifold's Precision test EXACTLY ─────
  //   smoothOut().refineToTolerance(tol).refine(2), then measure WALL verts
  //   (exclude the z≈0 / z≈H caps — the cap transition dips, the test ignores it).
  console.log('=== B. Smooth a faceted cylinder (R=10, H=10, 8-gon) — Manifold-test style ===');
  const R = 10, H = 10, tol = 0.001;
  // True-wall radius: exclude caps (z≈0 / z≈H), measure the rest.
  const wallTrue = (m: any) => {
    const mesh = m.refine(2).getMesh(); const np = mesh.numProp, vp = mesh.vertProperties;
    let min = Infinity, max = 0, n = 0;
    for (let i = 0; i < vp.length; i += np) {
      const x = vp[i], y = vp[i + 1], z = vp[i + 2];
      if (Math.abs(z) < 0.01 || Math.abs(z - H) < 0.01) continue; // skip caps (test does this)
      const r = Math.hypot(x, y); min = Math.min(min, r); max = Math.max(max, r); n++;
    }
    return `wall r=[${(min === Infinity ? 0 : min).toFixed(4)}, ${max.toFixed(4)}]  wallVerts=${n}  (target ≈ ${R})`;
  };

  // B1: clean Manifold.cylinder — exact replica of TEST(Smooth, Precision).
  try {
    const cyl = M.cylinder(H, R, R, 8);
    const cs = cyl.smoothOut(60, 0).refineToTolerance(tol);
    console.log(`  clean cyl.smoothOut         : ${wallTrue(cs)}`);
  } catch (e: any) { console.log(`  clean cyl FAILED: ${e?.message ?? e}`); }

  // B2: our WELDED revolve, same pipeline + smoothOut (geometry tangents).
  const profile: [number, number][] = [[0, 0], [R, 0], [R, H], [0, H]];
  const welded = weldAndBuild([revolveProfile(profile, 8)]);
  try {
    const so = welded.smoothOut(60, 0).refineToTolerance(tol);
    console.log(`  welded.smoothOut            : ${wallTrue(so)}`);
  } catch (e: any) { console.log(`  welded.smoothOut FAILED: ${e?.message ?? e}`); }

  // B3: welded + smoothByNormals(0) using our radial normals (Fillet pattern).
  try {
    const sbn = welded.calculateNormals(0, 60).smoothByNormals(0).refineToTolerance(tol);
    console.log(`  welded.smoothByNormals(0)   : ${wallTrue(sbn)}`);
  } catch (e: any) { console.log(`  welded.smoothByNormals FAILED: ${e?.message ?? e}`); }

  console.log(`\n(Manifold's TEST(Smooth,Precision) asserts wall r within ${tol} of ${R}. Clean ≈ [${(R - tol).toFixed(3)}, ${R}.000].)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
