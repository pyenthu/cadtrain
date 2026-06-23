import { json, error } from '@sveltejs/kit';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { readScriptCache, writeScriptCache } from '$lib/server/script-cache';

// GET /api/primitives/compile?name=<id>
//
// Compiles a volume primitive into a SELF-CONTAINED Manifold script (every
// `meta.uses` dep inlined as text so the client fetches nothing) + a sha256
// `scriptHash`. The client worker (PR2+) runs the script the SAME way the
// server runs the executor today —
//   new Function(...SANDBOX_ARG_NAMES, script)(...sandboxArgValues())  → geomFn
// — so the inlined-text path is byte-identical to buildPrimitiveGeom's
// inject-functions path (proved by the PR1 parity unit test).
//
// Because the script folds in resolved dep source, scriptHash changes whenever
// a dep changes → the "deja-vu" stale-bake bug becomes impossible when the
// client reads from this (PR1–3 shipped; default OFF — see client-side-execution.md).
//
// Like /api/primitives/preview this is a LOCAL, stateless-compute endpoint
// (excluded from the volume proxy) — it reads dep SOURCE via the loader's
// fetchFn (which proxies /api/primitives/source to prod in dev), no WASM.
//
// ISOLATION CONTRACT (mirrors /api/brep/preview): NEVER 500. Every failure —
// missing dep, cycle, unparseable source — returns 200 + { supported:false,
// reason } so a caller degrades gracefully and the rest of the app is untouched.

const NAME_RE = /^[a-z_][a-z0-9_]*$/i;

/** Shared compile + cache. `source` undefined → fetch the saved source by name
 *  (GET, saved parts); `source` provided → compile it verbatim (POST, the live
 *  graph-editor emit, which differs from the saved file while editing). */
async function compileAndCache(name: string, source: string | undefined, bust: boolean, fetch: typeof globalThis.fetch) {
  let src = source;
  if (src == null) {
    const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) return json({ supported: false, kernel: 'manifold', reason: `primitive "${name}" not found (HTTP ${r.status})` });
    const data = await r.json();
    src = typeof data?.source === 'string' ? data.source : '';
  }
  if (!src) return json({ supported: false, kernel: 'manifold', reason: `primitive "${name}" returned empty source` });

  const { script, scriptHash, depNames } = await compilePrimitiveScript(src, name, fetch);

  // Cache by (id, scriptHash) — keyed on the script, so a live edit (different
  // source → different hash) caches separately from the saved part.
  if (!bust) {
    const hit = await readScriptCache(name, scriptHash);
    if (hit) return json({ script: hit, scriptHash, kernel: 'manifold', supported: true, cached: true, depNames });
  }
  writeScriptCache(name, scriptHash, script).catch((e) => console.warn('[script-cache] write failed:', e?.message ?? e));
  return json({ script, scriptHash, kernel: 'manifold', supported: true, cached: false, depNames });
}

// GET ?name=<id> — compile the SAVED part by name.
export const GET = async ({ url, fetch }) => {
  const name = url.searchParams.get('name');
  if (!name) throw error(400, 'name query param required');
  if (!NAME_RE.test(name)) throw error(400, 'invalid primitive name');
  try { return await compileAndCache(name, undefined, url.searchParams.get('bust') === '1', fetch); }
  catch (e: any) { return json({ supported: false, kernel: 'manifold', reason: String(e?.message ?? e).slice(0, 300) }); }
};

// POST { name, source, bust? } — compile the GIVEN source (the live editor emit).
export const POST = async ({ request, fetch }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const name = body?.name;
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw error(400, 'valid name required');
  const source = typeof body?.source === 'string' ? body.source : undefined;
  try { return await compileAndCache(name, source, body?.bust === true, fetch); }
  catch (e: any) { return json({ supported: false, kernel: 'manifold', reason: String(e?.message ?? e).slice(0, 300) }); }
};
