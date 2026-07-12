/**
 * engine-hash — a build-time content hash of the GEOMETRY ENGINE modules.
 *
 * THE HAZARD THIS KILLS (N4). A fix inside a low-level engine module —
 * `manifold-helpers.ts`, `manifold-mesh.ts`, `warp-spline.ts`, `render-helpers.ts`,
 * or a `stdlib/` engine — changes NEITHER the part's saved source NOR the compiled
 * `scriptHash` (those helpers are injected into the sandbox BY NAME, not inlined
 * into the script text). So both persistent bake caches keep serving the pre-fix
 * mesh until someone remembers to hand-bump `KERNEL_VERSION`. That manual bump has
 * been forgotten twice (`+cap1`, `+cut2`) and once cost an hour chasing a fix that
 * already worked.
 *
 * THE FIX. `ENGINE_HASH` is a stable digest of those engine modules' SOURCE TEXT,
 * captured at build time via `import.meta.glob(..., { query: '?raw' })` (the same
 * mechanism `src/lib/server/stdlib.ts` already uses to bake stdlib source into the
 * image). It is folded into:
 *   - the server bake-cache key (`hashBakeKey`, bake-cache.ts) → busts the SERVER
 *     `/api/primitives/preview` FS cache; and
 *   - the compiled `scriptHash` (`compilePrimitiveScript`, primitive-loader.ts) →
 *     the CLIENT IndexedDB key is `KERNEL_VERSION + scriptHash + …`, so a moved
 *     scriptHash busts the client cache automatically — the worker computes nothing.
 * An engine edit therefore changes both keys with ZERO manual bookkeeping.
 *
 * ONE-TIME COST. Landing this (or any later engine edit) changes `ENGINE_HASH`
 * once, so every existing cached bake re-bakes ONCE. Expected and acceptable — the
 * alternative is silently serving stale geometry.
 *
 * ISOMORPHIC. No `node:crypto` / `node:fs` — a pure-JS FNV-1a over UTF-8 bytes —
 * so this module is safe to import from a server module OR a browser Web Worker
 * (`TextEncoder` + `BigInt` exist in both). Cache-busting, not security: FNV-1a
 * 64-bit reliably changes on any content edit; a hash COLLISION between two engine
 * states is astronomically unlikely and, at worst, degrades to today's behaviour.
 */

/** Engine modules whose edits change baked geometry WITHOUT touching a part's
 *  source or its compiled scriptHash. Extend this list (nothing re-bakes
 *  automatically for a module NOT listed here) when a new such module appears.
 *  `stdlib/**` covers both the active engines and `stdlib/stale/`. */
const ENGINE_GLOBS = [
  '/src/lib/engines/manifold/manifold-helpers.ts',
  '/src/lib/engines/manifold/manifold-mesh.ts',
  '/src/lib/engines/manifold/warp-spline.ts',
  '/src/lib/engines/manifold/render-helpers.ts',
  // Injected into the bake sandbox by name, so a change to its minimum-curvature
  // math moves baked geometry without moving any part's source or scriptHash.
  '/src/lib/graph/survey-to-xyz.ts',
  '/src/lib/graph/stdlib/**/*.ts',
  '!/src/lib/graph/stdlib/**/*.test.ts', // co-located engine tests don't affect baked geometry
];

/** Eager raw-source map: path → file text, inlined into the build at compile
 *  time. Verified to work in the SERVER bundle (stdlib.ts uses the same call) and
 *  the vitest/worker bundles (Vite transforms all three). Kept as a literal-array
 *  argument because Vite requires `import.meta.glob`'s patterns to be statically
 *  analysable (it cannot read them from the `ENGINE_GLOBS` const above). */
export const ENGINE_SOURCES = import.meta.glob(
  [
    '/src/lib/engines/manifold/manifold-helpers.ts',
    '/src/lib/engines/manifold/manifold-mesh.ts',
    '/src/lib/engines/manifold/warp-spline.ts',
    '/src/lib/engines/manifold/render-helpers.ts',
    '/src/lib/graph/survey-to-xyz.ts',
    '/src/lib/graph/stdlib/**/*.ts',
    '!/src/lib/graph/stdlib/**/*.test.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Normalise a glob key to a bundle-independent relative path (`lib/graph/…`) so
 *  the SERVER and CLIENT bundles derive the SAME digest for the same sources —
 *  a nice-to-have (each cache is its own namespace, so they need only be stable
 *  WITHIN a bundle, not equal across bundles). */
function normalizeEngineKey(key: string): string {
  const i = key.indexOf('src/');
  return i >= 0 ? key.slice(i + 4) : key.replace(/^.*\//, '');
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;
const SEP = new Uint8Array([0]);

/**
 * Pure, deterministic 64-bit FNV-1a over the sorted `path\0content\0` stream of
 * the given source map. Separated from the `import.meta.glob` capture above so it
 * is unit-testable with a fixture map (mutate an entry → the digest MUST move; an
 * entry not present can never affect it). Returns 16 lowercase hex chars.
 */
export function hashEngineSources(files: Record<string, string>): string {
  const enc = new TextEncoder();
  let h = FNV_OFFSET;
  const updateBytes = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]!);
      h = (h * FNV_PRIME) & MASK64;
    }
  };
  const update = (s: string) => updateBytes(enc.encode(s));

  const entries = Object.entries(files)
    .map(([k, v]) => [normalizeEngineKey(k), v] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [k, content] of entries) {
    update(k);
    updateBytes(SEP);
    update(content);
    updateBytes(SEP);
  }
  return h.toString(16).padStart(16, '0');
}

/** The glob patterns used to capture `ENGINE_SOURCES`, exported for tests that
 *  pin the scope (an UNRELATED module must never enter the hash input). */
export const ENGINE_HASH_GLOBS = ENGINE_GLOBS;

/**
 * Content digest of the geometry-engine modules, captured at build time. Folded
 * into the server bake-cache key AND the compiled scriptHash so an engine edit
 * invalidates both persistent caches with no manual `KERNEL_VERSION` bump.
 */
export const ENGINE_HASH: string = hashEngineSources(ENGINE_SOURCES);
