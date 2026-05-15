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
 * Convert a Manifold mesh into a binary glTF Document with per-vertex
 * colors that match the live cutaway view (red outer surface · grey
 * bore + cut interior). Port of the per-triangle classification in
 * builder.ts → manifoldToCutVC.
 *
 * The geometry is emitted non-indexed (one set of three vertices per
 * triangle) because the colors are per-FACE, not per-vertex — sharing
 * vertices between triangles would average their colors. A baseColor
 * factor of white + vertexColors-enabled glTF material lets the colors
 * drive the appearance unchanged through three.js's MeshStandardMaterial
 * default; the client further overrides to MeshPhongMaterial flat-shaded.
 */
function manifoldToGltf(manifold: any, maxOD: number): Document {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp ?? 3;
  const verts = mesh.vertProperties as Float32Array;
  const tris  = mesh.triVerts     as Uint32Array;
  const nt = tris.length / 3;

  // De-interleave to a positions-only view we can index by vertex.
  const nv = verts.length / numProp;
  const vpos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    vpos[i * 3 + 0] = verts[i * numProp + 0];
    vpos[i * 3 + 1] = verts[i * numProp + 1];
    vpos[i * 3 + 2] = verts[i * numProp + 2];
  }

  const positions = new Float32Array(nt * 9);
  const colors    = new Float32Array(nt * 9);
  for (let i = 0; i < nt; i++) {
    const a = tris[i * 3], b = tris[i * 3 + 1], c = tris[i * 3 + 2];
    const ax = vpos[a * 3], ay = vpos[a * 3 + 1], az = vpos[a * 3 + 2];
    const bx = vpos[b * 3], by = vpos[b * 3 + 1], bz = vpos[b * 3 + 2];
    const cx = vpos[c * 3], cy = vpos[c * 3 + 1], cz = vpos[c * 3 + 2];
    // Triangle normal via cross of edges.
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    // Classification — mirrors builder.ts manifoldToCutVC exactly.
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

  const doc = new Document();
  const buf = doc.createBuffer();
  const positionAcc = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buf);
  const colorAcc    = doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(buf);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', positionAcc)
    .setAttribute('COLOR_0',  colorAcc);
  // White base + vertex colors pass through unchanged. Matte (no metal,
  // full roughness) so per-face flat shading the client applies later
  // reads correctly.
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
 */
export async function bakeGlb(
  id: string,
  geom: (p: Record<string, number>) => any,
  defaults: Record<string, number>,
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
    await mkdir(STATIC_DIR, { recursive: true });
    const io = new NodeIO();
    const maxOD = pickMaxOD(defaults);
    // 1. Full mesh.
    const doc = manifoldToGltf(manifold, maxOD);
    const glb = await io.writeBinary(doc);
    const path = join(STATIC_DIR, `${id}.glb`);
    await writeFile(path, glb);
    const result: BakeResult = { ok: true, path, bytes: glb.byteLength };
    // 2. Half-sectioned mesh — best effort.
    try {
      const cutManifold = manifold.subtract(getCutBox());
      const cutDoc = manifoldToGltf(cutManifold, maxOD);
      const cutGlb = await io.writeBinary(cutDoc);
      const cutPath = join(STATIC_DIR, `${id}.cut.glb`);
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
