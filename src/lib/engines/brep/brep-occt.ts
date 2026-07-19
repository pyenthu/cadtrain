/**
 * brep-occt — server-side OpenCascade (OCCT) via replicad's opencascade.js WASM.
 *
 * Runs the BREP kernel IN NODE (WASM works server-side — the realization behind
 * the BREP-tab + hybrid-kernel plan, memory `todo_occt_brep_backend` /
 * `todo_brep_tab`). Produces a TRUE-curve, adaptively-tessellated mesh so the
 * graph editor's BREP tab can sit next to the Manifold (Mesh) + GLB bakes for
 * comparison.
 *
 * Init is lazy + cached: the opencascade.js emscripten module is loaded via
 * createRequire (NOT `import`) so Vite/SvelteKit's ESM pipeline doesn't try to
 * transform the CJS WASM glue (that throws ERR_AMBIGUOUS_MODULE_SYNTAX under
 * Node 25). The .wasm bytes are read from node_modules and passed as
 * `wasmBinary`, avoiding any fetch/locateFile path resolution.
 *
 * v1 scope: REVOLVE only — map a closed (r,z) half-section (our r_revolve
 * profile) to an OCCT surface of revolution. Extrude/loft/CSG mapping comes
 * later (todo_brep_tab); parts with no BREP path return { supported:false }.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mathLib from '$lib/graph/math-lib';
import type { PartColorLUT } from '$lib/graph/part-lut-types';
import type { PartAppearance } from '$lib/shared/viewer/part-appearance';
import type { BrepPartResponse } from './brep-adapter';

// The bare-name math surface a part/assembly body may reference (cos/sin/tau/…
// PLUS ceil/hypot/sign/clamp/frac/lerp/deg/rad/pi/atan2/…). Mirror the primitive
// sandbox's spread so the OCCT executor injects the SAME set — a body using an
// un-injected math fn otherwise threw "<fn> is not defined" under BREP only.
const MATH_NAMES = Object.keys(mathLib);
const MATH_VALUES = MATH_NAMES.map((n) => (mathLib as any)[n]);

let _ocReady: Promise<void> | null = null;

/** Lazily init OCCT + wire it into replicad's global. Cached across requests.
 *  The opencascade.js emscripten module is loaded with a dynamic import (Vite
 *  externalizes node_modules for SSR, so Bun/Node loads it natively — the same
 *  default-export factory the standalone bench used). The .wasm bytes are read
 *  from node_modules and handed in as `wasmBinary` (no fetch/locateFile). */
export async function ensureOC(): Promise<void> {
  if (_ocReady) return _ocReady;
  _ocReady = (async () => {
    // The emscripten glue references bare __dirname/__filename (Node CJS
    // globals) which don't exist in Vite's SSR ESM context — shim them on
    // globalThis so the free-variable lookup resolves. Point them at the
    // package's src dir (where the .wasm sibling lives).
    const ocSrcDir = resolve(process.cwd(), 'node_modules/replicad-opencascadejs/src');
    const g = globalThis as any;
    if (g.__dirname === undefined) g.__dirname = ocSrcDir;
    if (g.__filename === undefined) g.__filename = resolve(ocSrcDir, 'replicad_single.js');
    const ocModule: any = await import(
      /* @vite-ignore */ 'replicad-opencascadejs/src/replicad_single.js'
    );
    const ocFactory = ocModule.default ?? ocModule;
    if (typeof ocFactory !== 'function') {
      throw new Error('opencascade.js factory not callable (export shape: ' + Object.keys(ocModule).join(',') + ')');
    }
    const wasmPath = resolve(
      process.cwd(),
      'node_modules/replicad-opencascadejs/src/replicad_single.wasm',
    );
    const wasmBinary = readFileSync(wasmPath);
    const OC = await ocFactory({ wasmBinary });
    const { setOC } = await import('replicad');
    setOC(OC);
  })();
  return _ocReady;
}

/** Drop the cached OCCT instance so the NEXT ensureOC() re-inits a FRESH WASM
 *  heap. Call after an emscripten throw (a bare numeric heap pointer) — those
 *  corrupt the shared OCCT singleton, and without a reset EVERY later BREP bake
 *  fails until a server restart. Re-init is ~seconds but only happens after a
 *  genuine failure, so the BREP tab self-heals on the next bake. */
function resetOC(): void { _ocReady = null; }

/**
 * Extract the (r,z) revolve profile from an emitted part body by running it
 * with a CAPTURING `r_revolve` (+ the `sketch` helper + Math globals + the
 * param object). Handles both polygon revolves (`r_revolve(_prof, 96)`) and
 * sketch revolves (`r_revolve({ profile: _sketch_1, segments })`). Returns null
 * if the part has no top-level r_revolve (→ "no BREP path" in the tab).
 */
export async function extractRevolveProfile(
  source: string,
  paramValues: Record<string, number> = {},
): Promise<[number, number][] | null> {
  const { compileSketch } = await import('$lib/graph/sketch');
  // Param list is `(p)` for parts with params, `()` for paramless parts — match
  // either. Body is everything up to the final brace (the function is last).
  const m = source.match(/export\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (!m) return null;
  const fnBody = m[1];

  let captured: [number, number][] | null = null;
  const capRevolve = (a: any) => {
    const prof = Array.isArray(a) ? a : a?.profile;
    if (Array.isArray(prof)) captured = prof as [number, number][];
    // Absorb any further chained ops (.subtract(...), .add(...), mv(...), …).
    const sink: any = new Proxy(() => sink, { get: () => sink, apply: () => sink });
    return sink;
  };
  // `sketch` helper compiles ops → (r,z) points (same as the sandbox injects).
  const sketchHelper = (ops: any[], segs = 64) => compileSketch(ops, segs);
  // No-op the other engines/helpers a body might call so the eval reaches the
  // r_revolve without throwing; anything they return is an absorbing sink.
  const noop: any = new Proxy(() => noop, { get: () => noop, apply: () => noop });

  try {
    const runner = new Function(
      'p', 'sketch', 'r_revolve', 'r_weld_extrude', 'r_loft', 'r_extrude', 'r_cuboid',
      'mv', 'rot', 'place', 'cos', 'sin', 'tan', 'tau', 'PI', 'sqrt', 'abs', 'min', 'max', 'pow', 'floor', 'round',
      fnBody,
    );
    runner(
      paramValues, sketchHelper, capRevolve, noop, noop, noop, noop,
      noop, noop, noop, Math.cos, Math.sin, Math.tan, 2 * Math.PI, Math.PI, Math.sqrt, Math.abs, Math.min, Math.max, Math.pow, Math.floor, Math.round,
    );
  } catch {
    // Body referenced something we didn't inject, or isn't a revolve → no path.
    return captured;
  }
  return captured;
}

export interface BrepMesh {
  positions: number[];
  index?: number[];
  normals?: number[];
  colors?: number[];
  cut?: boolean;
  meta: { tris: number; verts: number; ms: number; tolerance: number };
  /** #947 — per-part meshes + resolved appearance for the UNCUT color-by-source
   *  path. Populated ALONGSIDE the merged `positions`/`colors` (which stay the
   *  camera-fit bbox mesh) so the client renders each subpart with its OWN
   *  material via the scene's per-part arm. Absent → single merged mesh, as before. */
  parts?: BrepPartResponse[];
}

export interface MeshOpts {
  tolerance?: number;
  angularTolerance?: number;
  cut?: boolean;        // half-section cutaway (remove the y<0 half)
  colorOuter?: string;  // '#rrggbb' for the outer/original skin (cut arm); absent → legacy red
  colorInner?: string;  // '#rrggbb' for the bore + newly-exposed cut faces; absent → legacy grey
  /** #86 per-part colour-by-source LUT (same shape the Manifold bake consumes).
   *  When ACTIVE and NOT cutting, brepFromSource meshes each top-level sub-solid
   *  SEPARATELY and tints its vertices with the part's own LUT colour — so a
   *  multi-part BREP solid shows each part in its own colour, matching the MF
   *  tab (color-by-source) instead of one uniform skin. Absent / inactive →
   *  the legacy single-mesh path (byte-identical). Ignored on the CUT arm
   *  (which keeps its colorOuter/colorInner half-section behaviour, #997). */
  partColors?: PartColorLUT;
}

/** Legacy cut-arm vertex colours — the historical BREP red (outer skin) / grey
 *  (bore + cut cross-section) convention. Used verbatim when the request omits
 *  the corresponding colour override, so an un-coloured cut stays byte-identical. */
const LEGACY_CUT_OUTER: [number, number, number] = [0.8, 0.06, 0.06];
const LEGACY_CUT_INNER: [number, number, number] = [0.45, 0.45, 0.45];

/** '#rrggbb' (or bare 'rrggbb') → [r,g,b] floats in 0..1; `fallback` on a
 *  missing/malformed string. Mirrors render-helpers `hexToRgb` so the BREP cut
 *  arm honours the SAME per-part colours the Manifold cutVC path does. */
function cutHexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return fallback;
  const v = m[1];
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}

/** One meshed top-level sub-solid + its part identity — the input to the pure
 *  per-part colour assembler. `hashId` is the part's color-by-source key
 *  (`partHashId(instanceName)`, the SAME id the Manifold relation carries); it
 *  looks up the part's outer colour in the LUT. `vertices`/`triangles` are the
 *  raw OCCT mesh arrays (flat xyz + triangle index triples). */
