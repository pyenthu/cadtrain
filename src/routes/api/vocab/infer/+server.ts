/**
 * /api/vocab/infer — deterministic 2D-drawing → r_revolve profile.
 *
 *   POST /api/vocab/infer?term=mule_shoe
 *     → { ok, polygon: [[r,z],...], source: '...', warnings, bbox, axisymmetric }
 *
 * Reads the seed from vocabulary.seeds.json (for od_in calibration), fetches
 * the matching compjson_ref file off disk, runs inferProfile(), and (when
 * the polygon looks sane) optionally bake-verifies via /api/primitives/preview.
 *
 * Inference is pure deterministic geometry (no LLM, no learning model) — the
 * compjson drawings are already half-section views in the convention that
 * r_revolve directly consumes. See src/lib/authoring/compjson-to-profile.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { json, error } from '@sveltejs/kit';
import { inferProfile, inferredToRevSource, type CompJsonDoc } from '$lib/authoring/compjson-to-profile';
import type { RequestHandler } from './$types';

interface SeedTerm {
  category: string;
  sub_category: string;
  dims_from_catalogue: { od_in?: number; id_in?: number; length_ft?: number };
  compjson_ref?: string;
  status: string;
}

function loadSeeds(): { terms: Record<string, SeedTerm> } | null {
  const path = resolve(process.cwd(), 'docs/parts/vocabulary.seeds.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadCompjsonByRef(ref: string): CompJsonDoc | null {
  // ref looks like "/svtc-compjson/MISC.MULE_SHOE.json"; resolve under static/.
  const rel = ref.startsWith('/') ? ref.slice(1) : ref;
  const path = resolve(process.cwd(), 'static', rel);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export const POST: RequestHandler = async ({ url, fetch: localFetch }) => {
  const term = url.searchParams.get('term');
  const bakeVerify = url.searchParams.get('bake') !== '0'; // default on
  if (!term) throw error(400, 'pass ?term=<slug>');

  const seeds = loadSeeds();
  const seed = seeds?.terms?.[term];
  if (!seed) throw error(404, `seed not found: ${term}`);
  if (!seed.compjson_ref) throw error(400, `seed "${term}" has no compjson_ref — no drawing to infer from`);

  const doc = loadCompjsonByRef(seed.compjson_ref);
  if (!doc) throw error(404, `compjson missing on disk: ${seed.compjson_ref}`);

  const odIn = seed.dims_from_catalogue?.od_in;
  if (!odIn) throw error(400, `seed "${term}" has no od_in for calibration`);

  const inferred = inferProfile(doc, {
    od_in: odIn,
    length_ft: seed.dims_from_catalogue?.length_ft,
    id_in: seed.dims_from_catalogue?.id_in,
  });
  const exemplarId = `dt_${term}_inferred`;
  const source = inferredToRevSource(exemplarId, inferred, {
    od_in: odIn,
    length_ft: seed.dims_from_catalogue?.length_ft,
  });

  // Bake-verify (default) — sends the source to /api/primitives/preview to
  // confirm Manifold accepts it. Adds vertices / z-extent / outer-r to the
  // response so the UI can show numeric agreement with bbox.
  let bake: any = null;
  if (bakeVerify && inferred.polygon.length >= 3) {
    try {
      const bakeResp = await localFetch('/api/primitives/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, name: exemplarId, params: [] }),
      });
      const data = await bakeResp.json() as any;
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
  }

  return json({
    ok: inferred.polygon.length > 0,
    term,
    exemplar: exemplarId,
    polygon: inferred.polygon,
    scale_in_per_px: inferred.scale_in_per_px,
    axisymmetric: inferred.axisymmetric,
    bbox: inferred.bbox,
    internal_features: inferred.internal_features,
    warnings: inferred.warnings,
    source,
    bake,
  });
};
