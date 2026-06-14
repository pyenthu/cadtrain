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
import { initManifold, getCutBox, tagManifold } from '../cad/manifold-helpers';
import { SECTION_ID, triSourceIds } from '../cad/part-id';

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
export interface MaterialSpec { color: string; metallic?: number; roughness?: number }
export interface MaterialPair { outer: MaterialSpec; inner: MaterialSpec }

/** Per-part viewer colour override (outside ← outer, bore/cut ← inner). Mirrors
 *  builder.ts ColorOverride — the user's explicit paint of THIS part. When set
 *  it wins over the material / color-by-source / legacy paths so the GLB pane
 *  matches the live Mesh pane. */
export interface ColorOverride { outer: string; inner: string }
/** Defaults identical to builder.ts DEFAULT_OUTER_HEX/DEFAULT_INNER_HEX so an
 *  override with only one side set fills the other with the historical look. */
export const DEFAULT_OUTER_HEX = '#cc2222';
export const DEFAULT_INNER_HEX = '#888888';

function hexToRgba(hex: string): [number, number, number, number] {
  // '#rrggbb' / 'rrggbb' / '#rgb' / 'rgb'
  const t = (hex ?? '').trim();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(t);
  if (m6) {
    const v = m6[1];
    return [
      parseInt(v.slice(0, 2), 16) / 255,
      parseInt(v.slice(2, 4), 16) / 255,
      parseInt(v.slice(4, 6), 16) / 255,
      1,
    ];
  }
  const m3 = /^#?([0-9a-f]{3})$/i.exec(t);
  if (m3) {
    const v = m3[1];
    return [
      parseInt(v[0] + v[0], 16) / 255,
      parseInt(v[1] + v[1], 16) / 255,
      parseInt(v[2] + v[2], 16) / 255,
      1,
    ];
  }
  return [0.8, 0.13, 0.13, 1];
}

/** Three-channel form of `hexToRgba` (drops alpha). */
function hexRgb3(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex);
  return [r, g, b];
}

/** Per-part color table (mirrors builder.ts PartColorLUT / analyzeParts). */
export interface PartColorLUT {
  outer: Record<number, string>;
  inner: Record<number, string>;
  subtractive: number[];
  bodyId: number | null;
  bodyInner: string;
  bodyColor: string;
  active: boolean;
}

