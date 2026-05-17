/**
 * Library — the volume-resident component store.
 *
 * Each part is a self-contained DIRECTORY under
 * `<volume>/library/<category>/<id>/`:
 *
 *   library/
 *     test/        <id>/{ component.ts, picture.png, mesh.glb,
 *     basic/                instructions.md, prompts.json, meta.json }
 *     parts/
 *     assemblies/
 *
 * The directory's LOCATION is its category — there is no central index
 * and no metadata map that can drift. `readdir(library/test)` *is* the
 * Test tab. `resolvePart(id)` finds a part's directory anywhere in the
 * 4-category tree; every endpoint resolves paths through it. Moving a
 * part between categories is an atomic `mv` of the whole directory, so
 * the picture / glb / md / prompts all travel with it.
 *
 * `meta.json` carries the FINE classification axis (family for Parts,
 * level for Basic) — a property *within* a tab, distinct from the
 * `export const meta` in component.ts (which is the component's own
 * id/name/params). It lives inside the part directory so it travels on
 * a move too — it just can't drift the way a central map could.
 *
 * The 26 baseline primitives still live in `src/lib/cad/components/`
 * (bundle, client-rendered, classified by families.ts) — this module
 * is only the volume side.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import { join } from 'path';

export const LIBRARY_CATEGORIES = ['test', 'basic', 'parts', 'assemblies'] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export function isLibraryCategory(v: unknown): v is LibraryCategory {
  return typeof v === 'string' && (LIBRARY_CATEGORIES as readonly string[]).includes(v);
}

/** Canonical file names inside a part directory. */
export const PART_FILES = {
  component: 'component.ts',
  picture: 'picture.png',
  mesh: 'mesh.glb',
  instructions: 'instructions.md',
  prompts: 'prompts.json',
  meta: 'meta.json',
} as const;

/** Library-side metadata — lives in `meta.json` inside the part dir.
 *
 *  Two roles:
 *    1. **Identity + schema** (`id` / `name` / `description` / `tags` /
 *       `params`) — what used to live as `export const meta = {...}`
 *       inside `component.ts`. After the grammar-split refactor, the
 *       authoritative copy is here (JSON) so the inspector can edit
 *       the param schema without parsing TS and the AI authoring path
 *       can emit one JSON file instead of a TS file with embedded
 *       schemas. The component.ts source then contains only the geom
 *       function. The loader injects this JSON into the source as
 *       `const meta = {...}` so the existing `defineGeom(meta, fn)`
 *       call still resolves.
 *    2. **Fine classification + assembly toggles** (`family` / `level` /
 *       `autoTranslate` / `instanceColors` / `instanceTopMode` /
 *       `instanceTopOffset`) — properties of the part within a sidebar
 *       tab, separate from its geom. Lives here because moving a part
 *       between categories must keep these intact.
 *
 *  Backward compat: parts that still hold an inline `export const meta`
 *  in their .ts work unchanged — the loader prefers JSON meta when
 *  present and falls back to the source export otherwise. */
export interface PartMeta {
  /** Component id — must match the directory name. Optional in the
   *  JSON because pre-migration parts keep it in the .ts source. */
  id?: string;
  /** Human-readable display name. */
  name?: string;
  /** Free-form description shown in the inspector header. */
  description?: string;
  /** Tags array — used by search + RAG. */
  tags?: string[];
  /** Param schema — record of `{ label, min, max, step, default, unit?, … }`.
   *  Mirrors `ParamSchema` from src/lib/cad/components/index.ts but kept
   *  as `Record<string, unknown>` here because the server doesn't need
   *  the full typed shape — it just round-trips the JSON to the loader
   *  and the inspector. */
  params?: Record<string, Record<string, unknown>>;
  family?: string;
  level?: number;
  /** Assembly-level toggle: when true (default), the inspector
   *  auto-inserts a `mv` transform on every newly-added part so it
   *  stacks below the previous one (Z-down: positive z = below).
   *  Inserted snippet uses live cross-instance refs like
   *  `B = mv(B, [0, 0, A.top + A.length])`. */
  autoTranslate?: boolean;
  /** Per-instance viewer colours, keyed by instance name (`A`, `B`, ...).
   *  Hex strings (`#3b82f6`). Phase A is UI only — inspector surfaces a
   *  swatch + left-border stripe; scene + GLB still render the existing
   *  red-outer / grey-bore convention. Phase B will tint the actual
   *  geometry per instance via a GeomAcc segment refactor. Absent
   *  entries fall back to a hash-by-name palette default at the UI
   *  layer so unset instances still get a distinct colour. */
  instanceColors?: Record<string, string>;
  /** Per-instance placement mode, keyed by instance name (`A`, `B`, ...).
   *  Picks how the loader rewrites this instance's `top:` arg:
   *    - 'stack'   — `top: PREV.top + PREV.length`   (default — append
   *                  below the previous part, current autoTranslate
   *                  behaviour)
   *    - 'overlay' — `top: PREV.top + <offset>`      (nest inside the
   *                  previous part; offset from `instanceTopOffset`)
   *    - 'origin'  — `top: 0`                        (reset to absolute
   *                  top of the assembly, ignore previous)
   *  First instance ignores the mode (it has no previous). Absent
   *  entries default to 'stack' so existing parts keep current
   *  behaviour. Library parts only. */
  instanceTopMode?: Record<string, 'stack' | 'overlay' | 'origin'>;
  /** Offset (number, in part units) for instances whose
   *  `instanceTopMode` is `'overlay'`. Absent / non-finite → 0. */
  instanceTopOffset?: Record<string, number>;
}

