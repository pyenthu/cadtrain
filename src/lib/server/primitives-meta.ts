/*
 * Extract the `export const meta = {...}` literal from a volume
 * primitive's source.ts. Volume primitives keep a single canonical
 * file: source.ts holds both the geom function AND the meta schema.
 * Used by /api/primitives/list and /api/primitives/save instead of a
 * separate meta.json on disk (which was prone to drift).
 *
 * Algorithm: regex-anchor on `export const meta`, walk balanced braces
 * to find the literal, esbuild-transpile that snippet to plain JS, run
 * it through `new Function('return (' + js + ')')`. Object literals
 * are pure data — no helpers, no globals, no manifold wasm. Safe.
 *
 * Throws on missing / unparseable meta with an actionable message; the
 * list endpoint catches and skips those primitives so a malformed
 * source.ts can't break the whole catalog.
 */

import { transformSync } from 'esbuild';

export interface PrimMaterialSpec {
  /** Hex color string, e.g. '#cc2222'. */
  color: string;
  metallic?: number;
  roughness?: number;
}
export interface PrimMaterial {
  /** Outer / external surfaces (the main body — what you see from outside). */
  outer: PrimMaterialSpec;
  /** Internal surfaces (bore, cutaway-revealed interior). */
  inner: PrimMaterialSpec;
}

export interface PrimMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  params: Record<string, {
    label?: string;
    /** Render hint for PrimitiveView. Defaults to 'number' (slider + number input).
     *  'boolean' = checkbox; the function receives 0 or 1 positionally.
     *  'polygon' = the Profile tab's SVG canvas. Stored as `[[x,y],...]`;
     *  the function receives the JSON-encoded string at its positional
     *  slot — parse with `JSON.parse(arg)` inside the body. Min 3 verts.
     *  'enum'    = dropdown. Value stored + passed positionally is the
     *  selected option's INDEX (number); `options` lists the labels. */
    type?: 'number' | 'boolean' | 'polygon' | 'enum';
    min?: number;
    max?: number;
    step?: number;
    /** Required for type:'enum' — array of display labels. The function
     *  receives the SELECTED INDEX (0..options.length-1). */
    options?: string[];
    /** Number for 'number'/'boolean'/'enum' params. Array of [x,y] for 'polygon'. */
    default: number | [number, number][];
    unit?: string;
    /** Polygon params only — passed straight through to the ProfileEditor so a
     *  composite's promoted profile renders the same way as the leaf's own
     *  profile param (revolve = (r,z) Z-down half-section w/ axis; extrude =
     *  centred Cartesian). Mirror the leaf's flags when promoting. */
    yDown?: boolean;
    hLabel?: string;
    vLabel?: string;
  }>;
  /** Optional appearance settings baked into the GLB output. When
   *  absent, the bake path falls back to the legacy hardcoded
   *  red/grey look so old primitives keep working. */
  material?: PrimMaterial;
  /** Encapsulated profile DEFAULTS — the Svelte-component model. Profiles
   *  live here (not in `params`, not in the function signature) so the
   *  composition stays clean: it reads `meta.profiles.<name>.value` (or
   *  merges a `props` override over it). The GUI renders each via the
   *  ProfileEditor exactly like a polygon param; `yDown`/`hLabel`/`vLabel`
   *  pick revolve (r,z half-section) vs centred-Cartesian rendering. */
  profiles?: Record<string, {
    label?: string;
    type?: 'polygon';
    yDown?: boolean;
    hLabel?: string;
    vLabel?: string;
    /** The default profile — `[[x,y],...]`. An assembly may override it
     *  per-use by passing `props.<name>`. */
    value: [number, number][];
  }>;
}

const META_DECL_RE = /export\s+const\s+meta\s*=\s*\{/;

/** Locate the `export const meta = { … }` object literal in a source module
 *  and return [braceStart, braceEnd] (inclusive of the closing brace), or null
 *  if there's no meta declaration. Shared by the primitive meta parser and the
 *  profile module split. */
export function metaLiteralRange(src: string): [number, number] | null {
  const declMatch = META_DECL_RE.exec(src);
  if (!declMatch) return null;
  const braceStart = declMatch.index + declMatch[0].length - 1;
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return [braceStart, i]; }
  }
  return null; // unbalanced
}

/** Evaluate the `export const meta = {...}` literal to a plain object. Object
 *  literals are pure data (no helpers/globals/wasm) so this is safe. Throws on
 *  missing/unparseable meta. Used by both primitive AND profile modules — it
 *  does NOT validate field shape (callers pick the fields they need). */
export function evalMetaLiteral(src: string): any {
  const range = metaLiteralRange(src);
  if (!range) {
    // Distinguish "no declaration" from "unbalanced braces" for a clearer error.
    if (!META_DECL_RE.test(src)) throw new Error('source has no `export const meta = {...}` declaration');
    throw new Error('meta literal has unbalanced braces');
  }
  const literal = src.slice(range[0], range[1] + 1);
  let js: string;
  try {
    js = transformSync(`(${literal})`, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
  } catch (e: any) {
    throw new Error(`meta literal transpile failed: ${e?.message ?? e}`);
  }
  // esbuild keeps the wrapping `(...)` parens; eval it back to an object.
  let meta: any;
  try {
    meta = new Function(`"use strict"; return ${js}`)();
  } catch (e: any) {
    throw new Error(`meta literal eval failed: ${e?.message ?? e}`);
  }
  if (!meta || typeof meta !== 'object') {
    throw new Error('meta did not evaluate to an object');
  }
  return meta;
}

export function extractMetaFromSource(src: string): PrimMeta {
  const meta = evalMetaLiteral(src);
  if (!meta.params || typeof meta.params !== 'object') {
    throw new Error('meta.params is required');
  }
  // Normalise the optional material block. Missing pieces fall back
  // to the cadtrain defaults (red outer / grey inner, matte). We
  // accept either the canonical { outer, inner } shape or a single
  // material block (applied to both surfaces) for terse authoring.
  let material: PrimMaterial | undefined;
  if (meta.material && typeof meta.material === 'object') {
    const m = meta.material;
    if (m.outer && m.inner) {
      material = { outer: normSpec(m.outer), inner: normSpec(m.inner) };
    } else if (m.color || m.metallic !== undefined || m.roughness !== undefined) {
      const spec = normSpec(m);
      material = { outer: spec, inner: spec };
    }
  }

  return {
    id: String(meta.id ?? ''),
    name: String(meta.name ?? meta.id ?? ''),
    description: String(meta.description ?? ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    params: meta.params,
    material,
    profiles: meta.profiles && typeof meta.profiles === 'object' ? meta.profiles : undefined,
  };
}

function normSpec(s: any): PrimMaterialSpec {
  return {
    color: typeof s.color === 'string' ? s.color : '#cc2222',
    metallic: typeof s.metallic === 'number' ? s.metallic : 0,
    roughness: typeof s.roughness === 'number' ? s.roughness : 0.7,
  };
}

const FN_NAME_RE = /export\s+function\s+(\w+)\s*\(/;

export function extractFunctionName(src: string): string | null {
  const m = FN_NAME_RE.exec(src);
  return m ? m[1] : null;
}
