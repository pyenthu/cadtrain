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
// a dep changes → the "deja-vu" stale-bake bug becomes impossible the moment a
// client reads from this. PR1 alone is dormant (no client wiring yet).
//
// Like /api/primitives/preview this is a LOCAL, stateless-compute endpoint
// (excluded from the volume proxy) — it reads dep SOURCE via the loader's
// fetchFn (which proxies /api/primitives/source to prod in dev), no WASM.
//
// ISOLATION CONTRACT (mirrors /api/brep/preview): NEVER 500. Every failure —
// missing dep, cycle, unparseable source — returns 200 + { supported:false,
// reason } so a caller degrades gracefully and the rest of the app is untouched.

const NAME_RE = /^[a-z_][a-z0-9_]*$/i;

export const GET = async ({ url, fetch }) => {
  const name = url.searchParams.get('name');
  if (!name) throw error(400, 'name query param required');
  if (!NAME_RE.test(name)) throw error(400, 'invalid primitive name');
  // ?bust=1 forces a fresh compile (skips the cache lookup); the result is
  // still written back so the next call hits.
  const bust = url.searchParams.get('bust') === '1';

  try {
    // Read the part's own source via the category-aware source endpoint (same
    // resolution the loader uses for deps — stdlib/stdstale + volume).
    const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) {
      return json({ supported: false, kernel: 'manifold', reason: `primitive "${name}" not found (HTTP ${r.status})` });
    }
    const data = await r.json();
    const source = typeof data?.source === 'string' ? data.source : '';
    if (!source) {
      return json({ supported: false, kernel: 'manifold', reason: `primitive "${name}" returned empty source` });
    }

    const { script, scriptHash, depNames } = await compilePrimitiveScript(source, name, fetch);

    // Cache by (id, scriptHash). On hit, serve the cached text (byte-identical
    // to a recompile of the same inputs); on miss, store what we just compiled.
    if (!bust) {
      const hit = await readScriptCache(name, scriptHash);
      if (hit) {
        return json({ script: hit, scriptHash, kernel: 'manifold', supported: true, cached: true, depNames });
      }
    }
    writeScriptCache(name, scriptHash, script).catch((e) => {
      console.warn('[script-cache] write failed:', e?.message ?? e);
    });
    return json({ script, scriptHash, kernel: 'manifold', supported: true, cached: false, depNames });
  } catch (e: any) {
    // Never-500: a missing dep / cycle / parse error degrades to supported:false.
    return json({ supported: false, kernel: 'manifold', reason: String(e?.message ?? e).slice(0, 300) });
  }
};