export interface ResolvedPart {
  id: string;
  category: LibraryCategory;
  /** Absolute path to the part directory. */
  dir: string;
  /** Absolute path to component.ts (guaranteed to exist). */
  componentPath: string;
  hasPicture: boolean;
  hasGlb: boolean;
  hasInstructions: boolean;
  hasPrompts: boolean;
  /** Parsed meta.json (family / level), or {} when absent/corrupt. */
  meta: PartMeta;
}

const ID_RE = /^[a-z][a-z0-9_]*$/;

// volume.ts pulls `$env/dynamic/private`, which only resolves inside the
// SvelteKit runtime — lazy-import it so this module (and its callers,
// e.g. component-loader) stay importable from plain unit tests.
async function volume() {
  return import('./volume');
}

/** Absolute path to a category directory (may not exist yet). */
export async function categoryDir(cat: LibraryCategory): Promise<string> {
  const { volumePath } = await volume();
  return volumePath(`library/${cat}`);
}

/** Absolute path where a part WOULD live in a given category. The
 *  directory may or may not exist — use resolvePart to find where a
 *  part actually is. */
export async function partDirIn(cat: LibraryCategory, id: string): Promise<string> {
  const { volumePath } = await volume();
  return volumePath(`library/${cat}/${id}`);
}

/** Create the 4 category directories if missing. Idempotent. */
export async function ensureLibrary(): Promise<void> {
  const { ensureDir } = await volume();
  for (const cat of LIBRARY_CATEGORIES) ensureDir(`library/${cat}`);
}

async function readPartMeta(dir: string): Promise<PartMeta> {
  const p = join(dir, PART_FILES.meta);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PartMeta = {};
    // Identity + schema (post-split-grammar — the canonical home for these).
    if (typeof parsed.id === 'string' && /^[a-z][a-z0-9_]*$/.test(parsed.id)) {
      out.id = parsed.id;
    }
    if (typeof parsed.name === 'string') out.name = parsed.name;
    if (typeof parsed.description === 'string') out.description = parsed.description;
    if (Array.isArray(parsed.tags)) {
      const tags: string[] = [];
      for (const t of parsed.tags) if (typeof t === 'string') tags.push(t);
      if (tags.length > 0) out.tags = tags;
    }
    if (parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)) {
      const params: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of Object.entries(parsed.params)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          params[k] = v as Record<string, unknown>;
        }
      }
      if (Object.keys(params).length > 0) out.params = params;
    }
    // Fine classification + assembly toggles.
    if (typeof parsed.family === 'string') out.family = parsed.family;
    if (typeof parsed.level === 'number') out.level = parsed.level;
    if (typeof parsed.autoTranslate === 'boolean') out.autoTranslate = parsed.autoTranslate;
    if (parsed.instanceColors && typeof parsed.instanceColors === 'object') {
      const colors: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.instanceColors)) {
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) colors[k] = v;
      }
      if (Object.keys(colors).length > 0) out.instanceColors = colors;
    }
    if (parsed.instanceTopMode && typeof parsed.instanceTopMode === 'object') {
      const modes: Record<string, 'stack' | 'overlay' | 'origin'> = {};
      for (const [k, v] of Object.entries(parsed.instanceTopMode)) {
        if (v === 'stack' || v === 'overlay' || v === 'origin') modes[k] = v;
      }
      if (Object.keys(modes).length > 0) out.instanceTopMode = modes;
    }
    if (parsed.instanceTopOffset && typeof parsed.instanceTopOffset === 'object') {
      const offs: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.instanceTopOffset)) {
        if (typeof v === 'number' && Number.isFinite(v)) offs[k] = v;
      }
      if (Object.keys(offs).length > 0) out.instanceTopOffset = offs;
    }
    return out;
  } catch {
    return {};
  }
}

async function buildResolved(id: string, cat: LibraryCategory, dir: string): Promise<ResolvedPart> {
  return {
    id,
    category: cat,
    dir,
    componentPath: join(dir, PART_FILES.component),
    hasPicture: existsSync(join(dir, PART_FILES.picture)),
    hasGlb: existsSync(join(dir, PART_FILES.mesh)),
    hasInstructions: existsSync(join(dir, PART_FILES.instructions)),
    hasPrompts: existsSync(join(dir, PART_FILES.prompts)),
    meta: await readPartMeta(dir),
  };
}

/** Find a part's directory across all 4 categories. A part is defined
 *  by the presence of `component.ts`. Returns null if the id isn't a
 *  library part (it may still be a bundle primitive). */
export async function resolvePart(id: string): Promise<ResolvedPart | null> {
  if (!ID_RE.test(id)) return null;
  for (const cat of LIBRARY_CATEGORIES) {
    const dir = await partDirIn(cat, id);
    if (existsSync(join(dir, PART_FILES.component))) {
      return buildResolved(id, cat, dir);
    }
  }
  return null;
}

/** Every part across every category, in stable id order. */
export async function listLibraryParts(): Promise<ResolvedPart[]> {
  const out: ResolvedPart[] = [];
  for (const cat of LIBRARY_CATEGORIES) {
    const dir = await categoryDir(cat);
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const id of entries) {
      if (!ID_RE.test(id)) continue;
      const partDir = join(dir, id);
      if (!existsSync(join(partDir, PART_FILES.component))) continue;
      out.push(await buildResolved(id, cat, partDir));
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Volume-relative path to a part's picture, for serving via /api/volume.
 *  Returns null when the part has no picture.png. */
export function picturePathRel(part: ResolvedPart): string | null {
  if (!part.hasPicture) return null;
  return `library/${part.category}/${part.id}/${PART_FILES.picture}`;
}
