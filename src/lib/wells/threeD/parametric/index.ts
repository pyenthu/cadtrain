/**
 * Parametric tool-comp registry (PORTED from SVTC
 * `src/lib/apps/wson/threeD/parametric/index.ts`).
 *
 * Maps `tool_comp` codes to parametric builders. `WellSchematic3D.svelte` looks
 * up each completion's `tool_comp` here; if a builder is found it builds the
 * geometry (cached by sha-of-params) and substitutes it for the plain-cylinder
 * fallback. If no builder is registered the cylinder fallback stays — the
 * registry is additive, never blocking.
 *
 * cadtrain note: this coexists with `src/lib/wells/registry.ts`, which maps
 * `tool_comp` → cadtrain `g_*` VOLUME parts (server-baked). This registry is
 * the CLIENT-side parametric-builder path (SVTC's model); the two are
 * complementary — a completion resolves to a volume part OR a client builder.
 *
 * Adding a new builder is a 3-line edit:
 *   1. import './newBuilder'
 *   2. add to `_builders`
 *   3. (optional) add aliases to its `toolCompCodes`
 */
import type { ParametricComponent, ParametricResult } from './ParametricComponent';
import { bakerPacker } from './bakerPacker';

const _builders: ParametricComponent[] = [
  bakerPacker,
];

const _byCode = new Map<string, ParametricComponent>();
for (const b of _builders) {
  for (const code of b.toolCompCodes) _byCode.set(code, b);
}

/** Lookup a parametric builder by `tool_comp` code. Returns null if none.
 *  Case-insensitive on the code suffix. */
export function getBuilder(toolComp: string | undefined | null): ParametricComponent | null {
  if (!toolComp) return null;
  const exact = _byCode.get(toolComp);
  if (exact) return exact;
  const upper = toolComp.toUpperCase();
  for (const [k, v] of _byCode) if (k.toUpperCase() === upper) return v;
  return null;
}

/** All registered builders — used by an inspector UI to enumerate the known
 *  catalogue. Read-only snapshot. */
export function listBuilders(): ParametricComponent[] {
  return [..._builders];
}

// ── Build cache, keyed by stable sha of params ───────────────────────────────
// Manifold construction is expensive (WASM crossing + boolean ops); the scene
// re-renders frequently, so we keep a small LRU. Sha = id + JSON of sorted
// params so the same call signature always hits.
const _cache = new Map<string, ParametricResult>();
const CACHE_LIMIT = 64;

function cacheKey(id: string, params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  const norm: Record<string, number> = {};
  for (const k of keys) norm[k] = +(params[k].toFixed(6));
  return `${id}::${JSON.stringify(norm)}`;
}

/** Cached builder invocation. The same id+params returns the same
 *  ParametricResult object across calls. */
export async function buildCached(builder: ParametricComponent, params: Record<string, number>): Promise<ParametricResult> {
  // Fill defaults for unset params so `{}` and `{od: 5}` (default od 5) hash
  // to the same key.
  const filled: Record<string, number> = {};
  for (const p of builder.params) {
    filled[p.key] = params[p.key] ?? p.default;
  }
  const key = cacheKey(builder.id, filled);
  const hit = _cache.get(key);
  if (hit) return hit;
  const result = await builder.build(filled);
  _cache.set(key, result);
  if (_cache.size > CACHE_LIMIT) {
    const first = _cache.keys().next().value;
    if (first !== undefined) _cache.delete(first);
  }
  return result;
}

/** Clear the cache — useful from devtools when iterating on a builder. */
export function clearCache() { _cache.clear(); }

/** For tests + devtools. */
export const __cacheSize = () => _cache.size;

// Expose the registry on `window.__wellsParametric` so tests + devtools can
// inspect cache state. Guarded — no-op under SSR / node.
if (typeof window !== 'undefined') {
  (window as any).__wellsParametric = {
    listBuilders, getBuilder, buildCached, clearCache,
    cacheSize: __cacheSize,
  };
}
