/**
 * brep-audit — differential MF-vs-BREP parity harness (test/tooling only).
 *
 * NOT shipped on any hot path. Imported by `brep-coverage.test.ts` (gated behind
 * BREP_AUDIT=1) to loop the "bake through Manifold (oracle) AND OCCT/BREP, diff
 * volume+bbox" audit over every reachable part + assembly. MF is ground truth
 * (known-good); a BREP result is a PASS iff it yields a valid solid whose
 * per-part-summed volume and union bbox match MF within tolerance.
 *
 * Both engines are meshed and compared triangle-for-triangle (signed-tetra
 * volume + position bbox) so the comparison is apples-to-apples:
 *   - MF list-assemblies keep `_parts` separate (lazy compose), so we sum each
 *     part's mesh volume — matching BREP's makeCompound (separate shells).
 *   - Single-solid parts compare directly.
 */
import * as helpers from '$lib/cad/manifold-helpers';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '$lib/cad/primitive-sandbox';
import { paramKeysOf } from '$lib/cad/param-keys';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { brepFromSource } from '$lib/server/brep-occt';

export interface MeshStats {
  volume: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  dims: [number, number, number];
  tris: number;
  verts: number;
}

/** Signed-tetra volume (abs) + bbox from an indexed OR non-indexed triangle
 *  soup. positions = flat xyz, index optional. */
export function meshStats(positions: ArrayLike<number>, index?: ArrayLike<number>): MeshStats {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const n = positions.length;
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  let vol6 = 0;
  const tri = (a: number, b: number, c: number) => {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    // a · (b × c)
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  };
  let triCount = 0;
  if (index && index.length) {
    for (let i = 0; i < index.length; i += 3) { tri(index[i], index[i + 1], index[i + 2]); triCount++; }
  } else {
    const nv = n / 3;
    for (let i = 0; i < nv; i += 3) { tri(i, i + 1, i + 2); triCount++; }
  }
  return {
    volume: Math.abs(vol6) / 6,
    bbox: { min, max },
    dims: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    tris: triCount,
    verts: n / 3,
  };
}

/** Combine a list of MeshStats into a union bbox + summed volume/tris. */
function combineStats(list: MeshStats[]): MeshStats | null {
  if (!list.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let volume = 0, tris = 0, verts = 0;
  for (const s of list) {
    volume += s.volume; tris += s.tris; verts += s.verts;
    for (let k = 0; k < 3; k++) { if (s.bbox.min[k] < min[k]) min[k] = s.bbox.min[k]; if (s.bbox.max[k] > max[k]) max[k] = s.bbox.max[k]; }
  }
  return { volume, bbox: { min, max }, dims: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], tris, verts };
}

