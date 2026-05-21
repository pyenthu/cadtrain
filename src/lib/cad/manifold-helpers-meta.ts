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

/** A transformation OPERATOR — a function that wraps a Manifold and
 *  returns a Manifold. First arg is the part (implicit in the GUI's
 *  chain UI); `props` below describes the SECOND arg's shape (the
 *  configuration: vec3 for mv/rot, scalar for warp, etc.). Tagged
 *  with `@op` in the helpers source. */
export interface OperatorMeta {
  /** Identifier as exported, e.g. `mv`, `rot`. */
  name: string;
  /** Display label for the chain chip — e.g. `Translate`, `Rotate`. */
  label: string;
  /** Description from the `@op` JSDoc tag. */
  desc: string;
  /** Configuration prop. For mv/rot it's a vec3 → emitted as
   *  `[x, y, z]` triple of number inputs. */
  prop: {
    kind: 'vec3';
    /** Per-axis defaults (`[0, 0, 0]` for both translate and rotate). */
    defaults: [number, number, number];
  };
}

/** Per-helper concrete defaults. TypeScript signatures don't carry default
 *  values for non-optional parameters, so we keep them here. Pick values
 *  that render to a reasonable shape on a fresh add. */
const HELPER_DEFAULTS: Record<string, Record<string, number>> = {
  empty: {},
  cyl:   { length: 1.0,   r1: 0.5, r2: 0.5 },
  tube:  { outerR: 0.5, innerR: 0.4, length: 4.0 },
  // Helical thread band — sized for a typical drill-pipe thread.
  helix_band: { od: 4.5, length: 2, tpi: 4, depth: 0.06, profile: 0, taper: 0 },
  // helix_band_v2 / helix_band_v3_extrude moved to volume primitives
  // under <volume>/primitives/<id>/source.ts (2026-05-20).
  profile_extrude: { height: 2, twistDegrees: 0, scaleTop: 1, sides: 5 },
  // revolve takes a JSON-encoded [x,z] contour as a string — no
  // meaningful numeric default. Sentinel zeros let the catalog render.
  revolve: { contourJson: 0, _unused1: 0, _unused2: 0, _unused3: 0, _unused4: 0 },
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

/** Helpers kept in manifold-helpers.ts (still imported by bundle
 *  components / recipes) but HIDDEN from the /primitives bundle list —
 *  superseded by welded volume primitives (e.g. helix_band → r_threads). */
const HIDDEN_FROM_PRIMITIVES = new Set(['helix_band']);

export function discoverHelpers(): HelperMeta[] {
  if (cache) return cache;
  const out: HelperMeta[] = [];
  for (const m of helpersSrc.matchAll(PART_RE)) {
    const desc = m[1].replace(/\s+/g, ' ').trim();
    const name = m[2];
    if (HIDDEN_FROM_PRIMITIVES.has(name)) continue;
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

// ── Operator discovery (@op-tagged helpers) ──────────────────────────────────

/** Same shape as PART_RE but anchored on the `@op` tag. */
const OP_RE = /\/\*\*\s*@op\s+([^*]+?)\s*\*\/\s*export\s+function\s+(\w+)\s*\(([^)]*)\)/g;

/** Display labels keyed by operator function name. Falls back to a
 *  Title-cased version of the name when unmapped. */
const OPERATOR_LABELS: Record<string, string> = {
  mv: 'Translate',
  rot: 'Rotate',
};

let operatorCache: OperatorMeta[] | null = null;

export function discoverOperators(): OperatorMeta[] {
  if (operatorCache) return operatorCache;
  const out: OperatorMeta[] = [];
  for (const m of helpersSrc.matchAll(OP_RE)) {
    const desc = m[1].replace(/\s+/g, ' ').trim();
    const name = m[2];
    out.push({
      name,
      label: OPERATOR_LABELS[name] ?? (name.charAt(0).toUpperCase() + name.slice(1)),
      desc,
      // Every @op-tagged helper today takes (part, vec3). When we add
      // scalar operators (warp amplitude, twist degrees) the prop
      // shape will need a discriminator — extend this when we get there.
      prop: { kind: 'vec3', defaults: [0, 0, 0] },
    });
  }
  operatorCache = out;
  return out;
}
