/**
 * POST /api/components/save
 *
 * Persist an edited component source from the in-browser editor back to
 * disk. Two write destinations, picked by where the component lives:
 *
 *   - **Library** (`<volume>/library/<category>/<id>/component.ts`) —
 *     every NEWLY created component (`create: true`) lands in the `test`
 *     category (the holding pen). Updates to a part already in the
 *     library are written back into its current category directory —
 *     editing never moves a part between categories (that's
 *     /api/components/move). See `library.ts` for the directory model.
 *   - **Bundle src/** (`src/lib/cad/components/<id>.ts`) — only when
 *     UPDATING one of the 26 baseline primitives in DEV. Vite HMR picks
 *     it up. (In prod a bundle primitive has no on-disk src file, so an
 *     edit there creates a library `test/` part instead.)
 *
 * NOT proxied — authoring is dev-local. Only /api/components/geom proxies.
 *
 * Safety:
 *   - create mode: id must NOT already exist anywhere (no clobber).
 *   - update mode: id MUST already exist somewhere (no arbitrary writes).
 *   - source must be reasonably small (< 256KB).
 *   - the on-disk path is rebuilt from a sanitized id.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { dev } from '$app/environment';
import { COMPONENT_REGISTRY, geomById } from '$lib/cad/components';
import { invalidateRunesListCache } from '../list/cache';
import { bakeGlb } from '$lib/server/manifold-bake';
import { initManifold } from '$lib/cad/manifold-helpers';
import {
  loadVolumeComponent,
  invalidateVolumeComponent,
} from '$lib/server/component-loader';
import { resolvePart, partDirIn, ensureLibrary, PART_FILES } from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

/** Pulls each `params.<name>.default` out of the raw source text — used
 *  to bake a GLB with the file's declared defaults without dynamic-
 *  importing the .ts. Mirrors the parser in /api/components/list. */
function extractDefaultsFromSource(src: string): Record<string, number> {
  const m = /params\s*:\s*\{/.exec(src);
  if (!m) return {};
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return {};
  const body = src.slice(m.index + m[0].length, i);
  const out: Record<string, number> = {};
  for (const entry of body.matchAll(/(\w+)\s*:\s*\{([^}]+)\}/g)) {
    const dm = /\bdefault\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/.exec(entry[2]);
    if (dm) out[entry[1]] = Number(dm[1]);
  }
  return out;
}

const MAX_BYTES = 256 * 1024;
const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');

export const POST: RequestHandler = async ({ request, url }) => {
  // Deliberately NOT proxied — see the file header.
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');

  const { id, source, create } = body as { id?: unknown; source?: unknown; create?: unknown };

  if (typeof id !== 'string' || typeof source !== 'string') {
    throw error(400, 'Missing id (string) or source (string)');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid id format "${id}" — must start with a lowercase letter, only [a-z0-9_]`);
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) {
    throw error(413, `Source too large (> ${MAX_BYTES} bytes)`);
  }

  const isCreate = create === true;

  // Where does this id currently live?
  const libraryPart = await resolvePart(id);
  const srcPath = join(SRC_DIR, `${id}.ts`);
  const inSrc = existsSync(srcPath);
  const inBundle = COMPONENT_REGISTRY.some((e) => e.meta.id === id);
  const exists = !!libraryPart || inSrc || inBundle;

  if (isCreate && exists) {
    const where = libraryPart ? `library/${libraryPart.category}` : inSrc ? 'src/' : 'bundle';
    throw error(409, `Component "${id}" already exists (${where}) — drop create:true to update it.`);
  }
  if (!isCreate && !exists) {
    throw error(400, `Unknown component id "${id}" — doesn't exist anywhere. Pass create:true to create it.`);
  }

  // Pick the write destination.
  //   - create               → library/test/<id>/component.ts (holding pen)
  //   - update library part   → its current <category>/<id>/component.ts
  //   - update bundle in dev  → src/lib/cad/components/<id>.ts (HMR)
  //   - update bundle in prod → library/test/<id>/component.ts (new library part)
  let targetPath: string;
  let wroteToLibrary: boolean;
  if (libraryPart) {
    targetPath = libraryPart.componentPath;
    wroteToLibrary = true;
  } else if (!isCreate && inSrc && dev) {
    targetPath = srcPath;
    wroteToLibrary = false;
  } else {
    // create, or a prod-side bundle edit → a fresh library/test part.
    await ensureLibrary();
    const dir = await partDirIn('test', id);
    await mkdir(dir, { recursive: true });
    targetPath = join(dir, PART_FILES.component);
    wroteToLibrary = true;
  }

  try {
    if (!wroteToLibrary) await mkdir(SRC_DIR, { recursive: true });
    await writeFile(targetPath, source, 'utf8');
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }

  invalidateRunesListCache();

  // Geometry verification + optional GLB bake.
  //   - src/ write: the file lands in the build-time glob once Vite
  //     re-evaluates; geomById may lag — wait briefly, re-import, bake.
  //   - library write: the part renders server-side via /api/components/
  //     geom; verify it transpiles + executes through loadVolumeComponent
  //     (the exact path the geom endpoint takes). The bake is best-effort.
  // Non-fatal either way — surfaced in the response, never rolls back.
  let bakeReport: { ok: boolean; bytes?: number; error?: string; deferred?: boolean } = { ok: false };

  if (!wroteToLibrary) {
    let geom = geomById(id);
    if (!geom) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const fresh: any = await import(/* @vite-ignore */ `$lib/cad/components?refresh=${Date.now()}`);
        geom = fresh?.geomById?.(id);
      } catch {}
    }
    if (!geom) {
      bakeReport = {
        ok: false,
        deferred: true,
        error: 'geom not in registry yet — Vite still bundling. Refresh the page and re-save to trigger the bake.',
      };
    } else {
      try {
        const r = await bakeGlb(id, geom, extractDefaultsFromSource(source));
        bakeReport = r.ok ? { ok: true, bytes: r.bytes } : { ok: false, error: r.error };
      } catch (e: any) {
        bakeReport = { ok: false, error: e?.message ?? String(e) };
      }
    }
  } else {
    invalidateVolumeComponent(id);
    try {
      await initManifold();
      const loaded = await loadVolumeComponent(id);
      try {
        const r = await bakeGlb(id, loaded.geom, extractDefaultsFromSource(source));
        bakeReport = r.ok ? { ok: true, bytes: r.bytes } : { ok: false, error: r.error };
      } catch (e: any) {
        bakeReport = { ok: false, error: e?.message ?? String(e) };
      }
    } catch (e: any) {
      bakeReport = { ok: false, error: `library part failed to load: ${e?.message ?? e}` };
    }
  }

  // A freshly-created part (or a prod bundle edit) is now in library/test.
  const resolved = wroteToLibrary ? await resolvePart(id) : null;
  return json({
    ok: true,
    path: targetPath,
    origin: resolved ? resolved.category : 'bundle',
    glb: bakeReport,
  });
};