export interface BrepSubMesh {
  vertices: number[];
  triangles: number[];
  normals?: number[];
  hashId?: number;
}

/** The outer '#rrggbb' the BREP full mesh paints a part with — the SAME
 *  `lut.outer[hashId]` the Manifold `manifoldToGeo` uses, so a part reads the
 *  same colour across the MF + BREP tabs. Falls back to the LUT body colour,
 *  then the legacy BREP red, so an un-keyed / un-coloured part is uniform. */
function partColorRgb(lut: PartColorLUT, hashId: number | undefined): [number, number, number] {
  const hex = (hashId !== undefined && lut.outer && lut.outer[hashId])
    ? lut.outer[hashId]
    : (lut.bodyColor || undefined);
  return cutHexToRgb(hex, LEGACY_CUT_OUTER);
}

/**
 * PURE per-part colour assembler (color-by-source for BREP, #86 "Phase B").
 *
 * Concatenates a list of independently-meshed sub-solids into ONE non-indexed
 * `{ positions, colors, normals }` mesh — the exact shape the BREP tab already
 * consumes (brep-adapter) — tinting every triangle of a sub-solid with its
 * part's OWN LUT colour. This mirrors the Manifold color-by-source path (each
 * part's triangles carry its hashId → LUT colour) but does the split at the
 * SUB-SOLID boundary the OCCT executor already has, instead of a mesh relation.
 *
 * Non-indexed + per-vertex colour (like the cut arm) because a colour is
 * per-part, not shareable at a shared vertex. `cut:false` so the adapter routes
 * it to the `full` view (an uncut solid that happens to be coloured). Normals
 * ride along when EVERY sub-solid supplied them (the adapter recomputes
 * crease-aware corner normals regardless, so they are advisory). No LUT match
 * for a part → the uniform fallback colour, so this degrades to one colour
 * exactly like the legacy single-mesh path.
 *
 * Extracted + exported so the colour-assignment seam is unit-testable WITHOUT
 * OCCT (see brep-part-colors.test.ts).
 */
export function assemblePartColorMesh(
  parts: BrepSubMesh[],
  lut: PartColorLUT,
  tolerance = 0.05,
  ms = 0,
): BrepMesh {
  const outPos: number[] = [];
  const outCol: number[] = [];
  const outNrm: number[] = [];
  const haveNormals = parts.length > 0 && parts.every((p) => Array.isArray(p.normals) && p.normals.length > 0);
  let ntTotal = 0;
  for (const part of parts) {
    const verts = part.vertices;
    const tris = part.triangles;
    const nrm = part.normals;
    const [r, g, b] = partColorRgb(lut, part.hashId);
    const nt = (tris.length / 3) | 0;
    for (let i = 0; i < nt; i++) {
      const idx = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
      for (const vi of idx) {
        outPos.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
        outCol.push(r, g, b);
        if (haveNormals && nrm) outNrm.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
      }
    }
    ntTotal += nt;
  }
  return {
    positions: outPos,
    colors: outCol,
    normals: haveNormals && outNrm.length ? outNrm : undefined,
    cut: false,
    meta: { tris: ntTotal, verts: ntTotal * 3, ms, tolerance },
  };
}

/**
 * Resolve ONE part's full render appearance (colour · MATL preset · opacity ·
 * texture) from a color-by-source LUT + the part's source hashId — the SAME
 * lookup the Manifold render path uses (`render-helpers.ts:buildSourceParts`,
 * `lut.appearance[hashId] ?? { colorOuter, colorInner, opacity }`). This is what
 * makes BREP render at PARITY with MF: the LUT `analyzeParts` builds already
 * carries each subpart's material/texture/opacity in `lut.appearance[id]`; we
 * just hand it through per part instead of collapsing to one flat mesh. An
 * un-keyed / untagged part → `{}`, so the scene falls back to its red default
 * (matching the merged legacy skin).
 */
export function partAppearanceFromLut(lut: PartColorLUT, hashId: number | undefined): PartAppearance {
  if (hashId !== undefined && lut.appearance?.[hashId]) return lut.appearance[hashId];
  if (hashId === undefined) return {};
  const out: PartAppearance = {};
  if (lut.outer[hashId]) out.colorOuter = lut.outer[hashId];
  if (lut.inner[hashId]) out.colorInner = lut.inner[hashId];
  if (lut.opacity?.[hashId] != null) out.opacity = lut.opacity[hashId];
  return out;
}

/**
 * PURE per-part MESH-LIST assembler (#947 render side for BREP). Turns the SAME
 * independently-meshed sub-solids `assemblePartColorMesh` concatenates into a
 * LIST of `{ positions, index, normals, appearance }` — one entry per subpart,
 * each carrying its OWN resolved appearance — so the client (`brepResponseToGeo`)
 * builds one THREE mesh + material per part and renders through the scene's
 * per-part arm, exactly like the Manifold `parts[]` path. Emitted ALONGSIDE the
 * merged mesh (kept as the bbox `full`); the per-part arm is what the user sees.
 *
 * Extracted + exported so the appearance-assignment seam is unit-testable WITHOUT
 * OCCT (see brep-part-colors.test.ts), mirroring `assemblePartColorMesh`.
 */
export function assemblePartMeshList(parts: BrepSubMesh[], lut: PartColorLUT): BrepPartResponse[] {
  return parts.map((part) => ({
    positions: part.vertices,
    index: part.triangles,
    ...(part.normals && part.normals.length ? { normals: part.normals } : {}),
    appearance: partAppearanceFromLut(lut, part.hashId),
  }));
}

/**
 * Tessellate an OCCT solid → BrepMesh, optionally with a HALF-SECTION CUTAWAY
 * coloured by the part's `colorOuter` (outer skin) / `colorInner` (bore + cut
 * cross-section), mirroring the Manifold cutVC convention (manifoldToCutVC).
 * When cut, removes the y<0 half with a box, then classifies each triangle
 * outer/inner by the SAME rule the Manifold path uses (radial-inward normal =
 * bore; on the y≈0 cut plane; near-axis cap) and emits a NON-INDEXED coloured
 * mesh. Each colour falls back to the legacy red/grey when its override is
 * absent (#997). No cut → plain indexed mesh + OCCT normals (the existing fast
 * path, unaffected by the colours).
 */
async function meshBrepSolid(solid: any, opts: MeshOpts, t0: number): Promise<BrepMesh> {
  const replicad: any = await import('replicad');
  const { makeBaseBox } = replicad;
  const tol = opts.tolerance ?? 0.05;
  const ang = opts.angularTolerance ?? 0.3;

  let target = solid;
  let didCut = false;
  let maxOD = 1;
  try {
    const bb = solid.boundingBox.bounds; // [[xmin,ymin,zmin],[xmax,ymax,zmax]]
    maxOD = 2 * Math.max(Math.abs(bb[0][0]), Math.abs(bb[1][0]), Math.abs(bb[0][1]), Math.abs(bb[1][1])) || 1;
    if (opts.cut) {
      const cz = (bb[0][2] + bb[1][2]) / 2;
      const span = (Math.max(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]) + 10) * 3;
      // makeBaseBox is centred in x/y, z from 0..d → translate so it covers the
      // +x,+y QUADRANT (x ≥ 0 ∧ y ≥ 0), removing a QUARTER to match the 3D-bake
      // cutaway (getCutBox = a cube in the +x,+y octant). The two cut planes
      // land at x = 0 and y = 0 (world axes, like the Manifold path).
      const box = makeBaseBox(span, span, span).translate([span / 2, span / 2, cz - span / 2]);
      target = solid.cut(box);
      didCut = true;
    }
  } catch { target = solid; didCut = false; }

  const meshed = target.mesh({ tolerance: tol, angularTolerance: ang });
  const ms = Date.now() - t0;
  const verts: number[] = Array.from(meshed.vertices ?? []);
  const tris: number[] = Array.from(meshed.triangles ?? []);
  const nrm: number[] | undefined = meshed.normals ? Array.from(meshed.normals) : undefined;

  if (!didCut) {
    return { positions: verts, index: tris, normals: nrm, cut: false, meta: { tris: tris.length / 3, verts: verts.length / 3, ms, tolerance: tol } };
  }

  // Cut path → NON-INDEXED + per-vertex colours (classification is per-tri).
  // Outer/original faces take `colorOuter`, the bore + newly-exposed cut faces
  // take `colorInner` (the SAME red↔grey roles as before, now the part's real
  // colours). Each falls back to the legacy red/grey when its override is absent,
  // so an un-coloured request is byte-identical to the pre-#997 behaviour.
  const outerRgb = cutHexToRgb(opts.colorOuter, LEGACY_CUT_OUTER);
  const innerRgb = cutHexToRgb(opts.colorInner, LEGACY_CUT_INNER);
  const nt = tris.length / 3;
  const outPos = new Array(nt * 9);
  const outCol = new Array(nt * 9);
  const outNrm: number[] | null = nrm ? new Array(nt * 9) : null;
  const eps = 0.02;
  for (let i = 0; i < nt; i++) {
    const a = tris[i * 3], b = tris[i * 3 + 1], c = tris[i * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cxv = verts[c * 3], cyv = verts[c * 3 + 1], cz2 = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cxv - ax, e2y = cyv - ay, e2z = cz2 - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const mx = (ax + bx + cxv) / 3, my = (ay + by + cyv) / 3;
    const centroidR = Math.sqrt(mx * mx + my * my);
    const radialDot = centroidR > 0.01 ? (nx * mx + ny * my) / (centroidR * nLen) : 0;
    const isBore = radialDot < -0.3;
    // Quarter cut → TWO exposed cross-section planes (y = 0 and x = 0); a
    // triangle lying flat on EITHER is bore-grey cut surface.
    const onCutY = Math.abs(ay) < eps && Math.abs(by) < eps && Math.abs(cyv) < eps;
    const onCutX = Math.abs(ax) < eps && Math.abs(bx) < eps && Math.abs(cxv) < eps;
    const nzNorm = Math.abs(nz / nLen);
    const maxR = Math.max(Math.sqrt(ax * ax + ay * ay), Math.sqrt(bx * bx + by * by), Math.sqrt(cxv * cxv + cyv * cyv));
    const isGrey = isBore || onCutY || onCutX || (nzNorm > 0.8 && maxR < maxOD / 2 + 0.05);
    const [r, g, bl] = isGrey ? innerRgb : outerRgb;
    const o = i * 9;
    outPos[o] = ax; outPos[o + 1] = ay; outPos[o + 2] = az;
    outPos[o + 3] = bx; outPos[o + 4] = by; outPos[o + 5] = bz;
    outPos[o + 6] = cxv; outPos[o + 7] = cyv; outPos[o + 8] = cz2;
    for (let k = 0; k < 3; k++) { outCol[o + k * 3] = r; outCol[o + k * 3 + 1] = g; outCol[o + k * 3 + 2] = bl; }
    if (outNrm && nrm) {
      outNrm[o] = nrm[a * 3]; outNrm[o + 1] = nrm[a * 3 + 1]; outNrm[o + 2] = nrm[a * 3 + 2];
      outNrm[o + 3] = nrm[b * 3]; outNrm[o + 4] = nrm[b * 3 + 1]; outNrm[o + 5] = nrm[b * 3 + 2];
      outNrm[o + 6] = nrm[c * 3]; outNrm[o + 7] = nrm[c * 3 + 1]; outNrm[o + 8] = nrm[c * 3 + 2];
    }
  }
  return { positions: outPos, colors: outCol, normals: outNrm ?? undefined, cut: true, meta: { tris: nt, verts: nt * 3, ms, tolerance: tol } };
}

