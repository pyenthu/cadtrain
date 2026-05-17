/**
 * Server-side GLB bake. Initializes ManifoldCAD WASM in Node, runs a
 * primitive's geom() with default params, converts the resulting mesh
 * into a glTF Document via @gltf-transform/core, writes the .glb to
 * static/components/<id>.glb.
 *
 * The endpoint at /components/<id>.glb then serves the file as a static
 * asset — zero server compute per request after the bake.
 *
 * The Manifold WASM init is cached at module scope; first bake pays the
 * cost (~50ms), subsequent bakes are pure compute. Safe to run from
 * inside a request handler — the bake itself takes ~10–100ms for the
 * primitives we have.
 */

import { Document, NodeIO } from '@gltf-transform/core';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
// Critical: use the shared init from manifold-helpers so the SAME `M`
// reference that the component geom functions (cyl, tube, mv) close over
// gets populated. A second-init (private to this module) would leave
// the helpers' M as null and the geom would throw when called.
import { initManifold, getCutBox } from '../cad/manifold-helpers';

const STATIC_DIR = join(process.cwd(), 'static', 'components');

/**
 * Convert a Manifold mesh into a binary glTF Document.
 *
 * - `coloured: false` (full bake) emits a tight INDEXED primitive with
 *   POSITION + indices only — the smallest representation. The client
 *   renders it as solid red (matches the live cutaway-off view). This
 *   is ~3× smaller than the non-indexed equivalent.
 * - `coloured: true` (cut bake) emits NON-INDEXED positions + per-face
 *   COLOR_0, running the same red-outer / grey-bore classification
 *   builder.ts → manifoldToCutVC uses. Non-indexed because per-face
 *   colours need per-triangle vertices (sharing would average across
 *   the red→grey seam).
 */
function manifoldToGltf(manifold: any, maxOD: number, coloured: boolean): Document {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp ?? 3;
  const verts = mesh.vertProperties as Float32Array;
  const tris  = mesh.triVerts     as Uint32Array;
  const nv = verts.length / numProp;

  // De-interleave to a positions-only view we can either upload directly
  // (indexed path) or scatter per-triangle (non-indexed path).
  const vpos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    vpos[i * 3 + 0] = verts[i * numProp + 0];
    vpos[i * 3 + 1] = verts[i * numProp + 1];
    vpos[i * 3 + 2] = verts[i * numProp + 2];
  }

  const doc = new Document();
  const buf = doc.createBuffer();

  if (!coloured) {
    // INDEXED, positions only — smallest representation. Client renders
    // it as solid red. Saves ~3× over the non-indexed path.
    const positionAcc = doc.createAccessor().setType('VEC3').setArray(vpos).setBuffer(buf);
    const indexAcc    = doc.createAccessor().setType('SCALAR').setArray(tris).setBuffer(buf);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', positionAcc)
      .setIndices(indexAcc);
    const meshNode = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setMesh(meshNode);
    doc.createScene().addChild(node);
    return doc;
  }

  // NON-INDEXED, per-face colours. Same red-outer / grey-bore
  // classification builder.ts → manifoldToCutVC uses.
  const nt = tris.length / 3;
  const positions = new Float32Array(nt * 9);
  const colors    = new Float32Array(nt * 9);
  for (let i = 0; i < nt; i++) {
    const a = tris[i * 3], b = tris[i * 3 + 1], c = tris[i * 3 + 2];
    const ax = vpos[a * 3], ay = vpos[a * 3 + 1], az = vpos[a * 3 + 2];
    const bx = vpos[b * 3], by = vpos[b * 3 + 1], bz = vpos[b * 3 + 2];
    const cx = vpos[c * 3], cy = vpos[c * 3 + 1], cz = vpos[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3;
    const centroidR = Math.sqrt(mx * mx + my * my);
    const radialDot = centroidR > 0.01 ? (nx * mx + ny * my) / (centroidR * nLen) : 0;
    const eps = 0.02;
    const isBore = radialDot < -0.3;
    const onCutX = Math.abs(ax) < eps && Math.abs(bx) < eps && Math.abs(cx) < eps;
    const onCutY = Math.abs(ay) < eps && Math.abs(by) < eps && Math.abs(cy) < eps;
    const nzNorm = Math.abs(nz / nLen);
    const maxR = Math.max(Math.sqrt(ax * ax + ay * ay), Math.sqrt(bx * bx + by * by), Math.sqrt(cx * cx + cy * cy));
    const isGrey = isBore || (onCutX || onCutY) || (nzNorm > 0.8 && maxR < maxOD / 2 + 0.05);
    const r = isGrey ? 0.45 : 0.8;
    const g = isGrey ? 0.45 : 0.06;
    const b2 = isGrey ? 0.45 : 0.06;
    const idx = i * 9;
    positions[idx] = ax; positions[idx + 1] = ay; positions[idx + 2] = az;
    positions[idx + 3] = bx; positions[idx + 4] = by; positions[idx + 5] = bz;
    positions[idx + 6] = cx; positions[idx + 7] = cy; positions[idx + 8] = cz;
    colors[idx] = r; colors[idx + 1] = g; colors[idx + 2] = b2;
    colors[idx + 3] = r; colors[idx + 4] = g; colors[idx + 5] = b2;
    colors[idx + 6] = r; colors[idx + 7] = g; colors[idx + 8] = b2;
  }
  const positionAcc = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buf);
  const colorAcc    = doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(buf);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', positionAcc)
    .setAttribute('COLOR_0',  colorAcc);
  const mat = doc.createMaterial()
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  prim.setMaterial(mat);
  const meshNode = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(meshNode);
  doc.createScene().addChild(node);
  return doc;
}

