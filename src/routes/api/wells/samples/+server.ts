/**
 * /api/wells/samples — the on-volume WSON well-sample store (root CLAUDE.md
 * Rule 13). Lets `/wells` list / read / write / delete `.wson` sample wells that
 * live on the persistent volume (`<volume>/wells/samples/`) instead of the
 * source tree, so a user can add / edit / customise them live.
 *
 *   GET    /api/wells/samples                 → { dir, seeded, samples: WellSampleFile[] }
 *   GET    /api/wells/samples?name=x.wson     → { name, slug, text }  (404 if absent)
 *   POST   /api/wells/samples   { name, text }→ { ok, name, slug, size }   (atomic save)
 *   DELETE /api/wells/samples?name=x.wson     → 204 (or 404 if absent)
 *
 * Rule 13: every handler calls `maybeProxy(request, url)` FIRST — in local dev
 * (`CADTRAIN_VOLUME_REMOTE_URL` set) the request forwards to prod, the single
 * live store. `/api/wells/samples` is also in `VOLUME_PROXY_PATHS`
 * (hooks.server.ts) so the hook proxies before the handler even runs; the
 * in-handler `maybeProxy` is the belt-and-suspenders that `/api/volume` uses.
 * `checkVolumeAuth` gates cross-origin callers when `CADTRAIN_VOLUME_TOKEN` is
 * set. Storage + name-safety + atomic writes live in `$lib/server/well-samples`.
 *
 * FORMAT-AGNOSTIC (#77 lookahead): this is a plain `.wson` file store — it never
 * parses WSON, so it can later hold the native graph docs #77 introduces.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkVolumeAuth, maybeProxy } from '$lib/server/volume';
import {
  WELLS_SAMPLES_REL,
  isValidSampleName,
  listWellSamples,
  readWellSample,
  writeWellSample,
  deleteWellSample,
  seedIfEmpty,
} from '$lib/server/well-samples';

export const GET: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const name = url.searchParams.get('name');
  if (name) {
    if (!isValidSampleName(name)) throw error(400, `Invalid sample name: ${name}`);
    const text = await readWellSample(name);
    if (text == null) throw error(404, `No such sample: ${name}`);
    return json({ name, slug: name.replace(/\.wson$/i, ''), text });
  }

  // Seed from the bundled set the first time the volume dir is empty (graceful
  // path — a fresh volume is never blank), then list.
  const { seeded } = await seedIfEmpty();
  const samples = await listWellSamples();
  return json({ dir: WELLS_SAMPLES_REL, seeded, samples });
};

export const POST: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  let body: any;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Body must be JSON: { name, text }');
  }
  const name = String(body?.name ?? '');
  const text = body?.text;
  if (!isValidSampleName(name)) throw error(400, `Invalid sample name: ${name}`);
  if (typeof text !== 'string' || text.length === 0) throw error(400, '`text` (non-empty string) is required');

  const saved = await writeWellSample(name, text);
  return json({ ok: true, name: saved.name, slug: saved.slug, size: saved.size });
};

export const DELETE: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const name = url.searchParams.get('name');
  if (!name || !isValidSampleName(name)) throw error(400, `Invalid sample name: ${name}`);
  const removed = await deleteWellSample(name);
  return new Response(null, { status: removed ? 204 : 404 });
};
