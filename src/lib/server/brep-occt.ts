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
  const {
    draw, makeBaseBox, makeCompound, drawPolysides,
    assembleWire, makeLine, genericSweep,
  } = replicad;

  const m = source.match(/export\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (!m) return null;
  const fnBody = m[1];

  // ── wrapped OCCT solid: Manifold-method names → replicad methods ──────────
  const WRAP = Symbol('occt');
  const unwrap = (v: any) => (v && v[WRAP]) ? v[WRAP] : v;
  function wrap(shape: any): any {
    if (!shape || typeof shape !== 'object') return shape;
    const proxy: any = new Proxy(shape, {
      get(t, prop) {
        if (prop === WRAP) return t;
        if (prop === 'add' || prop === 'union') return (o: any) => wrap(t.fuse(unwrap(o)));
        if (prop === 'subtract') return (o: any) => wrap(t.cut(unwrap(o)));
        if (prop === 'intersect') return (o: any) => wrap(t.intersect(unwrap(o)));
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

  // Build a closed replicad drawing from a 2D point list, sketch on a plane.
  const sketchPoly = (pts: [number, number][], plane: 'XZ' | 'XY') => {
    if (!Array.isArray(pts) || pts.length < 3) throw new Error('profile < 3 pts');
    let d = draw([pts[0][0], pts[0][1]]);
    for (let i = 1; i < pts.length; i++) d = d.lineTo([pts[i][0], pts[i][1]]);
    return d.close().sketchOnPlane(plane);
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
  const extrudeXY = (profile: any, length: number, twist = 0) => {
    const prof = asPts(profile);
    const sk = sketchPoly(prof, 'XY');
    const h = Math.max(0.01, length);
    return wrap(twist ? sk.extrude(h, { twistAngle: twist }) : sk.extrude(h));
  };
  const r_weld_extrude = (a: any, length?: number, _divs?: number, twist?: number) => {
    if (a && a.profile !== undefined) return extrudeXY(a.profile, a.length, a.twist ?? 0);
    return extrudeXY(a, length ?? 2, twist ?? 0);
  };
  const r_extrude = (a: any, height?: number, twist?: number) => {
    if (a && a.profile !== undefined) return extrudeXY(a.profile, a.height ?? a.length, a.twist ?? 0);
    return extrudeXY(a, height ?? 2, twist ?? 0);
  };
  const r_loft = (a: any, length?: number, _divs?: number, twist?: number, bulge?: number) => {
    // Approximate the scale-along-z bulge with replicad's extrusionProfile.
    const prof = asPts(Array.isArray(a) ? a : a.profile);
    const L = (a && a.length !== undefined) ? a.length : (length ?? 6);
    const tw = (a && a.twist !== undefined) ? a.twist : (twist ?? 0);
    const bl = (a && a.bulge !== undefined) ? a.bulge : (bulge ?? 0);
    const sk = sketchPoly(prof, 'XY');
    const ep = bl ? { profile: 's-curve' as const, endFactor: 1 + bl } : undefined;
    return wrap(sk.extrude(Math.max(0.01, L), { twistAngle: tw || 0, ...(ep ? { extrusionProfile: ep } : {}) }));
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
  const place = (...args: any[]) => { const last = args[args.length - 1]; return last; };
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
    'p', 'sketch', 'r_revolve', 'r_weld_extrude', 'r_loft', 'r_extrude', 'r_cuboid', 'r_sweep', 'resampleSpline',
    'mv', 'rot', 'place', 'withStackRef', 'stack', 'list', 'group', 'cos', 'sin', 'tan', 'tau', 'PI',
    'sqrt', 'abs', 'min', 'max', 'pow', 'floor', 'round',
  ];
  const baseVals = (p: any) => [
    p, sketch, r_revolve, r_weld_extrude, r_loft, r_extrude, r_cuboid, r_sweep, resampleSpline,
    mv, rot, place, withStackRef, stackOcct, compoundOf, compoundOf, Math.cos, Math.sin, Math.tan, 2 * Math.PI, Math.PI,
    Math.sqrt, Math.abs, Math.min, Math.max, Math.pow, Math.floor, Math.round,
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
      const s = runBody(depSrc[nm], merged ?? {});
      return s ? wrap(s) : s;
    };
  }

  const t0 = Date.now();
  try {
    const solid = runBody(source, paramValues);
    if (!solid) return null;
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