/** Same heuristic builder.ts uses for sizing the cut box / cap test. */
function pickMaxOD(defaults: Record<string, number>): number {
  return Math.max(
    defaults.od || 0,
    defaults.odTop || 0,
    defaults.odBottom || 0,
    defaults.odLarge || 0,
    defaults.slipOD || 0,
    defaults.odCompressed || 0,
    3,
  );
}

export interface BakeResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  cutPath?: string;
  cutBytes?: number;
  error?: string;
}

/**
 * Bake `<id>.glb` (full mesh) AND `<id>.cut.glb` (half-sectioned via
 * the shared getCutBox() — same cut the live cutaway view applies in
 * finalizeManifold). Two separate files keep the static-asset path
 * simple: the GLB stage tab loads one or the other based on the
 * cutaway toggle. Cut bake failure is logged but doesn't fail the
 * whole bake — the full GLB stays the primary deliverable.
 *
 * `outDir` (optional): override the output directory and bake to
 *   `<outDir>/mesh.glb` + `<outDir>/mesh.cut.glb` instead of the
 *   default `<STATIC_DIR>/<id>.glb` + `<STATIC_DIR>/<id>.cut.glb`.
 *   Used for library parts so the GLB lives inside the part directory
 *   (per the directory-per-part contract in CLAUDE.md Rule 18).
 */
export async function bakeGlb(
  id: string,
  geom: (p: Record<string, number>) => any,
  defaults: Record<string, number>,
  outDir?: string,
): Promise<BakeResult> {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    return { ok: false, error: `Invalid id "${id}"` };
  }
  try {
    await initManifold();
    const manifold = geom(defaults);
    if (!manifold || typeof manifold.getMesh !== 'function') {
      return { ok: false, error: 'geom() did not return a Manifold instance' };
    }
    const targetDir = outDir ?? STATIC_DIR;
    const fullName = outDir ? 'mesh.glb' : `${id}.glb`;
    const cutName = outDir ? 'mesh.cut.glb' : `${id}.cut.glb`;
    await mkdir(targetDir, { recursive: true });
    const io = new NodeIO();
    const maxOD = pickMaxOD(defaults);
    // 1. Full mesh — indexed, positions only. Smallest format; the
    //    client paints it solid red.
    const doc = manifoldToGltf(manifold, maxOD, false);
    const glb = await io.writeBinary(doc);
    const path = join(targetDir, fullName);
    await writeFile(path, glb);
    const result: BakeResult = { ok: true, path, bytes: glb.byteLength };
    // 2. Half-sectioned mesh — non-indexed with per-face colours so the
    //    grey bore reads against the red outer. Best effort.
    try {
      const cutManifold = manifold.subtract(getCutBox());
      const cutDoc = manifoldToGltf(cutManifold, maxOD, true);
      const cutGlb = await io.writeBinary(cutDoc);
      const cutPath = join(targetDir, cutName);
      await writeFile(cutPath, cutGlb);
      result.cutPath = cutPath;
      result.cutBytes = cutGlb.byteLength;
    } catch {
      // Cut bake failed (component might already be open / one-sided);
      // the full GLB remains available.
    }
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
