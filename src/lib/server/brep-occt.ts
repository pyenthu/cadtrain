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
import * as mathLib from '$lib/cad/math-lib';

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
async function ensureOC(): Promise<void> {
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
  const { compileSketch } = await import('$lib/cad/sketch');
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
}

export interface MeshOpts {
  tolerance?: number;
  angularTolerance?: number;
  cut?: boolean;        // half-section cutaway (remove the y<0 half)
}

/**
 * Tessellate an OCCT solid → BrepMesh, optionally with a HALF-SECTION CUTAWAY
 * coloured red (outer skin) / grey (bore + cut cross-section), mirroring the
 * Manifold cutVC convention (manifoldToCutVC). When cut, removes the y<0 half
 * with a box, then classifies each triangle red/grey by the SAME rule the
 * Manifold path uses (radial-inward normal = bore; on the y≈0 cut plane;
 * near-axis cap) and emits a NON-INDEXED coloured mesh. No cut → plain indexed
 * mesh + OCCT normals (the existing fast path).
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
    const r = isGrey ? 0.45 : 0.8, g = isGrey ? 0.45 : 0.06, bl = isGrey ? 0.45 : 0.06;
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
 * engines + booleans instead of Manifold, then tessellate. This covers CSG
 * parts (the body chains .add/.subtract/.intersect + mv/rot over multiple
 * engine solids), not just a single revolve.
 *
 * Strategy: build a scope where r_revolve/r_extrude/r_weld_extrude/r_loft/
 * r_cuboid return WRAPPED OCCT solids, and the wrapper maps the Manifold method
 * names the body calls onto replicad's: .add→.fuse · .subtract→.cut ·
 * .intersect→.intersect · mv→.translate · rot→.rotate. Anything unmappable
 * throws → the endpoint reports supported:false and the BREP tab shows
 * "no BREP path", so this never blocks the part.
 *
 * Returns null when no OCCT solid was produced (not a buildable BREP part).
 */
