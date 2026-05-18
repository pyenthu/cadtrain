import { json, error } from '@sveltejs/kit';
import { transformSync } from 'esbuild';
import * as helpers from '$lib/cad/manifold-helpers';
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

const HELPER_NAMES = new Set([
  'M', 'cyl', 'tube', 'mv', 'rot',
  'cube', 'cylinder', 'helix_band', 'revolve', 'profile_extrude',
  'CrossSection',
  'initManifold', 'setCircularSegmentMode', 'getCutBox', 'empty',
]);

const DENYLIST = ['require(', 'process', 'import(', 'eval(', 'Function(', 'child_process', '__dirname', '__filename', 'globalThis'];

const IMPORT_RE = /import\s+(?:type\s+)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;

function stripAndValidateImports(src: string): string {
  let stripped = src;
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const [whole, named, source] = m;
    if (source !== '../manifold-helpers') {
      throw new Error(`Disallowed import from "${source}" — primitives may only import from '../manifold-helpers'.`);
    }
    if (named) {
      for (const spec of named.split(',').map((s) => s.trim()).filter(Boolean)) {
        const name = spec.split(/\s+as\s+/)[0].trim();
        if (!HELPER_NAMES.has(name)) {
          throw new Error(`Disallowed import "${name}" — not in the primitive sandbox allowlist.`);
        }
      }
    }
    stripped = stripped.replace(whole, '');
  }
  for (const bad of DENYLIST) {
    if (stripped.includes(bad)) throw new Error(`Denylist token "${bad}" found in source.`);
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

  let stripped: string;
  try { stripped = stripAndValidateImports(source); }
  catch (e: any) { throw error(400, e?.message ?? String(e)); }

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
  // esbuild emits `module.exports = { foo: ... }`; we capture it via a
  // fake module object passed in scope, then return module.exports[name].
  const wrapper = `
    "use strict";
    const module = { exports: {} };
    const exports = module.exports;
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
      'helix_band', 'revolve', 'profile_extrude',
      wrapper,
    );
    primFn = factory(
      helpers.M, helpers.cyl, helpers.tube, helpers.mv, helpers.rot,
      helpers.CIRCULAR_SEGMENTS_DEFAULT, helpers.CIRCULAR_SEGMENTS_COMPOSE,
      helpers.initManifold, helpers.setCircularSegmentMode, helpers.getCutBox, helpers.empty,
      helpers.helix_band, helpers.revolve, helpers.profile_extrude,
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
