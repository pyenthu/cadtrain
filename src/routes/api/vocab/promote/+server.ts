/**
 * /api/vocab/promote — write an inferred (or hand-authored) rule back into
 * vocabulary.seeds.json and flip status to 'promoted'.
 *
 *   POST /api/vocab/promote?term=mule_shoe
 *     body: { polygon: [[r,z],...], note?: string, source?: 'inferred' | 'manual' }
 *     → { ok, term, new_status: 'promoted', vocab_path }
 *
 * The rule is written as a primitive · polygon_inline block matching the
 * translator's expected shape (rule-translator.ts → translateRev), so the
 * existing /api/vocab/regenerate pipeline picks it up cleanly. The seed file
 * stays the authoritative store for completion components; lifting promoted
 * terms into vocabulary.json happens batch-style later.
 *
 * Atomic write: temp file + rename, per Rule 4. Backs up to .bak if
 * SEEDS_BACKUP=1.
 */
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SEEDS_PATH = resolve(process.cwd(), 'docs/parts/vocabulary.seeds.json');

interface PromoteBody {
  polygon: Array<[number, number]>;
  note?: string;
  source?: 'inferred' | 'manual';
  // Optional dimensional params to expose as dials post-promotion.
  // If omitted, the polygon is hard-coded (still bakes; just not dial-tunable).
  expose_params?: Array<{ key: string; default: number; min: number; max: number; step: number; unit?: string }>;
}

export const POST: RequestHandler = async ({ url, request }) => {
  const term = url.searchParams.get('term');
  if (!term) throw error(400, 'pass ?term=<slug>');

  let body: PromoteBody;
  try { body = await request.json() as PromoteBody; }
  catch { throw error(400, 'body must be JSON: { polygon: [[r,z],...] }'); }

  if (!Array.isArray(body.polygon) || body.polygon.length < 3) {
    throw error(400, 'polygon must be an array of ≥ 3 [r,z] vertices');
  }
  for (const v of body.polygon) {
    if (!Array.isArray(v) || v.length !== 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
      throw error(400, 'each polygon vertex must be [r:number, z:number]');
    }
    if (v[0]! < 0) throw error(400, `r must be ≥ 0 (got ${v[0]} in r_revolve half-section convention)`);
  }

  if (!existsSync(SEEDS_PATH)) throw error(500, 'vocabulary.seeds.json missing');
  const raw = readFileSync(SEEDS_PATH, 'utf8');
  const seeds = JSON.parse(raw) as { version: string; terms: Record<string, any>; stats?: any };
  const seed = seeds.terms?.[term];
  if (!seed) throw error(404, `seed not found: ${term}`);

  // Build the rule block. Matches translateRev's `polygon_inline` shape.
  // Polygon vertex expressions are inlined as string-literal numbers; if
  // the caller asked for expose_params, we'd swap those numbers for the
  // matching param key — left as a follow-up; first cut is hard-coded.
  const polygonExprs = body.polygon.map(([r, z]) => `[${r}, ${z}]`);
  const rule: any = {
    kind: 'primitive',
    template: 'polygon_inline',
    engine: 'r_revolve',
    polygon: polygonExprs,
    derived_from: body.source ?? 'inferred',
  };

  // Optional param-dial slots — translator will see them as parametric.
  const params: Record<string, any> = body.expose_params
    ? Object.fromEntries(body.expose_params.map((p) => [p.key, {
      default: p.default, min: p.min, max: p.max, step: p.step, ...(p.unit ? { unit: p.unit } : {}),
    }]))
    : {};

  // Update seed in place.
  seed.rule = rule;
  seed.params = params;
  seed.status = 'promoted';
  seed.promoted_at = new Date().toISOString().slice(0, 19) + 'Z';
  if (body.note) seed.promotion_note = body.note;

  // Bookkeeping: promoted_count in stats so the page can show a "you've
  // promoted N / total" indicator without recounting.
  seeds.stats = seeds.stats ?? {};
  seeds.stats.promoted = Object.values(seeds.terms).filter((t: any) => t?.status === 'promoted').length;

  // Backup (best-effort) + atomic write.
  try {
    if (process.env.SEEDS_BACKUP === '1') copyFileSync(SEEDS_PATH, SEEDS_PATH + '.bak');
  } catch { /* nothing */ }
  const tmp = SEEDS_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(seeds, null, 2) + '\n');
  renameSync(tmp, SEEDS_PATH);

  return json({
    ok: true,
    term,
    new_status: 'promoted',
    vocab_path: 'docs/parts/vocabulary.seeds.json',
    rule,
    params,
  });
};
