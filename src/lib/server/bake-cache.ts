/**
 * Bake cache — persistent cache of /api/primitives/preview output.
 *
 * Key insight: the bake is a pure function of (source body, params, options).
 * Same inputs → same mesh. We hash those inputs, store the rendered output
 * under `$APP_DATA_DIR/cache/<part_id>/<hash>.json`, and on a future call
 * with the same inputs we serve the file directly — skipping the entire
 * 15s+ bake pipeline.
 *
 * Layout:
 *   $APP_DATA_DIR/cache/<part_id>/<hash>.json   ← mesh JSON (full + cutVC)
 *   $APP_DATA_DIR/cache/<part_id>/<hash>.meta   ← { params, options,
 *                                                    cachedAt, lastAccessAt,
 *                                                    sizeBytes }
 *
 * Hash inputs (decision Q3 = body-only, per docs/plans/bake-cache.md):
 *   - The function BODY extracted from the source. We don't hash the meta
 *     block because it carries random NodeIds + presentation-only fields
 *     (layout, viewport) that don't affect geometry. Body changes → hash
 *     changes → cache invalidates.
 *   - The params array, JSON-stringified
 *   - The options object (cutaway flag, zScale, etc.), JSON-stringified
 *
 * Hash output: SHA-256 → hex → first 16 chars. 64 bits = 1 in 18 quintillion
 * collision probability per pair of entries — far beyond any realistic
 * cache size. Short enough for clean filenames.
 *
 * All writes are ATOMIC (write to .tmp + rename). Reads are tolerant of
 * partial / corrupt entries — they just count as a miss and we re-bake.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, unlink, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from './volume';
import { ENGINE_HASH } from '$lib/graph/engine-hash';

const CACHE_DIR = 'cache';
/** SHA-256 hex truncated to 16 chars — 64-bit collision space. */
const HASH_LEN = 16;
/** Validate part_id format up-front so a malformed id can't escape the
 *  cache dir via path traversal. Same regex `findPrim` uses. */
const PART_ID_RE = /^[a-z_][a-z0-9_]*$/i;

export interface BakeCacheOptions {
  /** Whether the caller wanted the cutaway computed. Affects hash because
   *  the on-disk geometry differs (cutVC present vs empty). */
  cutaway?: boolean | undefined;
  /** Z-axis scale at render time. Default 1.0; pass through to the hash. */
  zScale?: number | undefined;
  /** Mode passed to /preview ('bundle' bypasses the sandbox). */
  mode?: string | undefined;
  /** Per-part outer/inner viewer colours. Change the baked vertex colours, so
   *  they must key the cache; undefined → the legacy red/grey default bake. */
  colorOuter?: string | undefined;
  colorInner?: string | undefined;
  /** Circular-segment count for THIS bake (the SVG tab requests a coarse 32).
   *  Changes mesh density → must key the cache; undefined → the full default
   *  (256) bake, so the legacy cache key is byte-identical and existing
   *  default-bake entries still hit. */
  segments?: number | undefined;
  /** Segment FLOOR for THIS bake (the SVG "high" requests 256). Raises a part's
   *  hard-coded low `segments` → changes mesh density → must key the cache;
   *  undefined → no floor → the legacy cache key is byte-identical. */
  segmentsFloor?: number | undefined;
  /** Sinusoidal warp baked into the geometry (`amp·sin(z·freq)` on x|y).
   *  Changes the baked vertex positions → must key the cache; undefined →
   *  no warp → the legacy cache key is byte-identical (hashBakeKey drops
   *  undefined option keys). */
  warp?: { amp: number; freq: number; axis: 'x' | 'y' } | undefined;
  /** Crease (minSharpAngle, deg) fed to Manifold.calculateNormals at bake time.
   *  Changes the baked per-vertex normals + the crease vertex-split → must key
   *  the cache so a crease change re-bakes; undefined (the default 60° bake) →
   *  dropped by hashBakeKey → the legacy cache key is byte-identical, so existing
   *  default-bake entries still hit. */
  creaseAngle?: number | undefined;
  /** Build-time "true round silhouette" smoothing (smoothOut+refineToTolerance).
   *  Adds triangles + rounds the silhouette → must key the cache so a round bake
   *  stores separately; undefined (default OFF) → dropped by hashBakeKey → the
   *  legacy cache key is byte-identical, so existing default-bake entries hit. */
  smooth?: { minSharpAngle?: number; tolerance?: number } | undefined;
  /** Hash of this part's RESOLVED dependency sources (its `meta.uses` deps,
   *  walked transitively, sorted by id — see `hashDepSources` in
   *  primitive-loader.ts). Folds dep bodies into the key so editing a DEP
   *  busts the parent's cache even when the parent's OWN body is byte-identical
   *  — the "deja-vu" stale-mesh bug. undefined (leaf part / no resolvable
   *  volume deps) → dropped by hashBakeKey → the legacy cache key is
   *  byte-identical, so existing leaf-part entries still hit. */
  depSourcesHash?: string | undefined;
}

