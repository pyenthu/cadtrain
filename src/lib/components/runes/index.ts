/**
 * Runes registry — async, API-served.
 *
 * The LIST of available primitives comes from GET /api/runes/list at
 * runtime. The geom FUNCTIONS are still imported via `import.meta.glob`
 * at build time, indexed by id, so geometry execution stays local to
 * the client bundle (no eval, no per-frame network round-trip during
 * slider drags).
 *
 * Why split: server-served list is the source of truth (handles new
 * files added at runtime, will eventually serve from a Railway volume).
 * The geom map stays static for now because shipping new geom code to
 * the client without a bundle rebuild requires the WASM/DSL track in
 * task #21, which is out of scope here.
 *
 * If the API lists an entry whose id has no matching geom in the glob
 * (i.e. the file was added since the last bundle), the entry is still
 * returned but with a placeholder geom that throws — so the sidebar
 * shows the new primitive immediately and the user gets a clear error
 * the moment they try to render it. A page refresh fixes this once
 * Vite has rebundled.
 */

/** Param schema entry — what each primitive declares per parameter. */
export interface ParamSchema {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  type?: 'numeric' | 'shape' | 'thread' | 'custom' | string;
  /** Optional UI grouping. Params with the same `group` render as one
   *  section in the Inspector's Params tab, with the group name as the
   *  section header. Params without a `group` render in a default
   *  "Parameters" section at the top. Order: groups appear in the order
   *  they first occur in the params record. */
  group?: string;
  /** Optional longer-form description surfaced as a tooltip on the
   *  Params tab when the user hovers the label. The label itself stays
   *  short; the description is where you put the "why" or "what does
   *  this control geometrically." */
  description?: string;
}

/** Derived param — a read-only value computed from the user-set params.
 *  Computed BEFORE geom runs, merged into the params bag the geom function
 *  receives, and surfaced as a read-only display in the Inspector's Params
 *  tab. Multiple derived fields resolve in declaration order, so later
 *  derived can read earlier ones from the merged map. */
export interface DerivedSchema {
  label: string;
  unit?: string;
  /** Pure function of the current params (user-set + any derived already
   *  computed in this resolution pass). */
  from: (p: Record<string, number>) => number;
}

/** Metadata exported by every runes file. */
export interface PrimitiveMeta {
  id: string;
  name: string;
  description?: string;
  tags?: readonly string[];
  params: Readonly<Record<string, ParamSchema>>;
  /** Read-only computed params. See DerivedSchema docstring. */
  derived?: Readonly<Record<string, DerivedSchema>>;
  validate?: (p: Record<string, number>) => string[];
  /** Opt-out of the renderer's default Z-centering step in
   *  `finalizeManifold`. When `true`, the geometry is rendered exactly
   *  where the geom function places it (any `.translate(_, _, z)` you
   *  apply sticks). When omitted or `false`, the final manifold's Z
   *  midpoint is pulled to z=0 — the historic behavior, kept as default
   *  so existing primitives don't visually shift. */
  skipCenter?: boolean;
}

/** Geom function signature — pure (p) => Manifold. */
export type GeomFn = (p: Record<string, number>) => any;

/** Registry entry — meta + geom + raw source + instructions doc. */
export interface RunesEntry {
  meta: PrimitiveMeta;
  geom: GeomFn;
  source: string;
  /** Optional instructions.md for this primitive — the slow-evolving
   *  spec the AI refine endpoint reads alongside each prompt. Empty
   *  string when no .md file exists yet. */
  instructions: string;
}

// ── Build-time GEOM map ──────────────────────────────────────────────────
// Eager glob over every .ts in this directory. We only consume the geom
// export here; the meta + source come from the API. Index keyed by id so
// the loader can join.
const geomModules = import.meta.glob<{ meta?: PrimitiveMeta; geom?: GeomFn }>(
  './*.ts',
  { eager: true },
);
const GEOM_BY_ID = new Map<string, GeomFn>();
for (const [path, mod] of Object.entries(geomModules)) {
  if (path === './index.ts') continue;
  if (mod?.meta?.id && typeof mod.geom === 'function') {
    GEOM_BY_ID.set(mod.meta.id, mod.geom);
  }
}

function missingGeom(id: string): GeomFn {
  return () => {
    throw new Error(
      `Primitive "${id}" has no compiled geom in the current bundle — refresh the page to pick up the new file.`,
    );
  };
}

// ── API list response shape (mirrors src/routes/api/runes/list) ───────────
interface ApiEntry {
  id: string;
  name: string;
  description?: string;
  tags?: readonly string[];
  params: Record<string, ParamSchema>;
  hasValidate: boolean;
  source: string;
  /** Content of <id>.md if it exists, else empty string. */
  instructions?: string;
}

/**
 * Fetch the live registry from /api/runes/list and join each entry with
 * its compiled geom from the build-time map. The validate() function is
 * recovered by re-importing the geom module (since validate is part of
 * meta and is not serializable across HTTP).
 */
