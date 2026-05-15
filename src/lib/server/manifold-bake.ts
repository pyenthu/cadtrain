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
 * Convert a Manifold instance's mesh data into a binary glTF Document
 * with a single mesh + single primitive. We don't bake materials,
 * normals, or UVs — the client applies its own MeshPhongMaterial after
 * loading. Just positions + triangle indices.
 */
function manifoldToGltf(manifold: any): Document {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp ?? 3;
  const verts = mesh.vertProperties as Float32Array;
  const tris  = mesh.triVerts     as Uint32Array;

  // If numProp > 3, the array interleaves (x, y, z, ...). Extract just
  // positions into a tightly packed Float32Array.
  let positions: Float32Array;
  if (numProp === 3) {
    positions = verts;
  } else {
    const count = verts.length / numProp;
    positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = verts[i * numProp + 0];
      positions[i * 3 + 1] = verts[i * numProp + 1];
      positions[i * 3 + 2] = verts[i * numProp + 2];
    }
  }

  const doc = new Document();
  const buf = doc.createBuffer();
  const positionAcc = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buf);
  const indexAcc = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(tris)
    .setBuffer(buf);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', positionAcc)
    .setIndices(indexAcc);
  const meshNode = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(meshNode);
  doc.createScene().addChild(node);

  return doc;
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
    // 1. Full mesh.
    const doc = manifoldToGltf(manifold);
    const glb = await io.writeBinary(doc);
    const path = join(STATIC_DIR, `${id}.glb`);
    await writeFile(path, glb);
    const result: BakeResult = { ok: true, path, bytes: glb.byteLength };
    // 2. Half-sectioned mesh — best effort.
    try {
      const cutManifold = manifold.subtract(getCutBox());
      const cutDoc = manifoldToGltf(cutManifold);
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