function manifoldToGltf(
  manifold: any,
  maxOD: number,
  coloured: boolean,
  material?: MaterialPair,
  parts?: PartColorLUT,
  override?: ColorOverride,
): Document {
  // Bake Manifold's calculateNormals so the GLB carries correct shading
  // data — matches the in-browser Mesh pane after the same fix in
  // builder.ts. propIdx=3 + minSharpAngle=60° splits hard corners while
  // smoothing curved surfaces. Falls back to positions-only if the wasm
  // build lacks calculateNormals.
  let withNormals: any;
  try { withNormals = manifold.calculateNormals(3, 60); }
  catch { withNormals = manifold; }
  const mesh = withNormals.getMesh();
  const numProp = mesh.numProp ?? 3;
  const verts = mesh.vertProperties as Float32Array;
  const tris  = mesh.triVerts     as Uint32Array;
  const nv = verts.length / numProp;

  // De-interleave to a positions-only view we can either upload directly
  // (indexed path) or scatter per-triangle (non-indexed path). When
  // numProp >= 6 we also pull the calculateNormals output.
  const vpos = new Float32Array(nv * 3);
  const vnrm = numProp >= 6 ? new Float32Array(nv * 3) : null;
  for (let i = 0; i < nv; i++) {
    vpos[i * 3 + 0] = verts[i * numProp + 0];
    vpos[i * 3 + 1] = verts[i * numProp + 1];
    vpos[i * 3 + 2] = verts[i * numProp + 2];
    if (vnrm) {
      vnrm[i * 3 + 0] = verts[i * numProp + 3];
      vnrm[i * 3 + 1] = verts[i * numProp + 4];
      vnrm[i * 3 + 2] = verts[i * numProp + 5];
    }
  }

  const doc = new Document();
  const buf = doc.createBuffer();

  if (override) {
    // PER-PART OVERRIDE — the user explicitly painted this part's outside /
    // inside. Wins over color-by-source + material + legacy, mirroring
    // builder.ts manifoldToGeo/manifoldToCutVC's ColorOverride substitution.
    // Always emit a non-indexed COLOR_0 so the GLB pane (PrimitiveDualScene)
    // sees `attributes.color` → vertexColors and shows the baked colours.
    //   full (coloured=false): every triangle = outer (uniform skin).
    //   cut  (coloured=true):  legacy bore/cut/internal classification,
    //                          recoloured outer/inner (identical to the
    //                          live-mesh manifoldToCutVC ovOuter/ovInner path).
    const ovOuter = hexRgb3(override.outer);
    const ovInner = hexRgb3(override.inner);
    const ntp = tris.length / 3;
    const oPos = new Float32Array(ntp * 9);
    const oCol = new Float32Array(ntp * 9);
    const oNrm = vnrm ? new Float32Array(ntp * 9) : null;
    for (let i = 0; i < ntp; i++) {
      const a = tris[i * 3], b = tris[i * 3 + 1], c = tris[i * 3 + 2];
      const ax = vpos[a * 3], ay = vpos[a * 3 + 1];
      const bx = vpos[b * 3], by = vpos[b * 3 + 1];
      const cx = vpos[c * 3], cy = vpos[c * 3 + 1];
      const az = vpos[a * 3 + 2], bz = vpos[b * 3 + 2], cz = vpos[c * 3 + 2];
      let rgb: [number, number, number];
      if (!coloured) {
        rgb = ovOuter;
      } else {
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
        rgb = isGrey ? ovInner : ovOuter;
      }
      const idx = i * 9;
      for (let v = 0; v < 3; v++) {
        const vi = tris[i * 3 + v];
        oPos[idx + v * 3] = vpos[vi * 3];
        oPos[idx + v * 3 + 1] = vpos[vi * 3 + 1];
        oPos[idx + v * 3 + 2] = vpos[vi * 3 + 2];
        oCol[idx + v * 3] = rgb[0];
        oCol[idx + v * 3 + 1] = rgb[1];
        oCol[idx + v * 3 + 2] = rgb[2];
        if (oNrm && vnrm) {
          oNrm[idx + v * 3] = vnrm[vi * 3];
          oNrm[idx + v * 3 + 1] = vnrm[vi * 3 + 1];
          oNrm[idx + v * 3 + 2] = vnrm[vi * 3 + 2];
        }
      }
    }
    const posAcc = doc.createAccessor().setType('VEC3').setArray(oPos).setBuffer(buf);
    const colAcc = doc.createAccessor().setType('VEC3').setArray(oCol).setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setAttribute('COLOR_0', colAcc);
    if (oNrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(oNrm).setBuffer(buf));
    prim.setMaterial(doc.createMaterial().setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1));
    const meshNode = doc.createMesh().addPrimitive(prim);
    doc.createScene().addChild(doc.createNode().setMesh(meshNode));
    return doc;
  }

  if (parts?.active) {
    // COLOR-BY-SOURCE — non-indexed COLOR_0, per-triangle color from the
    // Manifold relation. Takes priority over the material/heuristic paths
    // so the GLB pane matches the live mesh. `coloured` marks the cut
    // variant → SECTION_ID faces get the cross-section color.
    const ntp = tris.length / 3;
    const hexRgb = (hex: string): [number, number, number] => {
      const [r, g, b] = hexToRgba(hex);
      return [r, g, b];
    };
    const toRgb = (m: Record<number, string>) => {
      const out = new Map<number, [number, number, number]>();
      for (const k of Object.keys(m)) out.set(Number(k), hexRgb(m[Number(k)]));
      return out;
    };
    const outerRgb = toRgb(parts.outer);
    const innerRgb = toRgb(parts.inner);
    const subtractive = new Set(parts.subtractive);
    const bodyInnerRgb = hexRgb(parts.bodyInner);
    const bodyOuterRgb: [number, number, number] =
      (parts.bodyId != null && outerRgb.get(parts.bodyId)) || hexRgb(parts.bodyColor);
    const ids = triSourceIds(mesh);
    const cbPositions = new Float32Array(ntp * 9);
    const cbColors = new Float32Array(ntp * 9);
    const cbNormals = vnrm ? new Float32Array(ntp * 9) : null;
    for (let i = 0; i < ntp; i++) {
      const id = ids[i];
      let rgb: [number, number, number];
      if (id === SECTION_ID) rgb = bodyInnerRgb;
      else if (subtractive.has(id)) rgb = innerRgb.get(id) ?? bodyInnerRgb;
      else rgb = outerRgb.get(id) ?? bodyOuterRgb;
      const idx = i * 9;
      for (let v = 0; v < 3; v++) {
        const vi = tris[i * 3 + v];
        cbPositions[idx + v * 3] = vpos[vi * 3];
        cbPositions[idx + v * 3 + 1] = vpos[vi * 3 + 1];
        cbPositions[idx + v * 3 + 2] = vpos[vi * 3 + 2];
        cbColors[idx + v * 3] = rgb[0];
        cbColors[idx + v * 3 + 1] = rgb[1];
        cbColors[idx + v * 3 + 2] = rgb[2];
        if (cbNormals && vnrm) {
          cbNormals[idx + v * 3] = vnrm[vi * 3];
          cbNormals[idx + v * 3 + 1] = vnrm[vi * 3 + 1];
          cbNormals[idx + v * 3 + 2] = vnrm[vi * 3 + 2];
        }
      }
    }
    const posAcc = doc.createAccessor().setType('VEC3').setArray(cbPositions).setBuffer(buf);
    const colAcc = doc.createAccessor().setType('VEC3').setArray(cbColors).setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setAttribute('COLOR_0', colAcc);
    if (cbNormals) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(cbNormals).setBuffer(buf));
    prim.setMaterial(doc.createMaterial().setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1));
    const meshNode = doc.createMesh().addPrimitive(prim);
    doc.createScene().addChild(doc.createNode().setMesh(meshNode));
    return doc;
  }

  if (!coloured && !material) {
    // INDEXED, positions + (optional) normals. Client renders it as
    // solid red. Saves ~3× over the non-indexed path. Normals are
    // included when calculateNormals fired so external viewers don't
    // recompute and inherit the winding-stripe bug.
    const positionAcc = doc.createAccessor().setType('VEC3').setArray(vpos).setBuffer(buf);
    const indexAcc    = doc.createAccessor().setType('SCALAR').setArray(tris).setBuffer(buf);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', positionAcc)
      .setIndices(indexAcc);
    if (vnrm) {
      const normalAcc = doc.createAccessor().setType('VEC3').setArray(vnrm).setBuffer(buf);
      prim.setAttribute('NORMAL', normalAcc);
    }
    const meshNode = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setMesh(meshNode);
    doc.createScene().addChild(node);
    return doc;
  }

  if (material && !coloured) {
    // MATERIAL bake — same triangle classification as the coloured
    // path, but instead of per-face vertex colors we split into two
    // INDEXED primitives (outer + inner), each with its own PBR
    // material. Renders correctly in any external glTF viewer.
    const nt = tris.length / 3;
    const outerTris: number[] = [];
    const innerTris: number[] = [];
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
      const isBore = radialDot < -0.3;
      const nzNorm = Math.abs(nz / nLen);
      const maxR = Math.max(
        Math.sqrt(ax * ax + ay * ay),
        Math.sqrt(bx * bx + by * by),
        Math.sqrt(cx * cx + cy * cy),
      );
      const isInner = isBore || (nzNorm > 0.8 && maxR < maxOD / 2 + 0.05);
      const dst = isInner ? innerTris : outerTris;
      dst.push(a, b, c);
    }

    const positionAcc = doc.createAccessor().setType('VEC3').setArray(vpos).setBuffer(buf);
    const meshNode = doc.createMesh();

    function makeMat(name: string, spec: MaterialSpec) {
      const m = doc.createMaterial(name)
        .setBaseColorFactor(hexToRgba(spec.color))
        .setMetallicFactor(spec.metallic ?? 0)
        .setRoughnessFactor(spec.roughness ?? 0.7);
      return m;
    }
    const outerMat = makeMat('outer', material.outer);
    const innerMat = makeMat('inner', material.inner);

    // Share one NORMAL accessor across both sub-primitives (verts are
    // shared too via positionAcc) so the GLB doesn't double-allocate.
    const normalAcc = vnrm
      ? doc.createAccessor().setType('VEC3').setArray(vnrm).setBuffer(buf)
      : null;
    if (outerTris.length) {
      const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(outerTris)).setBuffer(buf);
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', positionAcc)
        .setIndices(idx)
        .setMaterial(outerMat);
      if (normalAcc) prim.setAttribute('NORMAL', normalAcc);
      meshNode.addPrimitive(prim);
    }
    if (innerTris.length) {
      const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(innerTris)).setBuffer(buf);
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', positionAcc)
        .setIndices(idx)
        .setMaterial(innerMat);
      if (normalAcc) prim.setAttribute('NORMAL', normalAcc);
      meshNode.addPrimitive(prim);
    }
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

