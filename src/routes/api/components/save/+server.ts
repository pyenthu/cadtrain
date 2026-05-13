/**
 * POST /api/components/save
 *
 * Persist an edited component .ts source file from the in-browser editor
 * (Script popup → Svelte tab → editable CodeMirror) back to disk.
 *
 * In dev: writes directly to `src/lib/cad/components/<id>.ts` so Vite
 * HMR picks up the change and the page hot-reloads with the new geometry.
 * In production: writes to `/data/components/<id>.ts` (Railway volume) — the
 * component registry is expected to consult that overlay first (separate task,
 * not yet wired). For now production saves no-op with a 503 so we don't
 * mutate baked-in source on a deploy.
 *
 * Safety:
 *   - id must match a known entry in the component registry (whitelist; no
 *     arbitrary file writes).
 *   - source must be reasonably small (< 256KB) — guards against accidental
 *     paste of a giant blob.
 *   - the on-disk path is rebuilt from a sanitized id, never trusted from
 *     the request body verbatim.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { dev } from '$app/environment';
import { COMPONENT_REGISTRY, defaultsFor, geomById } from '$lib/cad/components';
import { invalidateRunesListCache } from '../list/cache';
import { bakeGlb } from '$lib/server/manifold-bake';

/** Tiny default-params extractor — pulls each `params.<name>.default`
 *  out of the raw source text. Used by the save endpoint to bake a GLB
 *  with the same defaults the file declares, without dynamic-importing
 *  the .ts file (which Bun's runtime parser rejects when invoked via a
 *  cache-bust query). Mirrors the parsing logic in /api/components/list. */
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
    const name = entry[1];
    const inner = entry[2];
    const dm = /\bdefault\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/.exec(inner);
    if (dm) out[name] = Number(dm[1]);
  }
  return out;
}

const MAX_BYTES = 256 * 1024;
const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');
const VOLUME_DIR = '/data/components';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');

  const { id, source, create } = body as { id?: unknown; source?: unknown; create?: unknown };

  if (typeof id !== 'string' || typeof source !== 'string') {
    throw error(400, 'Missing id (string) or source (string)');
  }
  // Defense in depth — strict id format BEFORE any path composition.
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid id format "${id}" — must start with a lowercase letter, only [a-z0-9_]`);
  }

  const isCreate = create === true;
  if (!isCreate) {
    // Update mode — id MUST already be in the registry. Protects against
    // accidental writes to brand-new files via the update path.
    if (!COMPONENT_REGISTRY.find((e) => e.meta.id === id)) {
      throw error(400, `Unknown component id "${id}" — not in registry. Pass create:true to create a new primitive.`);
    }
  } else {
    // Create mode — id MUST NOT already exist (don't clobber).
    if (COMPONENT_REGISTRY.find((e) => e.meta.id === id)) {
      throw error(409, `Primitive "${id}" already exists — drop create:true to update it.`);
    }
  }

  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) {
    throw error(413, `Source too large (> ${MAX_BYTES} bytes)`);
  }

  if (!dev) {
    // Production overlay path is /data/components/<id>.ts. The component registry
    // doesn't yet consult this overlay at runtime, so saving in prod
    // would silently no-op from the user's perspective. Refuse for now.
    return json({
      ok: false,
      reason: 'Production overlay loader not wired yet — saving disabled. Edit the source file locally and deploy.',
      path: join(VOLUME_DIR, `${id}.ts`),
    }, { status: 503 });
  }

  const path = join(SRC_DIR, `${id}.ts`);
  try {
    await mkdir(SRC_DIR, { recursive: true });
    await writeFile(path, source, 'utf8');
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }

  // Drop the cached /api/components/list payload so the next list request
  // re-scans and reflects the new/edited file.
  invalidateRunesListCache();

  // Bake the default-params GLB so the client can use it for fast
  // first-paint. Non-fatal: a bake failure doesn't roll back the source
  // write — surface the error in the response payload so the UI can
  // flag it without losing the user's edits.
  //
  // Geom comes from the build-time registry (geomById). For brand-new
  // primitives the geom won't be in the registry until Vite re-bundles;
  // in that case the bake is skipped with a clear note. Defaults are
  // parsed from the source text we just wrote (no dynamic import needed
  // — Bun's runtime parser chokes on TS type annotations when imported
  // with a cache-bust query).
  let bakeReport: { ok: boolean; bytes?: number; error?: string; deferred?: boolean } = { ok: false };
  let geom = geomById(id);
  // Brand-new primitives won't be in the build-time registry yet (Vite
  // hasn't re-evaluated the glob). Wait briefly for the file watcher to
  // invalidate the components index, then re-import to pick up the new entry.
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
      const defaults = extractDefaultsFromSource(source);
      const r = await bakeGlb(id, geom, defaults);
      bakeReport = r.ok ? { ok: true, bytes: r.bytes } : { ok: false, error: r.error };
    } catch (e: any) {
      bakeReport = { ok: false, error: e?.message ?? String(e) };
    }
  }

  return json({ ok: true, path, glb: bakeReport });
};
