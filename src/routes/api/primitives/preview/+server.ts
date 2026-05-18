import { json, error } from '@sveltejs/kit';
import { transformSync } from 'esbuild';
import * as helpers from '$lib/cad/manifold-helpers';
import { CIRCULAR_SEGMENTS_DEFAULT } from '$lib/cad/manifold-helpers';
import { finalizeManifold, setRenderZScale } from '$lib/cad/builder';
import { serializeComponentResult } from '$lib/cad/mesh-serial';

// POST /api/primitives/preview
//   { source: string, name: string, params: number[], zScale?: number }
// Sandbox-executes the source, calls the named function with positional
// `params`, wraps the resulting Manifold via finalizeManifold, and
// returns the serialized mesh JSON for the client to rehydrate via
// mesh-serial.deserializeComponentResult.
//
// Sandbox layers:
//   1. parseImports allowlist — only `'../manifold-helpers'` named imports.
//   2. Denylist scan — `require(`, `process`, `eval(`, `Function(`, etc.
//   3. esbuild transform TS → JS (ESM).
//   4. new Function with ONLY the manifold helpers in scope. No `require`,
//      no module loader, no DOM access from inside the function body.
//
// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.

// Loosened sandbox for the primitives editor — the user IS the author
// (single-user dev tool), so we trust the source. We still strip
// imports (so the new Function evaluator doesn't see TS import syntax)
// but no denylist / allowlist beyond that. If cadtrain becomes
// multi-tenant, tighten this back up.
const IMPORT_RE = /import\s+(?:type\s+)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;

function stripImports(src: string): string {
  let stripped = src;
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    stripped = stripped.replace(m[0], '');
  }
  return stripped;
}

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { source, name, params, zScale } = body ?? {};
  if (typeof source !== 'string') throw error(400, 'source required');
  if (typeof name !== 'string') throw error(400, 'name required (the function to call)');
  const args: number[] = Array.isArray(params) ? params.map((p) => Number(p)) : [];

  const stripped = stripImports(source);

  let js: string;
  try {
    const out = transformSync(stripped, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2022',
    });
    js = out.code;
  } catch (e: any) {
    throw error(400, `esbuild transform failed: ${e?.message ?? e}`);
  }

  // Wrap the CJS output so it exports the named function back to us.
  // Two preamble injections needed for bundle-source primitives:
  //   - `currentSegments` is a let in manifold-helpers.ts (module-local,
  //     not exported). Bundle helpers like `cyl` close over it. We
  //     re-bind it to the default at sandbox time.
  //   - `G` is `globalThis as any` — used by primitives that pull
  //     `wasm.CrossSection` from the shared singleton. We pass
  //     globalThis through as `G` so those references resolve.
  const wrapper = `
    "use strict";
    const module = { exports: {} };
    const exports = module.exports;
    const currentSegments = CIRCULAR_SEGMENTS_DEFAULT;
    ${js}
    return module.exports[${JSON.stringify(name)}];
  `;
  await helpers.initManifold();
  if (typeof zScale === 'number' && zScale > 0) setRenderZScale(zScale);
  let primFn: any;
  try {
    const factory = new Function(
      'M', 'cyl', 'tube', 'mv', 'rot', 'CIRCULAR_SEGMENTS_DEFAULT', 'CIRCULAR_SEGMENTS_COMPOSE',
      'initManifold', 'setCircularSegmentMode', 'getCutBox', 'empty',
      'helix_band', 'revolve', 'profile_extrude', 'G', 'Math',
      wrapper,
    );
    primFn = factory(
      helpers.M, helpers.cyl, helpers.tube, helpers.mv, helpers.rot,
      helpers.CIRCULAR_SEGMENTS_DEFAULT, helpers.CIRCULAR_SEGMENTS_COMPOSE,
      helpers.initManifold, helpers.setCircularSegmentMode, helpers.getCutBox, helpers.empty,
      helpers.helix_band, helpers.revolve, helpers.profile_extrude,
      globalThis, Math,
    );
  } catch (e: any) {
    throw error(400, `factory build failed: ${e?.message ?? e}`);
  }
  if (typeof primFn !== 'function') {
    throw error(400, `source did not export a function named "${name}"`);
  }

  let manifold: any;
  try { manifold = primFn(...args); }
  catch (e: any) { throw error(400, `primitive call failed: ${e?.message ?? e}`); }

  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw error(400, 'primitive did not return a Manifold');
  }
  const result = finalizeManifold(manifold, args[0] && args[0] > 0 ? args[0] * 1.5 : 6);
  const serialized = serializeComponentResult(result);
  return json({ ok: true, full: serialized.full, cutVC: serialized.cutVC });
};