/** Same heuristic builder.ts uses for sizing the cut box / cap test.
 *  Tolerates string values (polygon params) by treating them as 0. */
function pickMaxOD(defaults: Record<string, number | string>): number {
  const n = (k: string) => {
    const v = defaults[k];
    return typeof v === 'number' ? v : 0;
  };
  return Math.max(n('od'), n('odTop'), n('odBottom'), n('odLarge'), n('slipOD'), n('odCompressed'), 3);
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
    const bytes = await buildGlbBytes(geom, defaults);
    if (!bytes.ok) return { ok: false, error: bytes.error };
    const targetDir = outDir ?? STATIC_DIR;
    const fullName = outDir ? 'mesh.glb' : `${id}.glb`;
    const cutName = outDir ? 'mesh.cut.glb' : `${id}.cut.glb`;
    await mkdir(targetDir, { recursive: true });
    const path = join(targetDir, fullName);
    await writeFile(path, bytes.full);
    const result: BakeResult = { ok: true, path, bytes: bytes.full.byteLength };
    if (bytes.cut) {
      try {
        const cutPath = join(targetDir, cutName);
        await writeFile(cutPath, bytes.cut);
        result.cutPath = cutPath;
        result.cutBytes = bytes.cut.byteLength;
      } catch {
        // Cut write failed but the full GLB stayed.
      }
    }
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** In-memory bake: run `geom(defaults)`, serialize to GLB, return the
 *  bytes for both the full mesh and the half-sectioned cut variant.
 *  Used by `/api/components/bake-preview` to stream a live GLB for
 *  unsaved sourceDraft / dirty params without touching disk. Cut
 *  failure is best-effort — `cut` may be undefined while `full` is
 *  populated (matches the on-disk bake's behaviour: full is the
 *  primary deliverable, cut is the nice-to-have). */
export interface GlbBytes {
  ok: true;
  full: Uint8Array;
  cut?: Uint8Array;
}
export interface GlbBytesError {
  ok: false;
  error: string;
}
export async function buildGlbBytes(
  geom: (p: Record<string, number | string>) => any,
  defaults: Record<string, number | string>,
  material?: MaterialPair,
  parts?: PartColorLUT,
  override?: ColorOverride,
): Promise<GlbBytes | GlbBytesError> {
  try {
    await initManifold();
    const manifold = geom(defaults);
    if (!manifold || typeof manifold.getMesh !== 'function') {
      return { ok: false, error: 'geom() did not return a Manifold instance' };
    }
    const io = new NodeIO();
    const maxOD = pickMaxOD(defaults);
    const lut = parts?.active ? parts : undefined;
    // 1. Full mesh — when `material` is provided the bake splits the
    //    geometry into outer + inner indexed primitives, each carrying
    //    a PBR material so the downloaded GLB renders correctly in
    //    external viewers (Blender, model-viewer, glTF preview). When
    //    no material is provided we fall back to the smallest
    //    positions-only representation.
    const doc = manifoldToGltf(manifold, maxOD, false, material, lut, override);
    const full = await io.writeBinary(doc);
    const result: GlbBytes = { ok: true, full };
    // 2. Half-sectioned mesh — non-indexed with per-face colours so the
    //    grey bore reads against the red outer. Best effort. On the
    //    color-by-source path tag the cut box with SECTION_ID so the
    //    cross-section faces it creates get the section color.
    try {
      const cutBox = lut ? tagManifold(getCutBox(), SECTION_ID) : getCutBox();
      const cutManifold = manifold.subtract(cutBox);
      const cutDoc = manifoldToGltf(cutManifold, maxOD, true, undefined, lut, override);
      result.cut = await io.writeBinary(cutDoc);
    } catch {
      // Cut bake failed (component might already be open / one-sided);
      // the full GLB remains available.
    }
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
