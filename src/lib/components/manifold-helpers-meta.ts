/*
 * Discover the user-facing geom helpers exported from manifold-helpers.ts.
 *
 * We tag each helper that should appear in the Inspector's Parts catalog
 * with a JSDoc block that starts with `at-part <description>` (using the
 * literal `@` symbol). This module reads the helpers source as raw text
 * (Vite `?raw` query) and regex-extracts the tagged exports + their
 * signatures.
 *
 * Why source-parse instead of just importing the module:
 *   - We need the SIGNATURE text (parameter names + types) for the Parts
 *     panel — that info is erased at runtime.
 *   - It keeps the catalog "linked to the directory" — adding a new
 *     tagged export to manifold-helpers.ts automatically updates the
 *     Parts picker without any UI edits.
 *
 * Infrastructure exports (initManifold, M, getCutBox, setCircularSegmentMode,
 * the CIRCULAR_SEGMENTS_* constants) intentionally don't carry the tag so
 * they stay hidden from the user-facing catalog.
 *
 * (Plain block comment, not JSDoc — embedding nested JSDoc terminators
 * would close this comment prematurely and leak `at-part` into the TS
 * parser as a decorator.)
 */

import helpersSrc from './manifold-helpers.ts?raw';

export interface HelperMeta {
  /** Identifier as exported, e.g. `cyl`, `tube`. */
  name: string;
  /** Literal text from inside the parentheses of the export — e.g.
   *  `h: number, r1: number, r2?: number`. Used for the catalog card sig. */
  sig: string;
  /** Description text from the `@part` JSDoc tag. */
  desc: string;
}

/** Regex: a JSDoc block carrying `@part <desc>`, immediately followed by
 *  an `export function <name>(<args>)`. Captures name, args, desc. */
const PART_RE = /\/\*\*\s*@part\s+([^*]+?)\s*\*\/\s*export\s+function\s+(\w+)\s*\(([^)]*)\)/g;

let cache: HelperMeta[] | null = null;

export function discoverHelpers(): HelperMeta[] {
  if (cache) return cache;
  const out: HelperMeta[] = [];
  for (const m of helpersSrc.matchAll(PART_RE)) {
    const desc = m[1].replace(/\s+/g, ' ').trim();
    const name = m[2];
    const sig = m[3].replace(/\s+/g, ' ').trim();
    out.push({ name, sig: `${name}(${sig})`, desc });
  }
  cache = out;
  return out;
}
