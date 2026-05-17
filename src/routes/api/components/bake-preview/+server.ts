/**
 * POST /api/components/bake-preview
 *
 * Live-bake a GLB from an in-flight source + params, return the bytes
 * directly without writing to disk. The /primitives GLB stage tab uses
 * this when the user has unsaved sourceDraft or dirty params so the
 * GLB view tracks edits the same way the Mesh view does (via
 * /api/components/geom). When the part is clean, the client falls
 * back to the static /api/components/glb endpoint that streams the
 * last-baked file from the part directory.
 *
 * Body:
 *   {
 *     id:                string,                  // library part id
 *     params:            Record<string, number>,  // slider values
 *     source?:           string,                  // sourceDraft; if omitted, read from disk
 *     cut?:              boolean,                 // true → return the half-sectioned variant
 *     instanceTopMode?:  Record<string, 'stack'|'overlay'|'origin'>,
 *     instanceTopOffset?: Record<string, number>,
 *   }
 *
 * Response: 200 with `model/gltf-binary` body (the GLB bytes). 4xx on
 * validation errors; 500 with text on bake failure. NOT proxied —
 * library parts are dev-local.
 *
 * Concurrency: shares the same single-promise mutex pattern as
 * /api/components/geom because `M` + circular-segment mode + render
 * Z-scale are process-wide globals.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkVolumeAuth } from '$lib/server/volume';
import { initManifold } from '$lib/cad/manifold-helpers';
import { geomById, metaById, resolveDerived } from '$lib/cad/components';
import { setRenderZScale, getRenderZScale } from '$lib/cad/builder';
import {
  loadVolumeComponent,
  loadGeomFromSource,
  parseImports,
  type LoadedComponent,
} from '$lib/server/component-loader';
import { buildGlbBytes } from '$lib/server/manifold-bake';
import type { PrimitiveMeta } from '$lib/cad/components';

// Single-promise mutex — same shape as /api/components/geom. Sharing
// the WASM section across endpoints would require coordinating both
// mutex chains, so for now each endpoint has its own (acceptable —
// concurrent live-bake from two tabs is the only contention vector
// and the geom endpoint's serialised passes mean Manifold globals
// stay sane between them in practice).
let mutex: Promise<unknown> = Promise.resolve();
function withMutex<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

export const POST: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');

  const { id, params, source, cut, instanceTopMode, instanceTopOffset } = body as {
    id?: unknown;
    params?: unknown;
    source?: unknown;
    cut?: unknown;
    instanceTopMode?: unknown;
    instanceTopOffset?: unknown;
  };

  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid or missing component id "${String(id)}"`);
  }
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    throw error(400, 'Missing params object');
  }
  const paramBag = params as Record<string, number>;
  const wantCut = cut === true;
  const inlineSource = typeof source === 'string' && source.trim().length > 0 ? source : null;
  const modes = isStringRecord<'stack' | 'overlay' | 'origin'>(instanceTopMode, ['stack', 'overlay', 'origin']);
  const offsets = isNumberRecord(instanceTopOffset);

  await initManifold();

  // Resolve meta + geom. When the caller supplied a source we
  // transpile that directly (mirrors the geom endpoint's inline
  // path); otherwise we read the saved source via loadVolumeComponent.
  let meta: PrimitiveMeta | undefined;
  let geom: ((p: Record<string, number>) => any) | undefined;
  if (inlineSource) {
    try {
      const { deps: inlineDeps } = parseImports(inlineSource);
      const inlineResolved = new Map<string, LoadedComponent>();
      for (const { depId } of inlineDeps) {
        if (inlineResolved.has(depId)) continue;
        const bundledGeom = geomById(depId);
        if (bundledGeom) {
          const bundledMeta = metaById(depId);
          if (!bundledMeta) {
            throw new Error(`Bundled dep "${depId}" has a geom but no meta.`);
          }
          inlineResolved.set(depId, { meta: bundledMeta, geom: bundledGeom });
        } else {
          inlineResolved.set(depId, await loadVolumeComponent(depId));
        }
      }
      // Post-grammar-split: the .ts source carries no `export const
      // meta`, only a geom function. When previewing the inline source
      // for a part that exists on disk, pull the part's meta from its
      // meta.json so the loader's `defineGeom(meta, fn)` resolves and
      // the returned meta has the schema the renderer needs.
      let injected: PrimitiveMeta | undefined;
      try {
        const { resolvePart } = await import('$lib/server/library');
        const part = await resolvePart(id);
        if (part?.meta.id && part.meta.name && part.meta.params) {
          injected = {
            id: part.meta.id,
            name: part.meta.name,
            description: part.meta.description,
            tags: part.meta.tags,
            params: part.meta.params as Record<string, any>,
          };
        }
      } catch { /* part may not exist yet (new-part draft) — that's OK */ }
      const loaded = loadGeomFromSource(
        inlineSource,
        (depId) => {
          const dep = inlineResolved.get(depId);
          if (!dep) throw new Error(`Unresolved composition dep "${depId}".`);
          return dep;
        },
        modes,
        offsets,
        injected,
      );
      meta = loaded.meta;
      geom = loaded.geom;
    } catch (e: any) {
      throw error(400, `Inline bake-preview failed for "${id}": ${e?.message ?? e}`);
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

  const resolved = meta ? resolveDerived(meta, paramBag) : paramBag;

  // Run the bake under the mutex so concurrent calls don't interleave
  // inside the Manifold WASM section.
  let bakeBytes: Uint8Array | undefined;
  let bakeError: string | undefined;
  await withMutex(async () => {
    const prevZ = getRenderZScale();
    setRenderZScale(1); // GLB always bakes at z=1 (the live z-scale is a viewer concern)
    try {
      const bytes = await buildGlbBytes(geom!, resolved);
      if (!bytes.ok) {
        bakeError = bytes.error;
        return;
      }
      bakeBytes = wantCut ? (bytes.cut ?? bytes.full) : bytes.full;
    } finally {
      setRenderZScale(prevZ);
    }
  });

  if (bakeError) throw error(500, `Bake failed: ${bakeError}`);
  if (!bakeBytes) throw error(500, 'Bake produced no bytes');

  return new Response(new Uint8Array(bakeBytes), {
    headers: {
      'content-type': 'model/gltf-binary',
      'cache-control': 'no-store',
    },
  });
};

/** Filter a body field to `Record<string, T>` where T is a string in
 *  `allowed`. Drops every other key/value so a malformed payload can't
 *  poison the loader. Returns undefined if nothing valid remained. */
function isStringRecord<T extends string>(
  v: unknown,
  allowed: readonly T[],
): Record<string, T> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, T> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && (allowed as readonly string[]).includes(val)) {
      out[k] = val as T;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Filter a body field to `Record<string, number>` of finite values. */
function isNumberRecord(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
