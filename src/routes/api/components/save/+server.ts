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
import { writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
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
import { checkVolumeAuth, safeVolumePath } from '$lib/server/volume';

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

  const { id, source, recipe, create, picture, meta: bodyMeta, instanceColors, instanceTopMode, instanceTopOffset } = body as {
    id?: unknown; source?: unknown; create?: unknown; picture?: unknown;
    /** JSON-recipe authoring shape (Phase 2 of the JSON pivot). When
     *  present, the endpoint writes `part.json` instead of
     *  `component.ts` and bakes the GLB via the recipe interpreter.
     *  Exactly one of `source` or `recipe` must be supplied. */
    recipe?: unknown;
    /** Identity + schema (post-grammar-split): the canonical home for
     *  `id` / `name` / `description` / `tags` / `params`. When present,
     *  written to meta.json alongside the classification fields below.
     *  The .ts source then carries only the geom function. Optional —
     *  pre-migration parts can keep their inline `export const meta`. */
    meta?: unknown;
    instanceColors?: unknown;
    instanceTopMode?: unknown;
    instanceTopOffset?: unknown;
  };

  if (typeof id !== 'string') {
    throw error(400, 'Missing id (string)');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid id format "${id}" — must start with a lowercase letter, only [a-z0-9_]`);
  }
  // Exactly one of `source` or `recipe` must be supplied. Recipe is the
  // post-pivot authoring shape; source is the legacy .ts path kept for
  // back-compat. Body validation is split per branch below.
  const hasSource = typeof source === 'string';
  const hasRecipe = recipe && typeof recipe === 'object';
  if (!hasSource && !hasRecipe) {
    throw error(400, 'Missing source (string) or recipe (object)');
  }
  if (hasSource && hasRecipe) {
    throw error(400, 'Supply exactly one of source (string) or recipe (object)');
  }
  if (hasSource && Buffer.byteLength(source as string, 'utf8') > MAX_BYTES) {
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

  // Pick the write destination + filename:
  //   recipe path  → library/<cat>/<id>/part.json (JSON pivot)
  //   source path:
  //     - update library part   → its current <category>/<id>/component.ts
  //     - update bundle in dev  → src/lib/cad/components/<id>.ts (HMR)
  //     - create or prod bundle edit → library/test/<id>/component.ts
  let targetPath: string;
  let wroteToLibrary: boolean;
  if (hasRecipe) {
    // Recipe path always writes to library/<cat>/<id>/part.json. When
    // updating, write back into the part's current category dir;
    // otherwise land in library/test (the holding pen).
    await ensureLibrary();
    const cat = libraryPart ? libraryPart.category : 'test';
    const dir = libraryPart ? libraryPart.dir : await partDirIn(cat, id);
    await mkdir(dir, { recursive: true });
    targetPath = join(dir, PART_FILES.recipe);
    wroteToLibrary = true;
  } else if (libraryPart) {
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
    if (hasRecipe) {
      // Light validation — required fields. Full structural check
      // happens inside the interpreter on bake.
      const r = recipe as any;
      if (!r.meta || typeof r.meta !== 'object') {
        throw error(400, 'recipe.meta is required');
      }
      if (r.meta.id !== id) {
        throw error(400, `recipe.meta.id "${r.meta.id}" must equal body id "${id}"`);
      }
      if (typeof r.meta.name !== 'string' || !r.meta.name) {
        throw error(400, 'recipe.meta.name is required (string)');
      }
      if (!r.meta.params || typeof r.meta.params !== 'object') {
        throw error(400, 'recipe.meta.params is required (object)');
      }
      if (!Array.isArray(r.instances)) {
        throw error(400, 'recipe.instances is required (array)');
      }
      if (!Array.isArray(r.composition)) {
        throw error(400, 'recipe.composition is required (array)');
      }
      const recipeJson = JSON.stringify(recipe, null, 2);
      if (Buffer.byteLength(recipeJson, 'utf8') > MAX_BYTES) {
        throw error(413, `Recipe too large (> ${MAX_BYTES} bytes)`);
      }
      await writeFile(targetPath, recipeJson, 'utf8');
    } else {
      await writeFile(targetPath, source as string, 'utf8');
    }
  } catch (e: any) {
    // Re-throw SvelteKit errors with their status; wrap raw fs errors as 500.
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }

  // Figure-draft first save: copy the source figure into the new part
  // directory as `picture.png` so the picture travels with the part.
  // Best-effort + path-restricted to archive/figures/ — a bad/missing
  // figure never fails the save.
  if (wroteToLibrary && typeof picture === 'string' && picture) {
    if (/^archive\/figures\/[^/]+\.png$/.test(picture)) {
      try {
        const src = safeVolumePath(picture);
        if (existsSync(src)) {
          await copyFile(src, join(dirname(targetPath), PART_FILES.picture));
        }
      } catch { /* picture copy is best-effort */ }
    }
  }

  // Per-instance viewer colours (Phase A). When the inspector swatch
  // sets `instanceColors`, merge into the part's existing meta.json so
  // family / level / autoTranslate stay intact. Only library writes carry
  // a meta.json — bundle src/ edits skip this. Best-effort: a bad
  // meta-write doesn't roll back the source save.
  if (wroteToLibrary && instanceColors && typeof instanceColors === 'object') {
    const colors: Record<string, string> = {};
    for (const [k, v] of Object.entries(instanceColors as Record<string, unknown>)) {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) colors[k] = v;
    }
    try {
      const partDir = dirname(targetPath);
      const metaPath = join(partDir, PART_FILES.meta);
      const existing = await resolvePart(id);
      const prevMeta = existing?.meta ?? {};
      const merged = { ...prevMeta, instanceColors: colors };
      await writeFile(metaPath, JSON.stringify(merged, null, 2), 'utf8');
    } catch { /* meta write is best-effort */ }
  }

  // (Removed: per-instance CSG ops used to merge into meta.instanceOps
  // here. After the grammar-split refactor, the CSG op lives in the
  // composition-section source text — `geom.add(X)` / `geom.subtract(X)`
  // / `geom.intersect(X)` — and is part of the source write above.)

  // Per-instance placement (mode + offset). The settings drawer commits
  // either field on its own or both together. Modes outside the union are dropped silently
  // so a bad payload can't poison the meta file; non-finite offsets are
  // dropped too (the loader treats absent overlay offsets as 0 anyway).
  const hasMode = instanceTopMode && typeof instanceTopMode === 'object';
  const hasOff = instanceTopOffset && typeof instanceTopOffset === 'object';
  if (wroteToLibrary && (hasMode || hasOff)) {
    const merged: Record<string, unknown> = {};
    if (hasMode) {
      const modes: Record<string, 'stack' | 'overlay' | 'origin'> = {};
      for (const [k, v] of Object.entries(instanceTopMode as Record<string, unknown>)) {
        if (v === 'stack' || v === 'overlay' || v === 'origin') modes[k] = v;
      }
      merged.instanceTopMode = modes;
    }
    if (hasOff) {
      const offs: Record<string, number> = {};
      for (const [k, v] of Object.entries(instanceTopOffset as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) offs[k] = v;
      }
      merged.instanceTopOffset = offs;
    }
    try {
      const partDir = dirname(targetPath);
      const metaPath = join(partDir, PART_FILES.meta);
      const existing = await resolvePart(id);
      const prevMeta = existing?.meta ?? {};
      await writeFile(metaPath, JSON.stringify({ ...prevMeta, ...merged }, null, 2), 'utf8');
    } catch { /* meta write is best-effort */ }
  }

  // Identity + schema → meta.json (post-grammar-split refactor). Accepts
  // `{ id?, name?, description?, tags?, params? }`. Only library writes
  // get a meta.json — bundle src/ edits skip this entirely. Best-effort:
  // a bad meta-write doesn't roll back the source save.
  if (wroteToLibrary && bodyMeta && typeof bodyMeta === 'object' && !Array.isArray(bodyMeta)) {
    const bm = bodyMeta as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    if (typeof bm.id === 'string' && /^[a-z][a-z0-9_]*$/.test(bm.id)) cleaned.id = bm.id;
    if (typeof bm.name === 'string') cleaned.name = bm.name;
    if (typeof bm.description === 'string') cleaned.description = bm.description;
    if (Array.isArray(bm.tags)) {
      const tags: string[] = [];
      for (const t of bm.tags) if (typeof t === 'string') tags.push(t);
      if (tags.length > 0) cleaned.tags = tags;
    }
    if (bm.params && typeof bm.params === 'object' && !Array.isArray(bm.params)) {
      const params: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of Object.entries(bm.params as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          params[k] = v as Record<string, unknown>;
        }
      }
      if (Object.keys(params).length > 0) cleaned.params = params;
    }
    if (Object.keys(cleaned).length > 0) {
      try {
        const partDir = dirname(targetPath);
        const metaPath = join(partDir, PART_FILES.meta);
        const existing = await resolvePart(id);
        const prevMeta = existing?.meta ?? {};
        await writeFile(metaPath, JSON.stringify({ ...prevMeta, ...cleaned }, null, 2), 'utf8');
      } catch { /* meta write is best-effort */ }
    }
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
        const r = await bakeGlb(id, geom, extractDefaultsFromSource(source as string));
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
        // Library parts: GLB lives inside the part directory as
        // `mesh.glb` + `mesh.cut.glb` (per Rule 18, the part dir is
        // self-contained). Pass the part's dir as outDir so bakeGlb
        // writes there instead of the bundle STATIC_DIR (which is
        // for src/-tracked bundle primitives only).
        // Defaults preference order: loaded.meta.params (authoritative —
        // covers both inline-meta and JSON-meta parts) → fall back to
        // the source-regex extractor for safety. Post-grammar-split
        // parts have no `params:` block in source, so the loader-resolved
        // meta is the only correct source.
        const loadedDefaults: Record<string, number> = {};
        const lm: any = loaded.meta;
        if (lm?.params && typeof lm.params === 'object') {
          for (const [k, v] of Object.entries(lm.params as Record<string, any>)) {
            const d = v?.default;
            if (typeof d === 'number' && Number.isFinite(d)) loadedDefaults[k] = d;
          }
        }
        const defaults = Object.keys(loadedDefaults).length > 0
          ? loadedDefaults
          : (hasSource ? extractDefaultsFromSource(source as string) : {});
        const r = await bakeGlb(id, loaded.geom, defaults, dirname(targetPath));
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
