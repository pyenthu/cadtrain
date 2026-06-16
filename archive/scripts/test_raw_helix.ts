/**
 * Raw-mesh ladder with the SVTC ordered-grid pattern.
 *
 * Two findings from the first failed run:
 *
 *  (1) The SVTC indexing `tri1=a,b,e ; tri2=a,e,d` with walks a→b along v
 *      and a→d along u produces normals in the -du×dv direction. So if
 *      you want outward normals, set up each face frame so du × dv =
 *      INWARD (and SVTC's emit then gives outward).
 *
 *  (2) The Manifold constructor does NOT silently weld coincident
 *      vertices in this version. Six grid patches share 8 unique
 *      corners but generate 24 vert slots — we have to weld them to
 *      indices before handing the mesh to Manifold.
 */

import Module from 'manifold-3d';

type V3 = [number, number, number];

function gridVertsAndTris(
  uN: number,
  vN: number,
  fn: (u: number, v: number) => V3,
): { verts: Float32Array; tris: Uint32Array } {
  const verts = new Float32Array((uN + 1) * (vN + 1) * 3);
  let i = 0;
  for (let r = 0; r <= uN; r++) {
    for (let c = 0; c <= vN; c++) {
      const [x, y, z] = fn(r / uN, c / vN);
      verts[i++] = x;
      verts[i++] = y;
      verts[i++] = z;
    }
  }
  const tris = new Uint32Array(uN * vN * 6);
  let k = 0;
  for (let r = 0; r < uN; r++) {
    for (let c = 0; c < vN; c++) {
      const a = r * (vN + 1) + c;
      const b = a + 1;
      const d = a + (vN + 1);
      const e = d + 1;
      // SVTC order. Normal of (a,b,e) = (b-a)×(e-a) = dv × (du+dv) = -du×dv.
      tris[k++] = a; tris[k++] = b; tris[k++] = e;
      tris[k++] = a; tris[k++] = e; tris[k++] = d;
    }
  }
  return { verts, tris };
}

/** Concatenate patches into one buffer, re-indexing tris. */
function mergePatches(patches: { verts: Float32Array; tris: Uint32Array }[]) {
  let totalV = 0, totalT = 0;
  for (const p of patches) { totalV += p.verts.length; totalT += p.tris.length; }
  const verts = new Float32Array(totalV);
  const tris = new Uint32Array(totalT);
  let vOff = 0, tOff = 0, baseIdx = 0;
  for (const p of patches) {
    verts.set(p.verts, vOff);
    for (let i = 0; i < p.tris.length; i++) tris[tOff + i] = p.tris[i] + baseIdx;
    vOff += p.verts.length;
    tOff += p.tris.length;
    baseIdx += p.verts.length / 3;
  }
  return { verts, tris };
}

/** Position-weld duplicate vertices. Rounds to 1e-6 to merge near-coincident
 *  corners across grid patches. Re-indexes tris into the deduped vertex list. */
function weldVertices(
  verts: Float32Array,
  tris: Uint32Array,
  eps = 1e-6,
): { verts: Float32Array; tris: Uint32Array } {
  const numV = verts.length / 3;
  const keyOf = (x: number, y: number, z: number) => {
    const fx = Math.round(x / eps);
    const fy = Math.round(y / eps);
    const fz = Math.round(z / eps);
    return `${fx},${fy},${fz}`;
  };
  const map = new Map<string, number>();
  const newPos: number[] = [];
  const oldToNew = new Uint32Array(numV);
  for (let i = 0; i < numV; i++) {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    const k = keyOf(x, y, z);
    let idx = map.get(k);
    if (idx === undefined) {
      idx = newPos.length / 3;
      newPos.push(x, y, z);
      map.set(k, idx);
    }
    oldToNew[i] = idx;
  }
  const newTris = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) newTris[i] = oldToNew[tris[i]];
  return { verts: new Float32Array(newPos), tris: newTris };
}

