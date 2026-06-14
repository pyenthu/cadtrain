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
  index: number[];
  normals?: number[];
  meta: { tris: number; verts: number; ms: number; tolerance: number };
}

/**
 * Revolve a closed (r,z) half-section 360° around the z-axis via OCCT and
 * tessellate to `tolerance`. `profile` is [[r,z], …] with r ≥ 0 — the same
 * shape r_revolve consumes. Returns an indexed mesh with OCCT's exact-surface
 * normals (smooth shading for free).
 */
export async function revolveBrep(
  profile: [number, number][],
  opts: { tolerance?: number; angularTolerance?: number } = {},
): Promise<BrepMesh> {
  await ensureOC();
  const replicad = await import('replicad');
  const { draw } = replicad as any;
  const tol = opts.tolerance ?? 0.05;
  const ang = opts.angularTolerance ?? 0.3;

  const t0 = Date.now();
  // Draw the half-section in the XZ plane (x = radial, z = axial), revolve
  // around Z. Drawing API: draw(start).lineTo(...).close().
  let d = draw([profile[0][0], profile[0][1]]);
  for (let i = 1; i < profile.length; i++) d = d.lineTo([profile[i][0], profile[i][1]]);
  const sketch = d.close().sketchOnPlane('XZ');
  const solid = sketch.revolve(); // default axis = Z through origin

  const meshed = solid.mesh({ tolerance: tol, angularTolerance: ang });
  const ms = Date.now() - t0;

  const positions: number[] = Array.from(meshed.vertices ?? []);
  const index: number[] = Array.from(meshed.triangles ?? []);
  const normals: number[] | undefined = meshed.normals ? Array.from(meshed.normals) : undefined;

  return {
    positions,
    index,
    normals,
    meta: { tris: index.length / 3, verts: positions.length / 3, ms, tolerance: tol },
  };
}