export interface BakeCachePayload {
  /** Serialized full mesh — same shape as serializeComponentResult.full. */
  full: any;
  /** Serialized cutaway mesh (empty when cutaway was skipped). */
  cutVC: any;
  /** True when finalizeManifold skipped the cutaway CSG step. */
  cutawaySkipped?: boolean;
  /** Materializing the prim function and Manifold-compose took this much,
   *  before serialization (informational; helps populate the cached
   *  response's `_t` block with a meaningful "would have been" reading). */
  _t?: Record<string, number>;
}

interface BakeCacheMeta {
  partId: string;
  hash: string;
  params: number[];
  options: BakeCacheOptions;
  cachedAt: number;
  lastAccessAt: number;
  sizeBytes: number;
}

/** Pull the function body out of a `.asm.ts` / `.prim.ts` source. The body
 *  is what runs at bake time; everything outside it (the meta block, the
 *  imports header, the AUTO-GENERATED comment) is presentation. Hashing
 *  the body avoids false misses from random NodeId churn in meta.graph.
 *
 *  For sources that don't carry a recognisable export-function block, we
 *  fall back to hashing the entire source — safer to over-invalidate than
 *  to mis-serve. */
function extractBakeBody(source: string, name: string): string {
  // Match `export function <name>(<args>) { <body> }` with balanced braces
  // (regex with a non-greedy body + the closing brace anchored to a
  // newline + closing brace, which is how composition-emit ends its
  // emitted bodies). Robust for our generated style; the fallback covers
  // hand-edited cases.
  const re = new RegExp(`export\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = source.match(re);
  return m ? m[1] : source;
}

export function hashBakeKey(
  source: string,
  name: string,
  params: number[],
  options: BakeCacheOptions,
  engineHash: string = ENGINE_HASH,
): string {
  const body = extractBakeBody(source, name);
  const h = createHash('sha256');
  // Fold the geometry-engine content hash in FIRST (N4). The injected engine
  // helpers (manifold-helpers / manifold-mesh / warp-spline / render-helpers /
  // stdlib) don't appear in `body`, so without this a fix to one of them would
  // keep hitting the pre-fix cache entry. `engineHash` is a defaulted arg only
  // so tests can drive two engine states without editing real files; production
  // always uses the build-time ENGINE_HASH constant. See src/lib/graph/engine-hash.ts.
  h.update('engine:');
  h.update(engineHash);
  h.update('|');
  h.update(body);
  h.update('|');
  h.update(JSON.stringify(params));
  h.update('|');
  // Stable option-stringification — sort keys so {cutaway, zScale} and
  // {zScale, cutaway} hash identically.
  const sortedOpts = options
    ? Object.keys(options).sort().reduce((acc: any, k) => {
        const v = (options as any)[k];
        if (v !== undefined) acc[k] = v;
        return acc;
      }, {})
    : {};
  h.update(JSON.stringify(sortedOpts));
  return h.digest('hex').slice(0, HASH_LEN);
}

function partCacheDir(partId: string): string {
  if (!PART_ID_RE.test(partId)) {
    throw new Error(`bake-cache: invalid part_id "${partId}"`);
  }
  return volumePath(join(CACHE_DIR, partId));
}

function payloadPath(partId: string, hash: string): string {
  return join(partCacheDir(partId), `${hash}.json`);
}
function metaPath(partId: string, hash: string): string {
  return join(partCacheDir(partId), `${hash}.meta`);
}

/** Look up a cached entry. Returns null on miss / corrupt entry / I/O error
 *  (callers re-bake from scratch on null — safe to fall back). */
export async function readBakeCache(partId: string, hash: string): Promise<BakeCachePayload | null> {
  try {
    const buf = await readFile(payloadPath(partId, hash), 'utf8');
    const payload = JSON.parse(buf) as BakeCachePayload;
    // Touch lastAccessAt for LRU eviction (Phase 3 — for now we just record
    // it; eviction comes later).
    await touchAccess(partId, hash).catch(() => { /* non-fatal */ });
    return payload;
  } catch {
    return null;
  }
}

/** Write a cache entry. ATOMIC via .tmp + rename. */
export async function writeBakeCache(
  partId: string,
  hash: string,
  payload: BakeCachePayload,
  params: number[],
  options: BakeCacheOptions,
): Promise<void> {
  const dir = partCacheDir(partId);
  await mkdir(dir, { recursive: true });
  const target = payloadPath(partId, hash);
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  const json = JSON.stringify(payload);
  await writeFile(tmp, json, 'utf8');
  await rename(tmp, target);

  // Sidecar metadata — best-effort. Failure here doesn't invalidate the
  // payload (the .json is the source of truth).
  const meta: BakeCacheMeta = {
    partId,
    hash,
    params,
    options,
    cachedAt: Date.now(),
    lastAccessAt: Date.now(),
    sizeBytes: Buffer.byteLength(json, 'utf8'),
  };
  await writeFile(metaPath(partId, hash), JSON.stringify(meta), 'utf8').catch(() => { /* non-fatal */ });
}

/** Update the sidecar meta's lastAccessAt for LRU bookkeeping. */
async function touchAccess(partId: string, hash: string): Promise<void> {
  try {
    const buf = await readFile(metaPath(partId, hash), 'utf8');
    const meta = JSON.parse(buf) as BakeCacheMeta;
    meta.lastAccessAt = Date.now();
    await writeFile(metaPath(partId, hash), JSON.stringify(meta), 'utf8');
  } catch { /* missing sidecar — ignore */ }
}

/** Clear options for /api/cache/clear. */
export interface BakeCacheClearOptions {
  /** When set, only that part's entries are cleared. Otherwise the whole
   *  cache root is wiped (Phase 3 will gate that behind a confirmation). */
  partId?: string;
  /** When set with partId, only that single hash is removed. */
  hash?: string;
}

/** Clear cache entries. Returns counts so the caller can report what
 *  was cleared. Tolerant of missing files / dirs. */
export async function clearBakeCache(opts: BakeCacheClearOptions): Promise<{ cleared: number; bytes: number }> {
  let cleared = 0;
  let bytes = 0;

  // Specific hash within a part — delete the pair (payload + meta).
  if (opts.partId && opts.hash) {
    const p = payloadPath(opts.partId, opts.hash);
    const m = metaPath(opts.partId, opts.hash);
    try {
      const s = await stat(p);
      bytes += s.size;
      cleared++;
      await unlink(p);
    } catch { /* missing — ignore */ }
    await unlink(m).catch(() => { /* ignore */ });
    return { cleared, bytes };
  }

  // Part-wide — wipe the part's whole cache directory.
  if (opts.partId) {
    const dir = partCacheDir(opts.partId);
    try {
      const entries = await readdir(dir);
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        try {
          const s = await stat(join(dir, name));
          bytes += s.size;
          cleared++;
        } catch { /* skip */ }
      }
      await rm(dir, { recursive: true, force: true });
    } catch { /* missing dir — nothing to clear */ }
    return { cleared, bytes };
  }

  // Global wipe — used by /api/cache/clear with no params (Phase 3).
  const root = volumePath(CACHE_DIR);
  try {
    const parts = await readdir(root);
    for (const part of parts) {
      const sub = await clearBakeCache({ partId: part });
      cleared += sub.cleared;
      bytes += sub.bytes;
    }
  } catch { /* missing root — nothing to clear */ }
  return { cleared, bytes };
}