/**
 * Full graph→OCCT executor: run an emitted part body with OpenCascade-backed
 * engines + booleans instead of Manifold. This covers CSG parts (the body
 * chains .add/.subtract/.intersect + mv/rot over multiple engine solids), not
 * just a single revolve.
 *
 * Strategy: build a scope where r_revolve/r_extrude/r_weld_extrude/r_loft/
 * r_cuboid return WRAPPED OCCT solids, and the wrapper maps the Manifold method
 * names the body calls onto replicad's: .add→.fuse · .subtract→.cut ·
 * .intersect→.intersect · mv→.translate · rot→.rotate. Anything unmappable
 * throws → the caller reports supported:false and the BREP tab shows
 * "no BREP path", so this never blocks the part.
 *
 * `mode:'mesh'` (what `brepFromSource` exposes) tessellates the composed solid
 * to the adaptively-meshed BrepMesh the preview endpoint ships; `mode:'solid'`
 * (what `solidFromSource` exposes for the SVG boundary projector) returns the
 * RAW composed OCCT solid instead — SAME dep resolution + wrapper + heap
 * hygiene, only the final production differs. Returns null when no OCCT solid
 * was produced (not a buildable BREP part).
 */
async function executeBrep(
  source: string,
  paramValues: Record<string, number>,
  opts: MeshOpts,
  fetchFn: typeof fetch | undefined,
  mode: 'mesh' | 'solid',
): Promise<BrepMesh | any | null> {
  await ensureOC();
  const replicad: any = await import('replicad');
  const { compileSketch } = await import('$lib/graph/sketch');
  const { resampleSpline } = await import('$lib/graph/spline-resample');
  const { splineSampler, spline3DFrames } = await import('$lib/engines/manifold/warp-spline');
  const { resolveProfile } = await import('$lib/shared/profiles/profile-presets');
  const {
    draw, makeBaseBox, makeCompound, drawPolysides,
    assembleWire, makeLine, genericSweep, loft,
  } = replicad;
  const { sweepFrames } = await import('$lib/engines/manifold/manifold-mesh');

  const m = source.match(/export\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (!m) return null;
  const fnBody = m[1];

  // ── OCCT WASM heap hygiene ────────────────────────────────────────────────
  // replicad's booleans (fuse/cut/intersect) and the sketchPoly/extrude helpers
  // allocate a NEW OCCT shape but DO NOT free their operands (unlike translate/
  // rotate, which delete their receiver, or makeCompound, which deletes its
  // operands). In a 16+ part / 1000-unit well (w_sample_1/4) every per-part
  // intermediate — two g_shaft revolves, the bore-subtract result, the mv copy,
  // and a bbox-spanning sectionCut WEDGE — therefore piles up on the WASM heap for
  // the whole compose (each per-part solid bakes fine ALONE; it is the
  // accumulation). The heap grows to 2 GB, so this alone did not sink w_sample_1
  // (that was a degenerate profile — see dedupePoly), but leaving ~100 dead
  // B-rep solids resident is a latent OOM on ever-larger wells. Fix: track every
  // wrapped shape, and at each dependency-part boundary (+ the top-level build)
  // DELETE every shape created during that sub-build that is NOT the returned
  // solid. Those non-escaping intermediates are provably dead once the
  // `new Function` body returns (only the return value stays reachable), so this
  // is pure memory hygiene — no geometry change, and no risk to reused handles
  // (reuse only happens WITHIN a body, before its boundary sweep runs).
  const tracked: any[] = [];            // underlying OCCT shapes, in creation order
  const disposed = new WeakSet<object>();
  const safeDelete = (s: any): void => {
    if (!s || typeof s !== 'object' || disposed.has(s)) return;
    disposed.add(s);
    // Skip if replicad already freed it (makeCompound/translate null the wrapped
    // handle) — calling delete() again throws inside its FinalizationRegistry.
    if ((s as any)._wrapped == null) return;
    try { if (typeof s.delete === 'function') s.delete(); } catch { /* already gone */ }
  };
  // Free every shape created since `mark` except those that escape (kept), then
  // re-parent the survivors to the enclosing scope so ITS sweep can reclaim them.
  const sweepSince = (mark: number, keptArr: any[]): void => {
    const keep = new Set(keptArr);
    for (let i = mark; i < tracked.length; i++) { const sh = tracked[i]; if (!keep.has(sh)) safeDelete(sh); }
    tracked.length = mark;
    for (const k of keptArr) tracked.push(k);
  };

  // ── wrapped OCCT solid: Manifold-method names → replicad methods ──────────
  const WRAP = Symbol('occt');
  const unwrap = (v: any) => (v && v[WRAP]) ? v[WRAP] : v;

  // ── per-part color-by-source tag (#86 "Phase B" for BREP) ─────────────────
  // The Manifold path tags each named instance with `partHashId(name)` and lets
  // Manifold's mesh relation carry that id through CSG. OCCT has no such
  // relation, so we do it by hand: `__tag(shape, id)` (spliced into the source
  // by tagInstanceSources, the SAME rewrite the MF loader uses) records the id
  // on the underlying OCCT shape, and every executor op that derives a new shape
  // from a tagged one CARRIES the id forward (carryTag) — so a part survives
  // mv / rot / warpSpline / sectionCut / booleans and arrives at the top-level
  // sub-solid list still knowing which part it is. Empty when no LUT is active
  // (the source carries no `__tag`), in which case carryTag is a pure no-op and
  // the executor is byte-identical to before.
  const partTag = new WeakMap<object, number>();
  const __tag = (x: any, id: number): any => {
    const u = unwrap(x);
    if (u && typeof u === 'object') { try { partTag.set(u, Number(id) >>> 0); } catch { /* non-taggable */ } }
    return x;
  };
  // Propagate `src`'s part tag onto a shape `out` derived from it (best-effort —
  // tagging must never break a build). Returns `out` for inline use.
  const carryTag = (src: any, out: any): any => {
    try {
      const su = unwrap(src);
      const id = (su && typeof su === 'object') ? partTag.get(su) : undefined;
      if (id !== undefined) {
        const ou = unwrap(out);
        if (ou && typeof ou === 'object' && !partTag.has(ou)) partTag.set(ou, id);
      }
    } catch { /* propagation is advisory */ }
    return out;
  };
  // Fold a boolean op over an operand that may be a single solid, a wrapped
  // solid, an ARRAY of solids, or a `place(list)` group — mirroring Manifold,
  // where `A.add(place([b,c,d]))` unions A with every element. Without this,
  // `t.fuse(array)` threw deep in replicad ("Cannot read '$$' of undefined",
  // bw_tubing) because a raw JS array has no OCCT handle. collectShapes flattens
  // the operand to individual solids; we clone each (replicad booleans consume
  // their operands) and apply the op one at a time — freeing each throwaway clone
  // and each superseded intermediate immediately (neither escapes combineBool, so
  // this never touches a handle the body still holds).
  const combineBool = (base: any, o: any, op: 'fuse' | 'cut' | 'intersect'): any => {
    const arr: any[] = []; collectShapes(o, arr);
    if (arr.length === 0) return base;
    let acc = base;
    for (const s of arr) {
      let piece: any; try { piece = s.clone(); } catch { piece = s; }
      const next = acc[op](piece);
      if (piece !== s) safeDelete(piece);   // our private clone — consumed by the boolean
      if (acc !== base) safeDelete(acc);     // prior intermediate — superseded
      acc = next;
    }
    return acc;
  };
  function wrap(shape: any): any {
    if (!shape || typeof shape !== 'object') return shape;
    // Track every OCCT solid that flows through the executor so the boundary
    // sweeps can reclaim the non-escaping ones (dedup + re-tracking is harmless —
    // safeDelete guards double-free and sweepSince dedups via a Set).
    if (typeof (shape as any).mesh === 'function' && !disposed.has(shape)) tracked.push(shape);
    const proxy: any = new Proxy(shape, {
      get(t, prop) {
        if (prop === WRAP) return t;
        // A boolean result inherits the BASE's part tag (the tool is subtractive
        // / additive; the surface belongs to the receiver) — matches the MF rule.
        if (prop === 'add' || prop === 'union') return (o: any) => wrap(carryTag(t, combineBool(t, o, 'fuse')));
        if (prop === 'subtract') return (o: any) => wrap(carryTag(t, combineBool(t, o, 'cut')));
        if (prop === 'intersect') return (o: any) => wrap(carryTag(t, combineBool(t, o, 'intersect')));
        const val = (t as any)[prop];
        if (typeof val === 'function') return (...a: any[]) => {
          const r = val.apply(t, a.map(unwrap));
          // A derived shape (clone/translate/rotate/revolve/…) keeps its source's tag.
          return (r && typeof r === 'object' && typeof r.mesh === 'function') ? wrap(carryTag(t, r)) : r;
        };
        return val;
      },
    });
    return proxy;
  }

  // Drop consecutive coincident points (and a trailing point equal to the first)
  // from a 2D polygon. Manifold silently tolerates a zero-length edge — an
  // authored profile hits one whenever two vertices collapse at a param extreme
  // (e.g. bw_hanger's chamfer === length → [od/2, length-chamfer] == [od/2, 0]).
  // OCCT's EXACT kernel instead throws a Standard_Failure building the degenerate
  // edge, which poisoned the whole assembly bake (misread as a heap OOM). Removing
  // a duplicate vertex is a geometric no-op, so this is pure robustness — it makes
  // the BREP wire builder as forgiving as the Manifold oracle.
  const POLY_EPS = 1e-6;
  const dedupePoly = (pts: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const pt of pts) {
      const prev = out[out.length - 1];
      if (!prev || Math.abs(pt[0] - prev[0]) > POLY_EPS || Math.abs(pt[1] - prev[1]) > POLY_EPS) out.push([pt[0], pt[1]]);
    }
    // .close() re-adds the closing edge, so a trailing vertex ≈ the first would
    // itself be a zero-length edge — trim any such.
    while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= POLY_EPS && Math.abs(out[0][1] - out[out.length - 1][1]) <= POLY_EPS) out.pop();
    return out;
  };
  // Build a closed replicad drawing from a 2D point list, sketch on a plane
  // (optionally offset along the plane normal — `z` for a stack of XY sections).
  const sketchPoly = (rawPts: [number, number][], plane: 'XZ' | 'XY', z?: number) => {
    if (!Array.isArray(rawPts) || rawPts.length < 3) throw new Error('profile < 3 pts');
    const pts = dedupePoly(rawPts);
    if (pts.length < 3) throw new Error('profile < 3 pts (after coincident-vertex dedupe)');
    let d = draw([pts[0][0], pts[0][1]]);
    for (let i = 1; i < pts.length; i++) d = d.lineTo([pts[i][0], pts[i][1]]);
    return z === undefined ? d.close().sketchOnPlane(plane) : d.close().sketchOnPlane(plane, z);
  };
  const asPts = (p: any): [number, number][] =>
    (typeof p === 'string' ? JSON.parse(p) : p) as [number, number][];

  // ── OCCT-backed engines ──────────────────────────────────────────────────
  // Faceted (N-gon) revolve — OCCT's revolve() is the EXACT (round) surface and
  // ignores `segments`, so a low-poly design (segments=4 → square prism) rendered
  // round in BREP. Loft regular N-gon sections (circumradius r at each off-axis
  // profile point, height z), ruled = flat faces → a true faceted solid that
  // matches Manifold. Throws on profiles that don't reduce to a simple z-stack
  // (annular/cone/non-monotonic) → caller falls back to the exact revolve.
  const FACET_MAX = 48; // above this, exact revolve (visually round + cheaper)
  const facetedRevolve = (prof: [number, number][], seg: number) => {
    const n = Math.max(3, Math.floor(seg));
    const eps = 1e-6;
    const sections: any[] = [];
    let lastZ: number | undefined;
    for (const [r, z] of prof) {
      if (r <= eps) continue;
      if (lastZ !== undefined && Math.abs(z - lastZ) < eps) {
        throw new Error('faceted revolve: coincident-z sections (annular/step) — exact fallback');
      }
      sections.push(drawPolysides(r, n).sketchOnPlane('XY', z));
      lastZ = z;
    }
    if (sections.length < 2) throw new Error('faceted revolve needs ≥2 off-axis profile points');
    return wrap(sections[0].loftWith(sections.slice(1), { ruled: true }));
  };
  const r_revolve = (a: any, b?: any) => {
    const prof = asPts(Array.isArray(a) ? a : a.profile);
    const seg = typeof b === 'number' ? b
      : (a && typeof a.segments === 'number' ? a.segments : undefined);
    if (typeof seg === 'number' && seg >= 3 && seg <= FACET_MAX) {
      try { return facetedRevolve(prof, seg); } catch { /* fall through to exact */ }
    }
    return wrap(sketchPoly(prof, 'XZ').revolve());
  };
  // taper: MF's r_weld_extrude scales the top face by `1 - taper` (Z-down
  // convention — taper > 0 narrows the far/bottom end). replicad's
  // `extrusionProfile: { profile:'linear', endFactor }` scales the section
  // linearly from 1 at the base to `endFactor` at the top, so endFactor = 1 −
  // taper is the exact-kernel equivalent (a straight-ruled tapered prism, not a
  // welded morph). Without this BREP extruded straight → g_star/new_assy came
  // out ~22% over-volume vs the Manifold oracle.
  const extrudeXY = (profile: any, length: number, twist = 0, taper = 0) => {
    const prof = asPts(profile);
    const sk = sketchPoly(prof, 'XY');
    const h = Math.max(0.01, length);
    const opts: any = {};
    if (twist) opts.twistAngle = twist;
    if (taper) opts.extrusionProfile = { profile: 'linear', endFactor: Math.max(0.001, 1 - taper) };
    return wrap(Object.keys(opts).length ? sk.extrude(h, opts) : sk.extrude(h));
  };
  const r_weld_extrude = (a: any, length?: number, _divs?: number, twist?: number, taper?: number) => {
    if (a && a.profile !== undefined) return extrudeXY(a.profile, a.length, a.twist ?? 0, a.taper ?? 0);
    return extrudeXY(a, length ?? 2, twist ?? 0, taper ?? 0);
  };
  const r_extrude = (a: any, height?: number, twist?: number, taper?: number) => {
    if (a && a.profile !== undefined) return extrudeXY(a.profile, a.height ?? a.length, a.twist ?? 0, a.taper ?? 0);
    return extrudeXY(a, height ?? 2, twist ?? 0, taper ?? 0);
  };
  // r_loft — sweep a 2D section down z while SCALING it by a smooth
  // shape-along-length curve (barrel/waist/flare/ogive/scurve) + twist. This is
  // exactly what replicad's `extrusionProfile` CANNOT do: its 'linear'/'s-curve'
  // scale monotonically from 1 → endFactor at the END, so a barrel (fat MIDDLE,
  // equal ends) came out end-swollen (g_barrel diverged ~10% vol/bbox vs MF).
  // Reproduce the engine's `scaleAt(t)` (r_loft.ts is the source of truth) and
  // loft a stack of per-t scaled+rotated sections — a true exact-kernel loft
  // matching the Manifold gridPatch build.
  const r_loft = (a: any, length?: number, divsArg?: number, twist?: number, bulge?: number, shapeArg?: string) => {
    const prof = asPts(Array.isArray(a) ? a : a.profile);
    const L = Math.max(0.01, (a && a.length !== undefined) ? a.length : (length ?? 6));
    const tw = ((a && a.twist !== undefined) ? a.twist : (twist ?? 0)) as number;
    const amp = Number((a && a.bulge !== undefined) ? a.bulge : (bulge ?? 0)) || 0;
    const shape = (a && a.shape !== undefined) ? a.shape : (shapeArg ?? 'barrel');
    const twRad = (Number(tw) || 0) * Math.PI / 180;
    // No shape scaling AND no twist → a straight prism (fast, exact).
    if (amp === 0 && !twRad) return extrudeXY(prof, L, 0, 0);
    const smoothstep = (x: number) => x * x * (3 - 2 * x);
    const scaleAt = (t: number): number => {
      let s: number;
      switch (shape) {
        case 'waist':  s = 1 - amp * Math.sin(Math.PI * t); break;
        case 'flare':  s = 1 + amp * t; break;
        case 'ogive':  s = 1 - amp * t * t; break;
        case 'scurve': s = 1 + amp * (smoothstep(t) - 0.5); break;
        case 'barrel':
        default:       s = 1 + amp * Math.sin(Math.PI * t); break;
      }
      return Math.max(0.02, s);
    };
    const N = Math.max(4, Math.min(96, Math.round((a && a.divs) || divsArg || 24)));
    const sections: any[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const s = scaleAt(t), th = twRad * t, ct = Math.cos(th), st = Math.sin(th);
      const scaled = prof.map(([x, y]) => [s * (x * ct - y * st), s * (x * st + y * ct)] as [number, number]);
      sections.push(sketchPoly(scaled, 'XY', t * L));
    }
    // ruled = flat facets between rings (matches the welded gridPatch quads).
    return wrap(sections[0].loftWith(sections.slice(1), { ruled: true }));
  };
  const r_cuboid = (w: number, h: number, d: number) => wrap(makeBaseBox(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)));

  // ── r_sweep — extrude a fixed 2D cross-section along a 3D PATH (exact-curve
  // BRep pipe). OCCT counterpart of the Manifold sweepAlongPath: instead of a
  // welded triangle grid, build a smooth BSpline spine wire + a profile wire,
  // and pipe them with BRepOffsetAPI_MakePipeShell (replicad.genericSweep), which
  // caps the ends and MakeSolid()s → a watertight B-rep solid. The exact kernel
  // then produces a CLEAN annular cap under a concentric subtract, where the
  // Manifold mesh boolean slivers on the tilted coplanar caps (the spike).
  //
  // The section's local coords `[a,b]` are planted in a stable start-frame
  // (side,up ⟂ start tangent) exactly like the Manifold path; genericSweep's
  // forceProfileSpineOthogonality transports it torsion-minimised along the
  // spine. 3D section points [x,y,0] use their first two coords (matches the
  // Manifold r_sweep, which destructures `[a,b]` off each entry).
  const V = {
    sub: (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    cross: (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a: number[]) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; },
    dot: (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  };
  const asPath = (p: any): number[][] =>
    (typeof p === 'string' ? JSON.parse(p) : p).map((q: any) => [Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0]);
  // The ORIGINAL transport sweep (MakePipeShell) — kept as fallback for closed
  // loops + any loft failure. Polyline (not BSpline) spine is deliberate:
  // makeBSplineApproximation over near-cusp arc-length samples sends MakePipeShell
  // into an effectively-infinite build; a polyline builds fast and rides the SAME
  // points the Manifold sweep does.
  const sweepPipeShell = (pathPts: number[][], sec: number[][], closedPath: boolean) => {
    const spinePath = closedPath ? [...pathPts, pathPts[0]] : pathPts;
    const spineEdges: any[] = [];
    for (let i = 0; i < spinePath.length - 1; i++) spineEdges.push(makeLine(spinePath[i], spinePath[i + 1]));
    const spineWire = assembleWire(spineEdges);
    const t = V.norm(V.sub(pathPts[1], pathPts[0]));
    let up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const side = V.norm(V.cross(t, up));
    up = V.norm(V.cross(side, t));
    const P0 = pathPts[0];
    const pt3 = (a: number, b: number) => [P0[0] + side[0] * a + up[0] * b, P0[1] + side[1] * a + up[1] * b, P0[2] + side[2] * a + up[2] * b];
    const edges: any[] = [];
    for (let i = 0; i < sec.length; i++) edges.push(makeLine(pt3(sec[i][0], sec[i][1]), pt3(sec[(i + 1) % sec.length][0], sec[(i + 1) % sec.length][1])));
    return genericSweep(assembleWire(edges), spineWire, { forceProfileSpineOthogonality: true });
  };

  const sweepOcct = (path: number[][], section2d: any[], closedPath: boolean) => {
    const pathPts = asPath(path);
    if (pathPts.length < 2) throw new Error('r_sweep: path needs ≥2 points');
    const sec = (typeof section2d === 'string' ? JSON.parse(section2d) : section2d)
      .map((s: any) => [Number(s[0]) || 0, Number(s[1]) || 0]);
    if (sec.length < 3) throw new Error('r_sweep: section needs ≥3 points');

    // RAIL-MAJOR loft — place the section at EACH path station on a rotation-
    // minimizing frame (sweepFrames: the SAME frames the Manifold sweep rides) and
    // loft (ThruSections) through the ring stack. Used ONLY as the recovery for a
    // MakePipeShell throw (below).
    const railLoft = () => {
      const frames = sweepFrames(pathPts as any, { closedPath: false });
      const rings = frames.map((f: any) => {
        const w = (a: number, b: number) => [f.o[0] + f.side[0] * a + f.up[0] * b, f.o[1] + f.side[1] * a + f.up[1] * b, f.o[2] + f.side[2] * a + f.up[2] * b];
        const edges: any[] = [];
        for (let i = 0; i < sec.length; i++) edges.push(makeLine(w(sec[i][0], sec[i][1]), w(sec[(i + 1) % sec.length][0], sec[(i + 1) % sec.length][1])));
        return assembleWire(edges);
      });
      return loft(rings, { ruled: true });
    };

    // MakePipeShell FIRST — it produces exact swept surfaces and is clean for the
    // smooth open sweeps that matter (arcs, S-curves). It only THROWS a
    // Standard_Failure on some resampled splines (e.g. sweep_tube_demo, a nearly-
    // straight micro-wiggly spine that MF bakes fine). On that throw ONLY, recover
    // with the rail loft, which bakes those cases at exact volume parity. Loft is
    // NOT the primary: ThruSections overshoots through rings on an S-curve → a
    // self-overlapping solid (20-33% volume error), whereas MakePipeShell sweeps
    // those clean. The throw does not corrupt the heap for the immediate retry
    // (verified: loft-after-throw → parity 0.0%); if the loft ALSO throws, re-throw
    // the original error so the executor's outer handler resets OCCT + reports it.
    if (closedPath !== true) {
      try { return wrap(sweepPipeShell(pathPts, sec, false)); }
      catch (ePipe) {
        try { return wrap(railLoft()); }
        catch { throw ePipe; }
      }
    }
    return wrap(sweepPipeShell(pathPts, sec, closedPath));
  };
  const r_sweep = (a: any, section?: any, closedPath?: any) => {
    if (a && a.path !== undefined) return sweepOcct(a.path, a.section, a.closedPath === true);
    return sweepOcct(a, section, closedPath === true);
  };

  // warpSpline — BREP-native deviated-well warp (E4: warp via spline sweep). Bend
  // a straight element onto a survey trajectory by RE-SWEEPING its cross-section
  // along the spline, since Manifold.warp (per-vertex displacement) has no
  // exact-kernel twin. A straight part is a prism — a constant cross-section
  // extruded along Z; warping is that SAME section swept along the curved survey
  // path with BRepOffsetAPI_MakePipeShell (replicad.genericSweep — the sweepOcct
  // machinery, polyline spine + forceProfileSpineOthogonality torsion-min transport).
  //
  // The section is EXTRACTED from the input solid's start cap (outer wire = solid
  // boundary; inner wires = bores), so whatever was baked in rides along: a
  // section-cut casing arrives as a HALF-annulus and sweeps to a curved
  // half-section DIRECTLY — the 180° cut lives in the profile BEFORE the sweep,
  // which is the correct/robust way to section a deviated part. (Cutting the
  // CURVED solid with the axis-aligned sectionCut wedge is geometrically WRONG:
  // the z-extruded wedge does not follow the trajectory, so it over-removes
  // downhole where the part deviated off-axis — measured ~67% removed, not 50%.)
  //
  // The z→arc-length map + frame convention mirror warpManifoldAlongSpline so a
  // STRAIGHT survey reproduces the un-warped solid: a section point's local (x,y)
  // becomes an offset on the spline frame at arc-length s = z − (originZ ?? z0)
  // (planar: in-plane N + world-Y B; 3D: RMF via spline3DFrames). Any solid with
  // no z-cap (unswept/odd) — or a sweep that throws — passes through unchanged so
  // warp never poisons a bake (the pre-E4 straight-passthrough safety is kept).

  // Tuning constants for the spline sweep + section extraction.
  const MIN_SPINE = 6, MAX_SPINE = 200;      // polyline-spine sample-count clamp
  const SECTION_SAMPLE_FLOOR = 48;           // min cap-wire samples (before collinear-collapse)
  const SECTION_SAMPLES_PER_EDGE = 6;        // extra cap-wire samples per wire edge
  const CAP_NORMAL_MIN = 0.99;               // |face-normal·Z| for a face to count as an axial cap
  const WELD_EPS = 1e-5;                      // distance below which two cap samples are one point
  const COLLINEAR_EPS = 1e-4;                // triangle-area floor to keep a cap-wire point as a corner

  // Out-of-plane (world-Y) span of the survey control points — the planar-vs-3D
  // discriminator (a genuinely deviated survey has non-negligible y variation).
  const yRangeOf = (points: number[][]): number => {
    let lo = Infinity, hi = -Infinity;
    for (const p of points) { const y = Number(p[1]) || 0; if (y < lo) lo = y; if (y > hi) hi = y; }
    return hi - lo;
  };
  // Sampler over the (already arc-length-resampled) survey path — the SAME planar
  // world-Y / 3D-RMF split warpManifoldAlongSpline uses, so BREP + Manifold agree
  // on which way the section faces + how far along it sits. `at(s)` → { pos, N, B }.
  const makeWarpSampler = (path: number[][]) => {
    const is3D = yRangeOf(path) > 1e-6;
    const frames = is3D ? spline3DFrames(path as any) : null;             // 3D: rotation-minimizing frame
    const planar = is3D ? null : splineSampler(path.map((p) => [p[0], p[2]]) as any); // planar: (x,z) + world-Y up
    const total = frames ? frames.total : planar!.total;
    const at = (s: number): { pos: number[]; N: number[]; B: number[] } => {
      if (frames) { const r = frames.at(s); return { pos: r.pos as number[], N: r.N as number[], B: r.B as number[] }; }
      const r = planar!.sampleAt(s); const t = r.tan as number[]; const tanLen = Math.hypot(t[2], t[0]) || 1;
      return { pos: r.pos as number[], N: [t[2] / tanLen, 0, -t[0] / tanLen], B: [0, 1, 0] };
    };
    return { total, at };
  };
  // Extract the start-cap cross-section of a straight prism as 2D loops (outer +
  // inner bores). Densely samples each cap wire via pointAt, then collapses
  // collinear runs back to the polygon vertices → a lean faceted section.
  // NOTE Face.outerWire() DELETES the face handle, so clone the face BEFORE
  // reading its inner wires (else "This object has been deleted").
  const extractCapSection = (solid: any): { outer: [number, number][]; inner: [number, number][][]; z0: number; z1: number } | null => {
    let bounds: any; try { bounds = solid.boundingBox.bounds; } catch { return null; }
    const z0 = bounds[0][2], z1 = bounds[1][2];
    // Pick the top cap = the axis-perpendicular face at min z (Z-down convention).
    let cap: any = null, bestZ = Infinity;
    for (const face of solid.faces) {
      let nz = 0; try { nz = face.normalAt().z; } catch { continue; }
      if (Math.abs(nz) < CAP_NORMAL_MIN) continue;      // cap normal must be ∥ Z
      let cz = 0; try { cz = face.center.z; } catch { continue; }
      if (cz < bestZ) { bestZ = cz; cap = face; }        // top cap = min-z (Z-down)
    }
    if (!cap) return null;
    // Sample one cap wire densely, weld coincident samples, then keep only the
    // polygon corners (drop collinear interior samples) → a lean faceted loop.
    const sampleLoop = (wire: any): [number, number][] => {
      let nEdge = 4; try { nEdge = wire.edges.length; } catch { /* keep default */ }
      const nSamples = Math.max(SECTION_SAMPLE_FLOOR, nEdge * SECTION_SAMPLES_PER_EDGE);
      const sampled: [number, number][] = [];
      for (let i = 0; i < nSamples; i++) { const v = wire.pointAt(i / nSamples); sampled.push([v.x, v.y]); }
      const deduped: [number, number][] = [];
      for (const p of sampled) { const q = deduped[deduped.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > WELD_EPS) deduped.push(p); }
      const corners: [number, number][] = [];
      for (let i = 0; i < deduped.length; i++) {
        const prev = deduped[(i - 1 + deduped.length) % deduped.length], cur = deduped[i], next = deduped[(i + 1) % deduped.length];
        if (Math.abs((cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0])) > COLLINEAR_EPS) corners.push(cur);
      }
      return corners.length >= 3 ? corners : deduped;
    };
    let outer: [number, number][]; const inner: [number, number][][] = [];
    try {
      const capClone = cap.clone();                     // read inner wires off the clone (outerWire() deletes `cap`)
      outer = sampleLoop(cap.outerWire());              // consumes `cap`
      try { for (const innerWire of capClone.innerWires()) inner.push(sampleLoop(innerWire)); } catch { /* no bores */ }
    } catch { return null; }
    if (outer.length < 3) return null;
    return { outer, inner, z0, z1 };
  };
  const warpSpline = (solidArg: any, path: any, opts?: any): any => {
    // A LIST input (a parts_table aggregate — or any list of solids — wired as the
    // warp's single child) inlines to a JS ARRAY here. A JS array has no `.mesh`, so
    // the guard below used to return it UNWARPED — the "BREP doesn't warp the
    // multi-part, only individual parts" bug (2026-07-13; mirrors the MF warpSpline
    // array fix). Map the warp over each member so every element bends along the
    // spline; each stays tagged (carryTag) so color-by-source survives.
    if (Array.isArray(solidArg)) return solidArg.map((el) => warpSpline(el, path, opts));
    const solid = unwrap(solidArg);
    if (!solid || typeof solid.mesh !== 'function' || !Array.isArray(path) || path.length < 2) return solidArg;

    // Phase 1 — extract the straight prism's start-cap section (outer loop + bores).
    const section = extractCapSection(solid);
    if (!section) return solidArg;                      // no section to sweep → leave straight

    // Phase 2 — build the arc-length sampler + the z→arc-length map. A section point
    // at world-z rides the spline at arc-length s = z − zBase (mirrors warpManifoldAlongSpline).
    const sampler = makeWarpSampler(path.map((q: any) => [Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0]));
    const zBase = (opts && opts.originZ !== undefined) ? Number(opts.originZ) : section.z0;
    const sStart = section.z0 - zBase, sEnd = section.z1 - zBase;
    if (!(sEnd > sStart)) return solidArg;

    // Phase 3 — build the polyline spine over the covered arc. Sample count ≈ input
    // path resolution over that arc (refine bumps it modestly). The polyline spine rides
    // the SAME resampled points the Manifold warp bends along — identical fidelity, no
    // BSpline-approximation risk (the documented MakePipeShell pathology).
    const refine = Math.max(1, Math.min(8, Math.floor(opts?.refine ?? 1)));
    const step = sampler.total / Math.max(1, path.length - 1);
    const nSpine = Math.max(MIN_SPINE, Math.min(MAX_SPINE, Math.round(((sEnd - sStart) / step) * (refine > 1 ? 1.5 : 1))));
    const spinePts: number[][] = [];
    for (let i = 0; i <= nSpine; i++) spinePts.push(sampler.at(sStart + (sEnd - sStart) * (i / nSpine)).pos);

    // Phase 4 — plant a 2D section loop into the start frame at pos(sStart): a local
    // (a,b) becomes a world offset on that frame's (startN, startB) axes.
    const startFrame = sampler.at(sStart);
    const startPos = startFrame.pos, startN = startFrame.N, startB = startFrame.B;
    const toWorld = (a: number, b: number) => [
      startPos[0] + startN[0] * a + startB[0] * b,
      startPos[1] + startN[1] * a + startB[1] * b,
      startPos[2] + startN[2] * a + startB[2] * b,
    ];

    // Phase 5 — pipe a planted loop along the spine.
    const sweepLoop = (loop: [number, number][]) => {
      const spineEdges: any[] = [];
      for (let i = 0; i < spinePts.length - 1; i++) spineEdges.push(makeLine(spinePts[i], spinePts[i + 1]));
      const spineWire = assembleWire(spineEdges);
      const profileEdges: any[] = [];
      for (let i = 0; i < loop.length; i++) {
        profileEdges.push(makeLine(toWorld(loop[i][0], loop[i][1]), toWorld(loop[(i + 1) % loop.length][0], loop[(i + 1) % loop.length][1])));
      }
      return genericSweep(assembleWire(profileEdges), spineWire, { forceProfileSpineOthogonality: true });
    };
    try {
      let result = sweepLoop(section.outer);
      // Bores: sweep each inner loop + subtract on the CURVED solid. The exact OCCT
      // kernel subtracts coaxial curved sweeps cleanly (unlike the Manifold mesh
      // boolean's coincident-tilted-cap slivers — memory r_sweep_normals_and_twist).
      // Single-pass annular sweep evaluated + rejected: replicad's genericSweep/
      // MakePipeShell take a single profile WIRE only (MakePipeShell.Add(face) throws),
      // and raw BRepOffsetAPI_MakePipe on an annular face uses a non-orthogonality
      // transport that mis-volumes the bend (~8× over) — so outer-sweep-then-subtract-bore
      // it is (both swept with the same orthogonality transport ⇒ coaxial, clean subtract).
      for (const bore of section.inner) result = result.cut(sweepLoop(bore));
      // The warped/swept solid IS this part bent onto the trajectory — carry the
      // part tag so color-by-source survives the warp (the repro part warps every
      // element). Passthrough returns above keep the original tagged proxy.
      return wrap(carryTag(solidArg, result));
    } catch {
      return solidArg;                                  // sweep failed → straight fallback, never poison
    }
  };

  // transforms — replicad/OCCT transforms DELETE their input shape's handle
  // after producing the moved copy (replicad Shape.translate/rotate call
  // this.delete()). A `repeat` that reuses ONE shape across N transforms
  // (e.g. casing_schematic: Array.from(N, i => mv(B, [0,0,200*i]))) frees B on
  // the first call and then uses a deleted handle → "This object has been
  // deleted" (#19). clone() FIRST (non-destructive) so the source survives for
  // the next iteration — same defensive pattern as compoundOf/stackOcct below.
  const mv = (s: any, v: number[]) => wrap(carryTag(s, unwrap(s).clone().translate([v[0] || 0, v[1] || 0, v[2] || 0])));
  const rot = (s: any, v: number[]) => {
    let sh = unwrap(s).clone();
    if (v[0]) sh = sh.rotate(v[0], [0, 0, 0], [1, 0, 0]);
    if (v[1]) sh = sh.rotate(v[1], [0, 0, 0], [0, 1, 0]);
    if (v[2]) sh = sh.rotate(v[2], [0, 0, 0], [0, 0, 1]);
    return wrap(carryTag(s, sh));
  };
  // place(a, b, …) or place([a, b, …]) — topological compose. Manifold's place
  // UNIONS overlapping bodies + groups disjoint ones; for BREP we keep the parts
  // separate (flattened) and let any downstream boolean (combineBool) or the
  // final collectShapes → makeCompound do the grouping — so a reused part isn't
  // prematurely fused. Returns a wrapped solid (single) or an array of wrapped
  // solids (multi), both of which collectShapes/combineBool flatten correctly.
  const place = (...args: any[]) => {
    const arr: any[] = []; collectShapes(args, arr);
    if (arr.length === 0) return undefined;
    if (arr.length === 1) return wrap(arr[0]);
    return arr.map(wrap);
  };

  // sectionCut — subtract an AUTHORED angular WEDGE (pie slice spanning `az`
  // degrees at bearing `offset`) from a solid, the exact-kernel twin of
  // manifold-helpers.sectionCut. Used INSIDE part bodies (bw_casing/bw_cement/…)
  // to bake a longitudinal half-section into the geometry (az 180 = half-pipe),
  // NOT the render-time cutaway. Build the same pie-slice polygon MF builds,
  // extrude it past both z-ends, and `.cut()` it — so BREP reproduces the same
  // sectioned solid the Manifold oracle does (previously "sectionCut is not
  // defined" failed 13 parts + every well assembly depending on bw_casing).
  const sectionCut = (solid: any, opts?: { az?: number; offset?: number }) => {
    const s = unwrap(solid);
    if (!s || typeof s.cut !== 'function' || !s.boundingBox) return solid;
    const az = Number(opts?.az ?? 180);
    const offset = Number(opts?.offset ?? 0);
    if (!(az > 0) || az >= 360) return solid; // az≤0 → no cut; ≥360 → full removal (leave solid; empty is fragile in OCCT)
    const bb = s.boundingBox.bounds; // [[xmin,ymin,zmin],[xmax,ymax,zmax]]
    const MARGIN = 20;
    const R = Math.max(Math.abs(bb[0][0]), Math.abs(bb[1][0]), Math.abs(bb[0][1]), Math.abs(bb[1][1])) + MARGIN;
    const zlen = (bb[1][2] - bb[0][2]) + 2 * MARGIN;
    const z0 = bb[0][2] - MARGIN;
    const seg = Math.max(2, Math.ceil(az / 5));
    const pts: [number, number][] = [[0, 0]];
    for (let i = 0; i <= seg; i++) {
      const a = ((offset + (az * i) / seg) * Math.PI) / 180;
      pts.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const wedge = sketchPoly(pts, 'XY').extrude(Math.max(0.01, zlen)).translate([0, 0, z0]);
    const cutRes = s.cut(wedge);
    safeDelete(wedge);   // private throwaway — free the bbox-spanning wedge now (16 of these in a well)
    return wrap(carryTag(solid, cutRes));   // the sectioned solid is still this part
  };
  // Stack-ref offset (graded-delta z mate): stash the delta on the underlying
  // OCCT shape so stack() can read it (mirrors Manifold's `_stackRef`).
  const stackRefMap = new WeakMap<object, number>();
  const withStackRef = (s: any, offset?: number) => {
    const u = unwrap(s);
    if (u && typeof u === 'object') { try { stackRefMap.set(u, Number(offset) || 0); } catch { /* */ } }
    return s;
  };
  const stackRefOf = (s: any): number => { const u = unwrap(s); return (u && stackRefMap.get(u)) || 0; };
  const tailZ = (shape: any): number => { try { return shape.boundingBox.bounds[1][2]; } catch { return 0; } };
  // stack([A,B,C]) — Z-down end-to-end: each child sits at the previous child's
  // tail (z-max) + its stackRef delta (0=flush, +=gap, −=overlap). Matches
  // manifold-helpers.stack(). list/group stay origin-compounds (compoundOf).
  const stackOcct = (...xs: any[]) => {
    const arr: any[] = []; collectShapes(xs, arr);
    if (arr.length === 0) return undefined;
    let cursor = 0;
    const placed: any[] = [];
    for (let i = 0; i < arr.length; i++) {
      const ref = stackRefOf(arr[i]);
      let base: any; try { base = arr[i].clone(); } catch { base = arr[i]; }
      const p = i === 0 ? base : base.translate([0, 0, cursor]);
      cursor = tailZ(p) + ref;
      placed.push(p);
    }
    const safe = placed.map((s) => { try { return s.clone(); } catch { return s; } });
    return wrap(safe.length === 1 ? safe[0] : makeCompound(safe));
  };
  const sketch = (ops: any[], segs = 64) => compileSketch(ops, segs);

  // Collect wrapped OCCT solids out of any return value (shape | array | stack).
  const collectShapes = (v: any, into: any[]) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach((x) => collectShapes(x, into)); return; }
    const s = unwrap(v);
    if (s && typeof s.mesh === 'function' && typeof s.cut === 'function') into.push(s);
  };
  // Composition containers: stack / list / group all just gather solids into a
  // compound for BREP (topological compose ≈ a non-fused compound).
  const compoundOf = (...xs: any[]) => {
    const arr: any[] = []; collectShapes(xs, arr);
    // Clone before compounding — OCCT frees operands consumed by makeCompound,
    // and a part reused across the stack would then throw "object deleted".
    const safe = arr.map((s) => { try { return typeof s.clone === 'function' ? s.clone() : s; } catch { return s; } });
    return safe.length === 1 ? wrap(safe[0]) : wrap(makeCompound(safe));
  };

  // ── recursively resolve volume-part dependencies → callable functions ─────
  // A composed body calls sub-parts as `g_dp_box({ wall: p.wall, … })`; the
  // named-args object IS the sub-part's `p`. Engines are already injected, so
  // only non-engine meta.uses need resolving (transitively).
  const ENGINES = new Set(['r_revolve', 'r_weld_extrude', 'r_loft', 'r_extrude', 'r_cuboid', 'r_sweep']);
  const parseUses = (src: string): string[] => {
    const m2 = src.match(/uses:\s*\[([\s\S]*?)\]/);
    if (!m2) return [];
    return [...m2[1].matchAll(/['"]([a-z_][a-z0-9_]*)['"]/gi)].map((x) => x[1]);
  };
  const depSrc: Record<string, string> = {};
  async function collectDeps(src: string): Promise<void> {
    for (const nm of parseUses(src)) {
      if (ENGINES.has(nm) || depSrc[nm]) continue;
      const s = await getDepSource(nm, fetchFn);
      if (s) { depSrc[nm] = s; await collectDeps(s); }
    }
  }
  await collectDeps(source);

  // Build the shared scope once; dep fns close over it (mutual recursion ok —
  // all built before any runs).
  const depFns: Record<string, (args?: any) => any> = {};
  const NAMES = [
    'p', 'sketch', 'r_revolve', 'r_weld_extrude', 'r_loft', 'r_extrude', 'r_cuboid', 'r_sweep',
    'resampleSpline', 'resolveProfile', 'sectionCut', 'warpSpline',
    'mv', 'rot', 'place', 'withStackRef', 'stack', 'list', 'group',
    '__tag',
    ...MATH_NAMES,
  ];
  const baseVals = (p: any) => [
    p, sketch, r_revolve, r_weld_extrude, r_loft, r_extrude, r_cuboid, r_sweep,
    resampleSpline, resolveProfile, sectionCut, warpSpline,
    mv, rot, place, withStackRef, stackOcct, compoundOf, compoundOf,
    __tag,
    ...MATH_VALUES,
  ];
  function bodyOf(src: string): string | null {
    const mm = src.match(/export\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
    return mm ? mm[1] : null;
  }
  // Run a body and return the FLAT list of top-level output solids (each still
  // carrying its part tag). The top-level per-part colour path meshes these
  // separately; runBody (below) compounds them into one solid for the legacy /
  // dep path.
  function runBodyRaw(src: string, pv: any): any[] {
    const b = bodyOf(src);
    if (!b) throw new Error('no function body');
    const depNames = Object.keys(depFns);
    const runner = new Function(...NAMES, ...depNames, 'return (function(){' + b + '})();');
    const out = runner(...baseVals(pv), ...depNames.map((n) => depFns[n]));
    const arr: any[] = []; collectShapes(out, arr);
    return arr;
  }
  function runBody(src: string, pv: any): any {
    const arr = runBodyRaw(src, pv);
    if (arr.length === 0) return null;
    return arr.length === 1 ? arr[0] : makeCompound(arr);
  }
  // meta.params defaults of a dep source, so an omitted named-arg falls back to
  // the sub-part's default (mirrors the primitive-loader object-style merge —
  // the g_dp_stand → g_dp_joint({…}) omits od_collar fix).
  const defaultsOf = (src: string): Record<string, number> => {
    const out: Record<string, number> = {};
    const blkM = src.match(/params:\s*\{([\s\S]*?)\n  \}/);
    const blk = blkM ? blkM[1] : src;
    for (const mm of blk.matchAll(/(\w+):\s*\{[^{}]*?default:\s*([-\d.]+)/g)) out[mm[1]] = parseFloat(mm[2]);
    return out;
  };
  for (const nm of Object.keys(depSrc)) {
    const dd = defaultsOf(depSrc[nm]);
    depFns[nm] = (args?: any) => {
      const merged = (args && typeof args === 'object' && !Array.isArray(args)) ? { ...dd, ...args } : args;
      const mark = tracked.length;
      const s = runBody(depSrc[nm], merged ?? {});
      const result = s ? wrap(s) : s;
      // Reclaim every intermediate this sub-part built (revolves, bores, cut
      // wedges, mv copies) — only `result` escapes, so the rest are provably
      // dead. Bounds the live-shape set to O(finished parts) so a large well's
      // working set stays flat instead of growing with every component.
      const kept: any[] = []; collectShapes(result, kept);
      sweepSince(mark, kept);
      return result;
    };
  }

  // Mesh EACH top-level sub-solid separately + tint it with its part's LUT
  // colour (color-by-source for BREP). Reads each shape's part tag (set by
  // __tag, carried through the executor) and frees the meshed intermediate. The
  // pure concat/colour work lives in assemblePartColorMesh (unit-tested).
  //
  // #947 — the returned mesh ALSO carries a per-part `parts[]` list (each entry =
  // one subpart's geometry + its resolved appearance, via assemblePartMeshList).
  // The merged `positions`/`colors` stay the camera-fit bbox mesh; the client
  // renders `parts[]` through the scene's per-part arm so each subpart shows its
  // OWN material (opacity · MATL preset · texture), at parity with MF — instead
  // of one flat, opaque merged mesh.
  function meshBrepParts(subSolids: any[], lut: PartColorLUT, t0p: number): BrepMesh {
    const tol = opts.tolerance ?? 0.05;
    const ang = opts.angularTolerance ?? 0.3;
    const subs: BrepSubMesh[] = [];
    for (const shape of subSolids) {
      let meshed: any;
      try { meshed = shape.mesh({ tolerance: tol, angularTolerance: ang }); }
      catch { safeDelete(shape); continue; }
      subs.push({
        vertices: Array.from(meshed.vertices ?? []) as number[],
        triangles: Array.from(meshed.triangles ?? []) as number[],
        normals: meshed.normals ? (Array.from(meshed.normals) as number[]) : undefined,
        hashId: partTag.get(shape),
      });
      safeDelete(shape);   // its mesh is captured — free the OCCT solid now
    }
    const merged = assemblePartColorMesh(subs, lut, tol, Date.now() - t0p);
    merged.parts = assemblePartMeshList(subs, lut);
    return merged;
  }

  // Per-part colouring applies to the UNCUT full solid only. The CUT arm keeps
  // its colorOuter/colorInner half-section behaviour (#997) — untouched.
  const lut = (opts.partColors && opts.partColors.active && !opts.cut) ? opts.partColors : undefined;

  const t0 = Date.now();
  try {
    const mark = tracked.length;
    if (lut) {
      // Splice `__tag(instance, partHashId(name))` into the source — the SAME
      // rewrite the Manifold loader uses — so each top-level instance's OCCT
      // solid arrives tagged. Then mesh each separately + colour by the LUT.
      let taggedSource = source;
      try {
        const { tagInstanceSources } = await import('$lib/server/primitive-loader');
        taggedSource = tagInstanceSources(source);
      } catch { taggedSource = source; }
      const subSolids = runBodyRaw(taggedSource, paramValues);
      if (subSolids.length === 0) return null;
      // Keep the N per-part solids; free every intermediate the build produced.
      sweepSince(mark, subSolids);
      return meshBrepParts(subSolids, lut, t0);
    }
    const solid = runBody(source, paramValues);
    if (!solid) return null;
    // Free the top-level build's dead intermediates (the pre-mv per-part solids)
    // before the final tessellation, so meshing the composed compound has the
    // whole heap to itself. `solid` is the only survivor kept.
    const kept: any[] = []; collectShapes(solid, kept);
    sweepSince(mark, kept);
    // The SVG boundary projector wants the exact analytic solid, not a triangle
    // set — hand back the RAW composed OCCT solid (skip tessellation entirely).
    // It is the SAME solid meshBrepSolid would otherwise tessellate; the caller
    // projects it and is responsible for freeing it (brepSolidToSvg reads
    // .faces/.edges/.boundingBox, so it must outlive this call).
    if (mode === 'solid') return solid;
    return meshBrepSolid(solid, opts, t0);
  } catch (e: any) {
    const raw = e?.message ?? e;
    // An emscripten/OCCT throw is a BARE NUMBER (a heap pointer) — a strong sign
    // the OCCT WASM heap is corrupted. Reset the singleton so the NEXT bake (and
    // the endpoint's uncut retry) re-inits a fresh instance and self-heals,
    // instead of every later BREP bake failing until a manual server restart.
    // Normal Errors (bad input, "no function body") don't reset.
    if (typeof e === 'number' || typeof e === 'bigint' || /^\s*\d+\s*$/.test(String(raw))) resetOC();
    throw new Error('BREP build failed: ' + raw);
  }
}

/**
 * Full graph→OCCT executor → adaptively-tessellated BrepMesh (the mesh
 * `/api/brep/preview` ships). Thin wrapper over the shared `executeBrep` core.
 */
export async function brepFromSource(
  source: string,
  paramValues: Record<string, number> = {},
  opts: MeshOpts = {},
  fetchFn?: typeof fetch,
): Promise<BrepMesh | null> {
  return (await executeBrep(source, paramValues, opts, fetchFn, 'mesh')) as BrepMesh | null;
}

/**
 * Same executor + dependency resolution as `brepFromSource`, but returns the
 * RAW composed OCCT solid (a replicad Shape with `.faces`/`.edges`/`.boundingBox`)
 * instead of a tessellated mesh — the input `brepSolidToSvg` projects to an SVG
 * boundary. Used by `/api/brep/svg` so the SVG endpoint resolves + executes a
 * part EXACTLY the way the preview endpoint does, then draws the boundary rather
 * than meshing it. Returns null when the part has no OCCT-buildable solid.
 *
 * The caller owns the returned solid's lifetime — call `solid.delete?.()` once
 * projected to free the WASM heap (the executor kept it alive past its own
 * intermediate sweep, so nothing else will).
 */
export async function solidFromSource(
  source: string,
  paramValues: Record<string, number> = {},
  opts: MeshOpts = {},
  fetchFn?: typeof fetch,
): Promise<any | null> {
  return executeBrep(source, paramValues, opts, fetchFn, 'solid');
}

/** Resolve a part/engine source by name. stdlib (local, canonical) first; then
 *  the /api/primitives/source endpoint via the request's fetch — that path is
 *  PROXIED to prod in dev (the local .dev-volume is stale), so it's the only
 *  resolver that sees the real volume parts. Falls back to a local file read. */
async function getDepSource(name: string, fetchFn?: typeof fetch): Promise<string | null> {
  try {
    const { stdlibSource } = await import('$lib/server/stdlib');
    const std = stdlibSource(name);
    if (std) return std;
    if (fetchFn) {
      // Retry once — the source endpoint is proxied to prod and can transiently
      // fail/throttle under concurrent load (e.g. while a batch job hammers it),
      // which otherwise surfaces as "<dep> is not defined" for a transitive dep.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetchFn(`/api/primitives/source?name=${encodeURIComponent(name)}`);
          if (r.ok) { const d = await r.json(); if (d?.source) return d.source as string; }
        } catch { /* transient — retry */ }
        if (attempt === 0) await new Promise((res) => setTimeout(res, 150));
      }
    }
    const { findPrim } = await import('$lib/server/primitive-paths');
    const hit = await findPrim(name);
    if (hit) {
      const { readFile } = await import('node:fs/promises');
      return await readFile(hit.path, 'utf8');
    }
  } catch { /* unresolved */ }
  return null;
}

/**
 * Revolve a closed (r,z) half-section 360° around the z-axis via OCCT and
 * tessellate to `tolerance`. `profile` is [[r,z], …] with r ≥ 0 — the same
 * shape r_revolve consumes. Returns an indexed mesh with OCCT's exact-surface
 * normals (smooth shading for free).
 */
export async function revolveBrep(
  profile: [number, number][],
  opts: MeshOpts = {},
): Promise<BrepMesh> {
  await ensureOC();
  const replicad = await import('replicad');
  const { draw } = replicad as any;

  const t0 = Date.now();
  // Draw the half-section in the XZ plane (x = radial, z = axial), revolve
  // around Z. Drawing API: draw(start).lineTo(...).close().
  let d = draw([profile[0][0], profile[0][1]]);
  for (let i = 1; i < profile.length; i++) d = d.lineTo([profile[i][0], profile[i][1]]);
  const sketch = d.close().sketchOnPlane('XZ');
  const solid = sketch.revolve(); // default axis = Z through origin
  return meshBrepSolid(solid, opts, t0);
}