export async function brepFromSource(
  source: string,
  paramValues: Record<string, number> = {},
  opts: MeshOpts = {},
  fetchFn?: typeof fetch,
): Promise<BrepMesh | null> {
  await ensureOC();
  const replicad: any = await import('replicad');
  const { compileSketch } = await import('$lib/cad/sketch');
  const { resampleSpline } = await import('$lib/cad/spline-resample');
  const { splineSampler, spline3DFrames } = await import('$lib/cad/warp-spline');
  const { resolveProfile } = await import('$lib/shared/profile-presets');
  const {
    draw, makeBaseBox, makeCompound, drawPolysides,
    assembleWire, makeLine, genericSweep,
  } = replicad;

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
        if (prop === 'add' || prop === 'union') return (o: any) => wrap(combineBool(t, o, 'fuse'));
        if (prop === 'subtract') return (o: any) => wrap(combineBool(t, o, 'cut'));
        if (prop === 'intersect') return (o: any) => wrap(combineBool(t, o, 'intersect'));
        const val = (t as any)[prop];
        if (typeof val === 'function') return (...a: any[]) => {
          const r = val.apply(t, a.map(unwrap));
          return (r && typeof r === 'object' && typeof r.mesh === 'function') ? wrap(r) : r;
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
  const sweepOcct = (path: number[][], section2d: any[], closedPath: boolean) => {
    const pathPts = asPath(path);
    if (pathPts.length < 2) throw new Error('r_sweep: path needs ≥2 points');
    const sec = (typeof section2d === 'string' ? JSON.parse(section2d) : section2d)
      .map((s: any) => [Number(s[0]) || 0, Number(s[1]) || 0]);
    if (sec.length < 3) throw new Error('r_sweep: section needs ≥3 points');

    // Spine: a POLYLINE wire through the (already arc-length-resampled) path
    // points — NOT a BSpline approximation. makeBSplineApproximation over
    // near-cusp arc-length samples (a straight run into a sharp bend, e.g. the
    // sweep_tube_demo path) produces a curve that sends OCCT's
    // BRepOffsetAPI_MakePipeShell into a pathological / effectively-infinite
    // build (observed: >4 min at 99% CPU, never returns). A polyline spine
    // builds in ~1ms, sweeps in ~300ms, and is byte-for-byte the same path the
    // Manifold sweep rides — identical fidelity, no approximation risk.
    const spinePath = closedPath ? [...pathPts, pathPts[0]] : pathPts;
    const spineEdges: any[] = [];
    for (let i = 0; i < spinePath.length - 1; i++) spineEdges.push(makeLine(spinePath[i], spinePath[i + 1]));
    const spineWire = assembleWire(spineEdges);

    // Stable start frame ⟂ the start tangent (mirrors sweepFrames' seed).
    const t = V.norm(V.sub(pathPts[1], pathPts[0]));
    let up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const side = V.norm(V.cross(t, up));
    up = V.norm(V.cross(side, t));
    const P0 = pathPts[0];
    const pt3 = (a: number, b: number) => [
      P0[0] + side[0] * a + up[0] * b,
      P0[1] + side[1] * a + up[1] * b,
      P0[2] + side[2] * a + up[2] * b,
    ];
    // Closed polyline profile wire in that plane (faceted, like the Manifold wall).
    const edges: any[] = [];
    for (let i = 0; i < sec.length; i++) {
      const a = pt3(sec[i][0], sec[i][1]);
      const b = pt3(sec[(i + 1) % sec.length][0], sec[(i + 1) % sec.length][1]);
      edges.push(makeLine(a, b));
    }
    const profileWire = assembleWire(edges);
    return wrap(genericSweep(profileWire, spineWire, { forceProfileSpineOthogonality: true }));
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
  const yRangeOf = (cp: number[][]): number => {
    let a = Infinity, b = -Infinity;
    for (const p of cp) { const y = Number(p[1]) || 0; if (y < a) a = y; if (y > b) b = y; }
    return b - a;
  };
  // Sampler over the (already arc-length-resampled) survey path — the SAME planar
  // world-Y / 3D-RMF split warpManifoldAlongSpline uses, so BREP + Manifold agree
  // on which way the section faces + how far along it sits.
  const makeWarpSampler = (path: number[][]) => {
    const is3D = yRangeOf(path) > 1e-6;
    const fr = is3D ? spline3DFrames(path as any) : null;
    const sp = is3D ? null : splineSampler(path.map((p) => [p[0], p[2]]) as any);
    const total = fr ? fr.total : sp!.total;
    const at = (s: number): { pos: number[]; N: number[]; B: number[] } => {
      if (fr) { const r = fr.at(s); return { pos: r.pos as number[], N: r.N as number[], B: r.B as number[] }; }
      const r = sp!.sampleAt(s); const t = r.tan as number[]; const nl = Math.hypot(t[2], t[0]) || 1;
      return { pos: r.pos as number[], N: [t[2] / nl, 0, -t[0] / nl], B: [0, 1, 0] };
    };
    return { total, at };
  };
  // Extract the start-cap cross-section of a straight prism as 2D loops (outer +
  // inner bores). Densely samples each cap wire via pointAt, then collapses
  // collinear runs back to the polygon vertices → a lean faceted section.
  // NOTE Face.outerWire() DELETES the face handle, so clone the face BEFORE
  // reading its inner wires (else "This object has been deleted").
  const extractCapSection = (u: any): { outer: [number, number][]; inner: [number, number][][]; z0: number; z1: number } | null => {
    let bb: any; try { bb = u.boundingBox.bounds; } catch { return null; }
    const z0 = bb[0][2], z1 = bb[1][2];
    let cap: any = null, best = Infinity;
    for (const f of u.faces) {
      let nz = 0; try { nz = f.normalAt().z; } catch { continue; }
      if (Math.abs(nz) < 0.99) continue;           // cap normal must be ∥ Z
      let cz = 0; try { cz = f.center.z; } catch { continue; }
      if (cz < best) { best = cz; cap = f; }        // top cap = min-z (Z-down)
    }
    if (!cap) return null;
    const sampleLoop = (w: any): [number, number][] => {
      let nEdge = 4; try { nEdge = w.edges.length; } catch { /* keep default */ }
      const N = Math.max(48, nEdge * 6);
      const raw: [number, number][] = [];
      for (let i = 0; i < N; i++) { const v = w.pointAt(i / N); raw.push([v.x, v.y]); }
      const dq: [number, number][] = [];
      for (const p of raw) { const q = dq[dq.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) dq.push(p); }
      const co: [number, number][] = [];
      for (let i = 0; i < dq.length; i++) {
        const a = dq[(i - 1 + dq.length) % dq.length], b = dq[i], c = dq[(i + 1) % dq.length];
        if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-4) co.push(b);
      }
      return co.length >= 3 ? co : dq;
    };
    let outer: [number, number][]; const inner: [number, number][][] = [];
    try {
      const capC = cap.clone();
      outer = sampleLoop(cap.outerWire());            // consumes `cap`
      try { for (const iw of capC.innerWires()) inner.push(sampleLoop(iw)); } catch { /* no bores */ }
    } catch { return null; }
    if (outer.length < 3) return null;
    return { outer, inner, z0, z1 };
  };
  const warpSpline = (solidArg: any, path: any, opts?: any): any => {
    const u = unwrap(solidArg);
    if (!u || typeof u.mesh !== 'function' || !Array.isArray(path) || path.length < 2) return solidArg;
    const sec = extractCapSection(u);
    if (!sec) return solidArg;                        // no section to sweep → leave straight
    const S = makeWarpSampler(path.map((q: any) => [Number(q[0]) || 0, Number(q[1]) || 0, Number(q[2]) || 0]));
    const zBase = (opts && opts.originZ !== undefined) ? Number(opts.originZ) : sec.z0;
    const sStart = sec.z0 - zBase, sEnd = sec.z1 - zBase;
    if (!(sEnd > sStart)) return solidArg;
    // Spine sample count ≈ input path resolution over the covered arc (refine bumps
    // it modestly). The polyline spine rides the SAME resampled points the Manifold
    // warp bends along — identical fidelity, no BSpline-approximation risk (the
    // documented MakePipeShell pathology).
    const refine = Math.max(1, Math.min(8, Math.floor(opts?.refine ?? 1)));
    const step = S.total / Math.max(1, path.length - 1);
    const nSpine = Math.max(6, Math.min(200, Math.round(((sEnd - sStart) / step) * (refine > 1 ? 1.5 : 1))));
    const spinePts: number[][] = [];
    for (let i = 0; i <= nSpine; i++) spinePts.push(S.at(sStart + (sEnd - sStart) * (i / nSpine)).pos);
    const f0 = S.at(sStart); const P0 = f0.pos, Nf = f0.N, Bf = f0.B;
    const p3 = (a: number, b: number) => [
      P0[0] + Nf[0] * a + Bf[0] * b, P0[1] + Nf[1] * a + Bf[1] * b, P0[2] + Nf[2] * a + Bf[2] * b,
    ];
    // Plant a 2D loop in the start frame at pos(sStart) and pipe it along the spine.
    const sweepLoop = (loop: [number, number][]) => {
      const se: any[] = [];
      for (let i = 0; i < spinePts.length - 1; i++) se.push(makeLine(spinePts[i], spinePts[i + 1]));
      const spineWire = assembleWire(se);
      const ed: any[] = [];
      for (let i = 0; i < loop.length; i++) {
        ed.push(makeLine(p3(loop[i][0], loop[i][1]), p3(loop[(i + 1) % loop.length][0], loop[(i + 1) % loop.length][1])));
      }
      return genericSweep(assembleWire(ed), spineWire, { forceProfileSpineOthogonality: true });
    };
    try {
      let result = sweepLoop(sec.outer);
      // Bores: sweep each inner loop + subtract on the CURVED solid. The exact OCCT
      // kernel subtracts coaxial curved sweeps cleanly (unlike the Manifold mesh
      // boolean's coincident-tilted-cap slivers — memory r_sweep_normals_and_twist).
      for (const inn of sec.inner) result = result.cut(sweepLoop(inn));
      return wrap(result);
    } catch {
      return solidArg;                                // sweep failed → straight fallback, never poison
    }
  };

  // transforms — replicad/OCCT transforms DELETE their input shape's handle
  // after producing the moved copy (replicad Shape.translate/rotate call
  // this.delete()). A `repeat` that reuses ONE shape across N transforms
  // (e.g. casing_schematic: Array.from(N, i => mv(B, [0,0,200*i]))) frees B on
  // the first call and then uses a deleted handle → "This object has been
  // deleted" (#19). clone() FIRST (non-destructive) so the source survives for
  // the next iteration — same defensive pattern as compoundOf/stackOcct below.
  const mv = (s: any, v: number[]) => wrap(unwrap(s).clone().translate([v[0] || 0, v[1] || 0, v[2] || 0]));
  const rot = (s: any, v: number[]) => {
    let sh = unwrap(s).clone();
    if (v[0]) sh = sh.rotate(v[0], [0, 0, 0], [1, 0, 0]);
    if (v[1]) sh = sh.rotate(v[1], [0, 0, 0], [0, 1, 0]);
    if (v[2]) sh = sh.rotate(v[2], [0, 0, 0], [0, 0, 1]);
    return wrap(sh);
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
    return wrap(cutRes);
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
    ...MATH_NAMES,
  ];
  const baseVals = (p: any) => [
    p, sketch, r_revolve, r_weld_extrude, r_loft, r_extrude, r_cuboid, r_sweep,
    resampleSpline, resolveProfile, sectionCut, warpSpline,
    mv, rot, place, withStackRef, stackOcct, compoundOf, compoundOf,
    ...MATH_VALUES,
  ];
  function bodyOf(src: string): string | null {
    const mm = src.match(/export\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
    return mm ? mm[1] : null;
  }
  function runBody(src: string, pv: any): any {
    const b = bodyOf(src);
    if (!b) throw new Error('no function body');
    const depNames = Object.keys(depFns);
    const runner = new Function(...NAMES, ...depNames, 'return (function(){' + b + '})();');
    const out = runner(...baseVals(pv), ...depNames.map((n) => depFns[n]));
    const arr: any[] = []; collectShapes(out, arr);
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

  const t0 = Date.now();
  try {
    const mark = tracked.length;
    const solid = runBody(source, paramValues);
    if (!solid) return null;
    // Free the top-level build's dead intermediates (the pre-mv per-part solids)
    // before the final tessellation, so meshing the composed compound has the
    // whole heap to itself. `solid` is the only survivor kept.
    const kept: any[] = []; collectShapes(solid, kept);
    sweepSince(mark, kept);
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
