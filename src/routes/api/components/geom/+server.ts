/**
 * POST /api/components/geom
 *
 * Server-side geometry render for a component. The client sends
 * `{ id, params, zScale? }`; the server runs the component's `geom()`
 * through ManifoldCAD WASM (which already runs in Node — see
 * `manifold-bake.ts`), finalizes it to the `{ full, cutVC }` THREE
 * geometry pair, serializes that to plain mesh-JSON and returns it. The
 * client rehydrates via `deserializeComponentResult` into the exact shape
 * `ComponentScene.svelte` consumes.
 *
 * Why server-side: a volume-resident component's `.ts` lives on the
 * Railway volume, NOT in `src/lib/cad/components/`, so Vite's build-time
 * `import.meta.glob` never compiles it — the client can't execute its
 * geom. The server loads + transpiles + runs it instead (see
 * `component-loader.ts`). Bundled primitives still render client-side
 * (instant, no round-trip); this endpoint is the volume path.
 *
 * Dispatch:
 *   - bundle id  → `geomById()` (fast path; also lets curl exercise the
 *     endpoint without a library part)
 *   - library id → `loadVolumeComponent()` — read + transpile + execute
 *     the part's `component.ts` (see `library.ts` / `component-loader.ts`)
 *
 * NOT proxied — like every other `/api/components/*` endpoint. A library
 * part is rendered from the LOCAL library (`<volume>/library/<cat>/<id>/`);
 * the whole `/api/components/*` family is dev-local so save / list / geom
 * all agree on the same store. (The earlier server-render plan had this
 * proxy; the directory-per-part model made save dev-local, so geom must
 * be too — otherwise save writes local and geom reads prod.)
 *
 * Concurrency: `M`, the circular-segment mode and the render Z-scale are
 * process-wide mutable globals in the manifold helpers / builder. A
 * promise-chain mutex serializes the WASM section so concurrent requests
 * with different params/zScale can't cross-contaminate.
 *
 * Caching: an LRU result cache (in `component-loader.ts`, capped 200) is
 * keyed by `<id>|<paramsJson>|<zScale>` — a repeated build is a cache
 * hit (surfaced via the `x-cache` response header). A save invalidates
 * the component's entries.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkVolumeAuth } from '$lib/server/volume';
import { initManifold } from '$lib/cad/manifold-helpers';
import { geomById, metaById, resolveDerived } from '$lib/cad/components';
import { finalizeManifold, setRenderZScale, getRenderZScale } from '$lib/cad/builder';
import {
  loadVolumeComponent,
  loadGeomFromSource,
  getGeomResult,
  setGeomResult,
} from '$lib/server/component-loader';
import { serializeComponentResult } from '$lib/cad/mesh-serial';
import type { PrimitiveMeta } from '$lib/cad/components';

/** Stable JSON of a params bag — keys sorted so the cache key is
 *  insensitive to property order in the request body. */
function stableParamsJson(params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  const obj: Record<string, number> = {};
  for (const k of keys) obj[k] = params[k];
  return JSON.stringify(obj);
}

function maxODOf(params: Record<string, number>): number {
  return Math.max(
    params.od || 0,
    params.odTop || 0,
    params.odBottom || 0,
    params.odLarge || 0,
    params.slipOD || 0,
    params.odCompressed || 0,
    params.boxOD || 0,
    params.toolJointOD || 0,
    3,
  );
}

// ── WASM-section mutex ───────────────────────────────────────────────────────
// `M` / circular-segment mode / render Z-scale are process-wide mutable
// globals. Serialize every build through one promise chain so two requests
// with different zScale/params can't interleave inside the WASM section.
let mutex: Promise<unknown> = Promise.resolve();
function withMutex<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = mutex.then(fn, fn);
  // Keep the chain alive even if `fn` rejects.
  mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const POST: RequestHandler = async ({ request, url }) => {
  // NOT proxied — renders from the LOCAL library, like all /api/components/*.
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, params, zScale, source } = body as {
    id?: unknown;
    params?: unknown;
    zScale?: unknown;
    source?: unknown;
  };
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid or missing component id "${String(id)}"`);
  }
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    throw error(400, 'Missing params object');
  }
  const paramBag = params as Record<string, number>;
  const z = typeof zScale === 'number' && isFinite(zScale) && zScale > 0 ? zScale : 1;
  const inlineSource = typeof source === 'string' && source.trim().length > 0 ? source : null;

  // When the client sends an inline `source` (the in-flight `sourceDraft`
  // from the GUI's Apply button), bypass the disk-load + LRU cache and
  // transpile/execute the supplied source instead. Lets the user preview
  // edits without persisting to disk; mirrors the same sandbox as the
  // volume-loader path.
  const cacheKey = `${id}|${stableParamsJson(paramBag)}|${z}`;
  if (!inlineSource) {
    const cached = getGeomResult(cacheKey);
    if (cached !== undefined) {
      return json(cached, { headers: { 'x-cache': 'hit' } });
    }
  }

  await initManifold();

  // Resolve the component — bundle fast path, else volume loader.
  let meta: PrimitiveMeta | undefined;
  let geom: ((p: Record<string, number>) => any) | undefined;
  if (inlineSource) {
    try {
      // Inline-source path: same sandbox as loadVolumeComponent. Sibling
      // dep resolution falls back to the volume loader for any
      // `./<id>` import — the in-flight source can still reference
      // other library parts.
      const loaded = loadGeomFromSource(inlineSource, (depId) => {
        // Resolve sibling deps via the volume loader synchronously when
        // already cached; otherwise the request fails with a clear
        // message rather than hanging.
        throw new Error(
          `Inline preview can't resolve sibling dep "${depId}" yet — save the component first or remove the cross-import.`,
        );
      });
      meta = loaded.meta;
      geom = loaded.geom;
    } catch (e: any) {
      throw error(400, `Inline preview failed for "${id}": ${e?.message ?? e}`);
    }
  } else {
    const bundleGeom = geomById(id);
    if (bundleGeom) {
      meta = metaById(id);
      geom = bundleGeom;
    } else {
      try {
        const loaded = await loadVolumeComponent(id);
        meta = loaded.meta;
        geom = loaded.geom;
      } catch (e: any) {
        throw error(400, `Could not load component "${id}": ${e?.message ?? e}`);
      }
    }
  }
  if (!geom) throw error(404, `Component "${id}" has no geom.`);

  // Validation runs server-side (validate() can't cross HTTP). Surface
  // errors in the response without aborting the render — the client shows
  // them alongside whatever geometry came out.
  const resolved = meta ? resolveDerived(meta, paramBag) : paramBag;
  const validationErrors: string[] =
    meta?.validate ? (meta.validate(resolved) ?? []) : [];

  let serialized;
  try {
    serialized = await withMutex(() => {
      const prevZ = getRenderZScale();
      setRenderZScale(z);
      try {
        const manifold = geom!(resolved);
        if (!manifold || typeof manifold.getMesh !== 'function') {
          throw new Error('geom() did not return a Manifold instance');
        }
        const result = finalizeManifold(manifold, maxODOf(resolved));
        return serializeComponentResult(result);
      } finally {
        setRenderZScale(prevZ);
      }
    });
  } catch (e: any) {
    throw error(500, `geom build failed for "${id}": ${e?.message ?? e}`);
  }

  const payload = { id, full: serialized.full, cutVC: serialized.cutVC, validationErrors };
  if (!inlineSource) setGeomResult(cacheKey, payload);
  return json(payload, {
    headers: { 'x-cache': inlineSource ? 'preview' : 'miss' },
  });
};