export async function loadRunesRegistry(fetchFn: typeof fetch = fetch): Promise<RunesEntry[]> {
  const r = await fetchFn('/api/runes/list', { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`/api/runes/list failed: ${r.status} ${r.statusText}`);
  const list = (await r.json()) as ApiEntry[];

  return list.map((api) => {
    const mod = geomModules[`./${api.id}.ts`];
    const geom = (mod?.geom as GeomFn | undefined) ?? GEOM_BY_ID.get(api.id) ?? missingGeom(api.id);
    const validate = api.hasValidate ? mod?.meta?.validate : undefined;
    // `derived` is a record of functions — not serializable, so the API
    // response doesn't carry it. Pick it up from the build-time module
    // instead. (Same path the geom function takes.)
    const derived = mod?.meta?.derived;
    const skipCenter = mod?.meta?.skipCenter === true;
    const meta: PrimitiveMeta = {
      id: api.id,
      name: api.name,
      description: api.description,
      tags: api.tags,
      params: api.params,
      ...(validate ? { validate } : {}),
      ...(derived ? { derived } : {}),
      ...(skipCenter ? { skipCenter: true } : {}),
    };
    return { meta, geom, source: api.source, instructions: api.instructions ?? '' };
  });
}

/** Convenience: build the default-params object from a primitive's meta. */
export function defaultsFor(meta: PrimitiveMeta): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(meta.params)) out[k] = v.default;
  return out;
}

/**
 * Synchronous registry access for code paths that can't await — namely
 * `buildPrimitiveManifold` in builder.ts, which is called from the build
 * pipeline. Falls back to an empty array; the GEOM_BY_ID map is the
 * authoritative dispatch table for that synchronous path. Use
 * loadRunesRegistry for everything async / UI-driven.
 */
export const RUNES_REGISTRY: RunesEntry[] = [];
for (const [path, mod] of Object.entries(geomModules)) {
  if (path === './index.ts') continue;
  if (mod?.meta && typeof mod.geom === 'function') {
    RUNES_REGISTRY.push({ meta: mod.meta, geom: mod.geom, source: '', instructions: '' });
  }
}

/** Lookup a geom by id — used by buildPrimitiveManifold's synchronous
 *  dispatch. Async UI code should use loadRunesRegistry instead. */
export function geomById(id: string): GeomFn | undefined {
  return GEOM_BY_ID.get(id);
}

/** Lookup the build-time meta for a primitive by id. Used by the
 *  derived-param resolver so buildPrimitiveManifold can pre-compute
 *  derived values before invoking geom. */
const META_BY_ID = new Map<string, PrimitiveMeta>();
for (const entry of RUNES_REGISTRY) META_BY_ID.set(entry.meta.id, entry.meta);
export function metaById(id: string): PrimitiveMeta | undefined {
  return META_BY_ID.get(id);
}

/** Compute every `meta.derived` entry against the user-set params and
 *  return a NEW params object that merges user + derived. Skips entries
 *  whose `from()` throws (the params bag stays partial — geom can decide
 *  whether to tolerate a NaN/undefined). Resolution order = declaration
 *  order in the meta, so later derived can read earlier ones. */
export function resolveDerived(
  meta: PrimitiveMeta,
  params: Record<string, number>,
): Record<string, number> {
  if (!meta.derived) return params;
  const out: Record<string, number> = { ...params };
  for (const [k, schema] of Object.entries(meta.derived)) {
    try { out[k] = schema.from(out); } catch { /* leave unset */ }
  }
  return out;
}

/** Maps a meta's `params` + `derived` keys into a typed record of
 *  numbers so the geom builder can destructure `({ od, wall, … })`
 *  with TS inference instead of writing `p.od`, `p.wall`, … against
 *  an untyped `Record<string, number>`. */
type ParamsOf<M> =
  (M extends { params: infer P } ? { [K in keyof P]: number } : Record<string, never>) &
  (M extends { derived: infer D } ? { [K in keyof D]: number } : Record<string, never>);

/**
 * Sugar for the verbose `(p) => { const x = p.foo; … }` geom shape.
 *
 *   export const geom = defineGeom(meta, ({ od, wall, length }) => {
 *     return tube(od/2, od/2 - wall, length);
 *   });
 *
 * The first arg (`_meta`) is only present to bind the generic so the
 * destructure is typed against the params + derived keys declared in
 * `meta`. It is NOT read at runtime — the existing builder pipeline
 * still calls `resolveDerived(meta, params)` before invoking geom, so
 * derived values are already in the bag by the time `build` runs.
 *
 * Return type stays `GeomFn` so the loader (`import.meta.glob`) and
 * the regex-based `/api/runes/list` parser see exactly the same
 * `export const geom = …` shape they see today. No infrastructure
 * changes required.
 */
export function defineGeom<
  M extends { params: Record<string, ParamSchema>; derived?: Record<string, DerivedSchema> },
>(
  _meta: M,
  build: (p: ParamsOf<M> & Record<string, number>) => any,
): GeomFn {
  return (p) => build(p as ParamsOf<M> & Record<string, number>);
}