async function main() {
  const wasm = await Module();
  wasm.setup();
  wasm.setCircularSegments(64);
  const { Manifold, Mesh } = wasm;

  function tryBuild(label: string, verts: Float32Array, tris: Uint32Array) {
    let m: any;
    try {
      m = new Manifold(new Mesh({ numProp: 3, vertProperties: verts, triVerts: tris } as any));
    } catch (e: any) {
      console.log(`  ${label}: ❌ ctor threw — ${e?.message ?? e}`);
      return null;
    }
    const status = m.status();
    const numV = verts.length / 3;
    const numT = tris.length / 3;
    if (status !== 'NoError' && status !== 0) {
      console.log(`  ${label}: ❌ status=${status} (verts=${numV}, tris=${numT})`);
      return null;
    }
    const outT = m.getMesh().triVerts.length / 3;
    console.log(`  ${label}: ✓ status=${status} (${numV} verts, ${numT} tris → ${outT} tris)`);
    return m;
  }

  // ─── Cube — 6 grid patches, frames chosen so SVTC-wind = OUTWARD ──
  console.log('Step B — cube from 6 grid patches (SVTC-wound, welded)');
  const face = (origin: V3, du: V3, dv: V3) => (u: number, v: number): V3 => [
    origin[0] + du[0] * u + dv[0] * v,
    origin[1] + du[1] * u + dv[1] * v,
    origin[2] + du[2] * u + dv[2] * v,
  ];
  // Each face: -du × dv must equal outward normal.
  // bottom (out −z): want du×dv = +z. du=+x, dv=+y.
  // top    (out +z): want du×dv = −z. du=+x, dv=−y.
  // front  (out −y): want du×dv = +y. du=+z, dv=+x.
  // back   (out +y): want du×dv = −y. du=+x, dv=+z.
  // left   (out −x): want du×dv = +x. du=+y, dv=+z.
  // right  (out +x): want du×dv = −x. du=+z, dv=+y.
  const faces = [
    gridVertsAndTris(1, 1, face([0, 0, 0], [1, 0, 0], [0, 1, 0])), // bottom
    gridVertsAndTris(1, 1, face([0, 1, 1], [1, 0, 0], [0, -1, 0])), // top
    gridVertsAndTris(1, 1, face([0, 0, 0], [0, 0, 1], [1, 0, 0])), // front
    gridVertsAndTris(1, 1, face([0, 1, 0], [1, 0, 0], [0, 0, 1])), // back
    gridVertsAndTris(1, 1, face([0, 0, 0], [0, 1, 0], [0, 0, 1])), // left
    gridVertsAndTris(1, 1, face([1, 0, 0], [0, 0, 1], [0, 1, 0])), // right
  ];
  const merged = mergePatches(faces);
  const welded = weldVertices(merged.verts, merged.tris);
  console.log(`  before weld: ${merged.verts.length / 3} verts → after: ${welded.verts.length / 3}`);
  const cube = tryBuild('cube-6-patches', welded.verts, welded.tris);
  if (!cube) return console.log('  bail.');

  // ─── CSG smoke on the cube ────────────────────────────────────────
  console.log('Step C — cube − inner cube');
  const inner = Manifold.cube([0.6, 0.6, 1.4] as any, true).translate([0.5, 0.5, 0.5]);
  const cubeMinus = cube.subtract(inner);
  console.log(`  ✓ cube − inner: ${cubeMinus.getMesh().triVerts.length / 3} tris`);

  const sphere = Manifold.sphere(0.4).translate([0.5, 0.5, 0.5]);
  const cubeMinusSphere = cube.subtract(sphere);
  console.log(`  ✓ cube − sphere: ${cubeMinusSphere.getMesh().triVerts.length / 3} tris`);
}

main().catch((e) => {
  console.error('FAIL:', e?.message ?? e);
  process.exit(1);
});
