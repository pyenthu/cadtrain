/**
 * /api/vocab/regenerate — server-side hook that re-runs the deterministic
 * translator pipeline for one or all vocabulary terms, then saves the
 * results back to the volume.
 *
 *   POST /api/vocab/regenerate?term=pin     → regenerate just `pin`
 *   POST /api/vocab/regenerate?all=1        → regenerate every term
 *
 * Returns { ok, regenerated: [...], skipped: [...], failures: [{term, error}] }.
 *
 * The pipeline mirrors `scripts/regenerate-from-vocab.ts` but stays inside
 * the SvelteKit process (no subprocess). Translator + composition-tree are
 * imported normally; save goes through the existing /api/primitives/save
 * endpoint by calling the request handler indirectly via fetch on the
 * same origin.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { json, error } from '@sveltejs/kit';
import { translate, type Vocabulary } from '$lib/authoring/rule-translator';
import type { RequestHandler } from './$types';

interface RegenResult {
  term: string;
  exemplar: string;
  status: 'ok' | 'error';
  message?: string;
  bake?: { verts: number; z_extent: number; outer_r: number };
}

// Hard-coded build order — primitives first so asm composes can resolve
// their imports on bake. Mirrors regenerate-from-vocab.ts. `stand` is
// deferred (the translator's `repeat` node is not yet supported).
const BUILD_ORDER = [
  'shaft', 'cone', 'frustum',
  'collar_flat', 'collar_tapered', 'collar_rounded',
  'pin', 'box',
  'tube', 'sub', 'xover', 'joint',
];

function loadVocab(): Vocabulary {
  const root = resolve(process.cwd());
  const raw = readFileSync(resolve(root, 'docs/parts/vocabulary.json'), 'utf8');
  return JSON.parse(raw) as Vocabulary;
}

async function regenerateOne(
  origin: string,
  vocab: Vocabulary,
  term: string,
): Promise<RegenResult> {
  const entry = vocab.terms[term];
  if (!entry) return { term, exemplar: '?', status: 'error', message: `unknown term: ${term}` };
  try {
    const source = translate(term, vocab);
    // Save to the volume via the existing endpoint (handles dir + validation).
    const saveResp = await fetch(`${origin}/api/primitives/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: entry.exemplar,
        source,
        kind: entry.kind,
        dir: 'basic/dp_test',
      }),
    });
    if (!saveResp.ok) {
      return { term, exemplar: entry.exemplar, status: 'error', message: `save ${saveResp.status}: ${(await saveResp.text()).slice(0, 200)}` };
    }
    // Bake-verify to surface broken regens immediately.
    const srcResp = await fetch(`${origin}/api/primitives/source?name=${encodeURIComponent(entry.exemplar)}`);
    if (!srcResp.ok) {
      return { term, exemplar: entry.exemplar, status: 'error', message: `source readback: ${srcResp.status}` };
    }
    const d = await srcResp.json() as { source: string; params: Record<string, { default: number }> };
    const params = Object.values(d.params ?? {}).map((p) => p.default);
    const bakeResp = await fetch(`${origin}/api/primitives/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: d.source, name: entry.exemplar, params }),
    });
    const bake = await bakeResp.json() as any;
    if (!bake.ok) {
      return { term, exemplar: entry.exemplar, status: 'error', message: `bake: ${bake.message ?? '?'}` };
    }
    const pos: number[] = bake.full?.positions ?? [];
    let zMin = Infinity, zMax = -Infinity, rMax = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      const r = Math.sqrt(x * x + y * y);
      if (r > rMax) rMax = r;
    }
    return {
      term, exemplar: entry.exemplar, status: 'ok',
      bake: { verts: pos.length / 3, z_extent: +(zMax - zMin).toFixed(3), outer_r: +rMax.toFixed(3) },
    };
  } catch (e: any) {
    return { term, exemplar: entry.exemplar, status: 'error', message: e?.message ?? String(e) };
  }
}

export const POST: RequestHandler = async ({ url, request }) => {
  const all = url.searchParams.get('all') === '1';
  const term = url.searchParams.get('term');
  if (!all && !term) throw error(400, 'pass either ?term=<name> or ?all=1');

  const vocab = loadVocab();
  const origin = url.origin;

  if (all) {
    const results: RegenResult[] = [];
    for (const t of BUILD_ORDER) results.push(await regenerateOne(origin, vocab, t));
    return json({
      ok: results.every((r) => r.status === 'ok'),
      regenerated: results.filter((r) => r.status === 'ok').map((r) => ({ term: r.term, bake: r.bake })),
      failures: results.filter((r) => r.status === 'error').map((r) => ({ term: r.term, error: r.message })),
    });
  }

  // Single-term path. If the term is asm and its deps aren't on the volume,
  // bake will fail — but we let it through + surface the error so the user
  // sees what's missing.
  const result = await regenerateOne(origin, vocab, term!);
  return json({
    ok: result.status === 'ok',
    regenerated: result.status === 'ok' ? [{ term: result.term, bake: result.bake }] : [],
    failures: result.status === 'error' ? [{ term: result.term, error: result.message }] : [],
  });
};