/** Extract the `export const meta = {...}` object by evaluating its literal. */
export function extractMeta(source: string): any | null {
  const m = source.match(/export\s+const\s+meta\s*=\s*\{/);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length - 1; // at the '{'
  let depth = 0, inStr: string | null = null, i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const objText = source.slice(start, i);
  try { return new Function('return (' + objText + ')')(); } catch { return null; }
}

/** Build the default param object (key → meta.params[key].default) in key order. */
export function defaultParamObject(source: string): Record<string, any> {
  const meta = extractMeta(source);
  const params = (meta && meta.params) || {};
  const keys = paramKeysOf(source);
  const obj: Record<string, any> = {};
  for (const k of keys) {
    const def = params[k]?.default;
    if (def !== undefined) obj[k] = def;
  }
  // Parts whose keys weren't found via paramKeysOf but exist in meta.params.
  for (const k of Object.keys(params)) if (!(k in obj) && params[k]?.default !== undefined) obj[k] = params[k].default;
  return obj;
}

const ENGINE_IDS = new Set(['r_revolve', 'r_weld_extrude', 'r_loft', 'r_extrude', 'r_cuboid', 'r_sweep', 'r_surface', 'r_helical_surface']);

/** Parse the ids listed in `meta.uses: [...]`. */
export function usesOf(source: string): string[] {
  const m = source.match(/uses:\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-z_][a-z0-9_]*)['"]/gi)].map((x) => x[1]);
}

/** Is this source a graph/composed part whose emitted body calls engine ops
 *  (BREP-mappable) vs a hand-authored raw-mesh part (weldAndBuild/gridPatch/…)?
 *  `isAssembly` = composes at least one NON-engine volume sub-part. */
export function classifyBody(source: string): { kind: string; isAssembly: boolean; usesEngines: boolean; usesRawMesh: boolean; usesWarp: boolean } {
  const meta = extractMeta(source);
  const kind = (meta && meta.kind) || 'prim';
  const body = source.slice(source.search(/export\s+function\s+\w+\s*\(/));
  const ENGINE_RE = /\b(r_revolve|r_weld_extrude|r_loft|r_extrude|r_cuboid|r_sweep)\s*\(/;
  const RAW_RE = /\b(weldAndBuild|gridPatch|capFan|revolveProfile|sweepAlongPath|sweepAnnular|boredSweep|loftStations|helix_band|profile_extrude|cyl\s*\(|tube\s*\(|cs\s*\(|extrude_csg)\b/;
  const WARP_RE = /\b(warpSpline|warpManifoldAlongSpline)\s*\(/;
  const nonEngineDeps = usesOf(source).filter((u) => !ENGINE_IDS.has(u));
  return { kind, isAssembly: nonEngineDeps.length > 0, usesEngines: ENGINE_RE.test(body), usesRawMesh: RAW_RE.test(body), usesWarp: WARP_RE.test(body) };
}

/** Extract Manifold objects from a geom-fn return value (single | array | lazyPlace proxy). */
function manifoldsOf(result: any): any[] {
  if (!result) return [];
  if (result.__isLazyPlace === true && Array.isArray(result._parts)) return result._parts.flatMap(manifoldsOf);
  if (Array.isArray(result)) return result.flatMap(manifoldsOf);
  if (Array.isArray(result._parts)) return result._parts.flatMap(manifoldsOf);
  if (typeof result.getMesh === 'function') return [result];
  return [];
}

/** MF oracle: compile the source and run it, returning per-part-summed stats. */
export async function bakeMF(source: string, id: string, params: Record<string, any>, fetchFn: typeof fetch): Promise<MeshStats> {
  await helpers.initManifold();
  const { script } = await compilePrimitiveScript(source, id, fetchFn);
  const factory = new Function(...SANDBOX_ARG_NAMES, script);
  const geomFn = factory(...sandboxArgValues());
  if (typeof geomFn !== 'function') throw new Error('compiled script did not return a geom function');
  const result = geomFn(params);
  const manifolds = manifoldsOf(result);
  if (!manifolds.length) throw new Error('geom fn produced no Manifold');
  const per: MeshStats[] = [];
  for (const m of manifolds) {
    const mesh = m.getMesh();
    per.push(meshStats(mesh.vertProperties as ArrayLike<number>, mesh.triVerts as ArrayLike<number>));
  }
  const combined = combineStats(per);
  if (!combined) throw new Error('no mesh stats');
  return combined;
}

/** BREP: bake the source through OCCT, returning triangle-soup stats. */
export async function bakeBREP(source: string, params: Record<string, any>, fetchFn: typeof fetch): Promise<MeshStats> {
  const mesh = await brepFromSource(source, params, { cut: false }, fetchFn);
  if (!mesh) throw new Error('no OCCT-buildable solid (brepFromSource → null)');
  if (!mesh.positions || mesh.positions.length === 0) throw new Error('BREP produced empty mesh');
  const stats = meshStats(mesh.positions, mesh.index);
  if (!(stats.volume > 0)) throw new Error(`BREP solid has non-positive volume (${stats.volume})`);
  return stats;
}

export interface DiffResult {
  id: string;
  kind: string;
  isAssembly: boolean;
  usesEngines: boolean;
  usesRawMesh: boolean;
  usesWarp: boolean;
  mf: 'ok' | 'fail';
  mfError?: string;
  brep: 'ok' | 'fail';
  brepError?: string;
  parity: 'pass' | 'fail' | 'n/a';
  volMF?: number;
  volBREP?: number;
  volRelErr?: number;
  bboxRelErr?: number;
  mfTris?: number;
  brepTris?: number;
  mfDims?: [number, number, number];
  brepDims?: [number, number, number];
}

const VOL_TOL = 0.08;   // 8% relative volume
const BBOX_TOL = 0.05;  // 5% per-dimension

export async function diffPart(id: string, source: string, fetchFn: typeof fetch): Promise<DiffResult> {
  const cls = classifyBody(source);
  const params = defaultParamObject(source);
  const res: DiffResult = { id, kind: cls.kind, isAssembly: cls.isAssembly, usesEngines: cls.usesEngines, usesRawMesh: cls.usesRawMesh, usesWarp: cls.usesWarp, mf: 'fail', brep: 'fail', parity: 'n/a' };

  let mf: MeshStats | null = null;
  try { mf = await bakeMF(source, id, params, fetchFn); res.mf = 'ok'; res.volMF = mf.volume; res.mfTris = mf.tris; }
  catch (e: any) { res.mfError = String(e?.message ?? e).slice(0, 160); }

  let brep: MeshStats | null = null;
  try { brep = await bakeBREP(source, params, fetchFn); res.brep = 'ok'; res.volBREP = brep.volume; res.brepTris = brep.tris; }
  catch (e: any) { res.brepError = String(e?.message ?? e).slice(0, 160); }

  if (mf) res.mfDims = mf.dims;
  if (brep) res.brepDims = brep.dims;
  if (mf && brep) {
    const volRel = mf.volume > 1e-9 ? Math.abs(brep.volume - mf.volume) / mf.volume : (brep.volume < 1e-6 ? 0 : 1);
    let bboxRel = 0;
    for (let k = 0; k < 3; k++) {
      const denom = Math.max(Math.abs(mf.dims[k]), 0.5);
      bboxRel = Math.max(bboxRel, Math.abs(brep.dims[k] - mf.dims[k]) / denom);
    }
    res.volRelErr = volRel;
    res.bboxRelErr = bboxRel;
    res.parity = (volRel <= VOL_TOL && bboxRel <= BBOX_TOL) ? 'pass' : 'fail';
  } else if (!mf && brep) {
    res.parity = 'n/a'; // MF is oracle; no oracle → can't judge parity
  }
  return res;
}
