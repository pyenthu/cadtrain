/*
 * Discover the user-facing geom helpers exported from manifold-helpers.ts.
 *
 * Each helper that should appear in the Inspector's Parts catalog is tagged
 * with a JSDoc block whose first line is `@part <description>`. This module
 * reads the helpers source as raw text (Vite `?raw` query) and regex-
 * extracts the tagged exports + their TypeScript signatures.
 *
 * Beyond the signature string used for the catalog card, this module also
 * parses each parameter into a typed `HelperProp` (name + type + optional
 * marker) and merges in a small per-helper defaults table — the GUI builder
 * needs concrete numeric defaults to emit `const A = tube(0.5, 0.4, 4);`
 * style snippets when a part is dropped in.
 *
 * Infrastructure exports (initManifold, M, getCutBox, setCircularSegmentMode,
 * the CIRCULAR_SEGMENTS_* constants) intentionally don't carry the tag so
 * they stay hidden from the user-facing catalog.
 */

import helpersSrc from './manifold-helpers.ts?raw';

/** One parameter on a helper, parsed from its signature. The GUI builder
 *  uses these to render the per-instance Props panel. */
export interface HelperProp {
  name: string;
  type: 'number';   // every current @part helper takes numbers only
  optional: boolean;
  default: number;  // from HELPER_DEFAULTS below (signature doesn't carry it)
}

export interface HelperMeta {
  /** Identifier as exported, e.g. `cyl`, `tube`. */
  name: string;
  /** Literal text from inside the parentheses of the export — e.g.
   *  `h: number, r1: number, r2?: number`. Used for the catalog card sig. */
  sig: string;
  /** Description text from the `@part` JSDoc tag. */
  desc: string;
  /** Parsed parameter list with defaults — feeds the GUI Props panel. */
  props: HelperProp[];
}

/** Per-helper concrete defaults. TypeScript signatures don't carry default
 *  values for non-optional parameters, so we keep them here. Pick values
 *  that render to a reasonable shape on a fresh add. */
const HELPER_DEFAULTS: Record<string, Record<string, number>> = {
  empty: {},
  cyl:   { h: 1.0,   r1: 0.5, r2: 0.5 },
  tube:  { outerR: 0.5, innerR: 0.4, h: 4.0 },
};

/** Regex: a JSDoc block carrying `@part <desc>`, immediately followed by
 *  an `export function <name>(<args>)`. Captures name, args, desc. */
const PART_RE = /\/\*\*\s*@part\s+([^*]+?)\s*\*\/\s*export\s+function\s+(\w+)\s*\(([^)]*)\)/g;

/** Parse `h: number, r1: number, r2?: number` into typed props. */
function parseProps(sig: string, defaults: Record<string, number>): HelperProp[] {
  if (!sig.trim()) return [];
  return sig.split(',').map((raw): HelperProp => {
    const part = raw.trim();
    const m = /^(\w+)(\??)\s*:\s*(\w+)/.exec(part);
    if (!m) return { name: part, type: 'number', optional: false, default: 0 };
    const [, name, opt /*, type */] = m;
    return {
      name,
      type: 'number',
      optional: opt === '?',
      default: defaults[name] ?? 0,
    };
  });
}

let cache: HelperMeta[] | null = null;

export function discoverHelpers(): HelperMeta[] {
  if (cache) return cache;
  const out: HelperMeta[] = [];
  for (const m of helpersSrc.matchAll(PART_RE)) {
    const desc = m[1].replace(/\s+/g, ' ').trim();
    const name = m[2];
    const argText = m[3].replace(/\s+/g, ' ').trim();
    const defaults = HELPER_DEFAULTS[name] ?? {};
    out.push({
      name,
      sig: `${name}(${argText})`,
      desc,
      props: parseProps(argText, defaults),
    });
  }
  cache = out;
  return out;
}
