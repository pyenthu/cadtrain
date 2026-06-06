/**
 * /api/vocab/bake-proposed — translate a proposed-vocab-entries.json entry
 * via proposal-translator.ts, bake-verify via /api/primitives/preview, and
 * return the source + bake numbers.
 *
 *   POST /api/vocab/bake-proposed?term=mule_shoe
 *     → { ok, term, exemplar, source, bake: { ok, verts, z_extent, outer_r } }
 *
 * Different from /api/vocab/infer in that this path uses the PROPOSED
 * (hand-drafted, rich) rule — not the auto-derived single-polygon revolve
 * from the 2D drawing. For mule_shoe this produces the correct hollow
 * pipe + angled bottom cut + box connection on top, not the cone.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { json, error } from '@sveltejs/kit';
import { translateProposed, type ProposedEntry } from '$lib/authoring/proposal-translator';
import type { RequestHandler } from './$types';

function loadProposed(): { entries: Record<string, ProposedEntry> } | null {
  const p = resolve(process.cwd(), 'docs/parts/proposed-vocab-entries.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export const POST: RequestHandler = async ({ url, fetch: localFetch, request }) => {
  const term = url.searchParams.get('term');
  if (!term) throw error(400, 'pass ?term=<slug>');

  // Optional body — { params: [n1, n2, ...] } in meta.params order — lets
  // the /vocab Scene's parameter sliders drive the bake without saving.
  let bodyParams: (number | string)[] = [];
  try {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const body = await request.json() as any;
      if (Array.isArray(body?.params)) bodyParams = body.params;
    }
  } catch { /* no body — keep defaults */ }

  const proposed = loadProposed();
  const entry = proposed?.entries?.[term];
  if (!entry) throw error(404, `no proposed entry for term: ${term}`);

  let source: string;
  try {
    source = translateProposed(term, entry);
  } catch (e: any) {
    throw error(500, `translate: ${e?.message ?? String(e)}`);
  }
  const exemplar = `dt_${term}_proposed`;

  // Bake via /preview. When the caller passes params (slider values) we
  // forward them in meta.params order; otherwise [] lets the function's
  // ?? defaults take effect — matches how curated terms bake.
  let bake: any = null;
  try {
    const resp = await localFetch('/api/primitives/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, name: exemplar, params: bodyParams }),
    });
    const data = await resp.json() as any;
    if (data.ok) {
      const pos: number[] = data.full?.positions ?? [];
      let zMin = Infinity, zMax = -Infinity, rMax = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
        const r = Math.sqrt(x * x + y * y);
        if (r > rMax) rMax = r;
      }
      bake = {
        ok: true,
        verts: pos.length / 3,
        z_extent: +(zMax - zMin).toFixed(3),
        outer_r: +rMax.toFixed(3),
      };
    } else {
      bake = { ok: false, message: data.message ?? 'unknown bake failure' };
    }
  } catch (e: any) {
    bake = { ok: false, message: e?.message ?? String(e) };
  }

  return json({ ok: true, term, exemplar, source, bake });
};
