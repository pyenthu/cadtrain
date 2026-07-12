/**
 * PROBE: what does calculateNormals(normalIdx) actually do in our installed
 * manifold-3d, on a WELDED revolve? Compares slot 3 (current) vs slot 0.
 *   bun scripts/test-normals-slot.ts
 */
import { createRequire } from 'module';
import { initManifold } from '../src/lib/engines/manifold/manifold-helpers';
import { revolveProfile, weldAndBuild } from '../src/lib/engines/manifold/manifold-mesh';

function ver() {
  try { return createRequire(import.meta.url)('manifold-3d/package.json').version; }
  catch { return '?'; }
}

// Stats for a normal stored at channel `off` (off..off+2). Reports zero vs
// non-zero count + whether the unit length holds, plus a couple of samples.
function normalStats(mesh: any, off: number) {
  const np = mesh.numProp, vp = mesh.vertProperties;
  if (off + 2 >= np) return { note: `no channel ${off}..${off + 2} (numProp=${np})` };
  let zero = 0, nonzero = 0, total = 0; const sample: string[] = [];
  for (let i = 0; i < vp.length; i += np) {
    const nx = vp[i + off], ny = vp[i + off + 1], nz = vp[i + off + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) zero++; else nonzero++;
    total++;
    if (sample.length < 3) sample.push(`(${nx.toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)})`);
  }
  return { numProp: np, total, zero, nonzero, sample };
}

// Position sanity: first wall vert should sit at radius ~1 if position is intact.
function posCheck(mesh: any) {
  const np = mesh.numProp, vp = mesh.vertProperties;
  let maxR = 0;
  for (let i = 0; i < vp.length; i += np) maxR = Math.max(maxR, Math.hypot(vp[i], vp[i + 1]));
  return { maxRadiusXY: maxR.toFixed(3) }; // ~1.0 = position intact; ~0/garbage = clobbered
}

async function main() {
  await initManifold();
  console.log(`manifold-3d version: ${ver()}\n`);

  const profile: [number, number][] = [[0, 0], [1, 0], [1, 3], [0, 3]];
  const base = weldAndBuild([revolveProfile(profile, 12)]); // 12-seg welded cylinder, R=1
  const raw = base.getMesh();
  console.log(`raw welded revolve: numProp=${raw.numProp}, verts=${raw.vertProperties.length / raw.numProp}`);
  console.log(`  position intact?  ${JSON.stringify(posCheck(raw))}\n`);

  // CURRENT cadtrain path: slot 3.
  const m3 = base.calculateNormals(3, 60);
  const mesh3 = m3.getMesh();
  console.log(`calculateNormals(3, 60):`);
  console.log(`  position:        ${JSON.stringify(posCheck(mesh3))}`);
  console.log(`  normals @ 3..5:  ${JSON.stringify(normalStats(mesh3, 3))}\n`);

  // PROPOSED path: slot 0.
  const m0 = base.calculateNormals(0, 60);
  const mesh0 = m0.getMesh();
  console.log(`calculateNormals(0, 60):`);
  console.log(`  position:        ${JSON.stringify(posCheck(mesh0))}   <-- maxRadius ~1.0 = position SAFE, ~0/garbage = CLOBBERED`);
  console.log(`  normals @ 0..2:  ${JSON.stringify(normalStats(mesh0, 0))}`);
  console.log(`  normals @ 3..5:  ${JSON.stringify(normalStats(mesh0, 3))}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
