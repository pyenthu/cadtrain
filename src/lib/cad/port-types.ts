/**
 * port-types.ts — a typed-socket registry for the node graph (#13).
 *
 * Every socket (input or output) on a node declares a PORT TYPE. Instead of the
 * editor / wire-state / geom / emit each branching per socket KIND, they ask the
 * type: how to draw it (color/glyph), whether a wire is legal (canFeed), and —
 * later — how to splice the value (emitInto, added when the first consumer needs
 * it). Adding a new shape becomes "register a PortType", not a 4-layer sweep.
 *
 * Plan: docs/plans/typed-ports.md. This is PR1 — the pure foundation: the
 * PortType model + registry + the 3 core types. NO wiring is changed yet; the
 * existing ad-hoc sockets adopt it incrementally (PR2+).
 *
 * Pure + DOM-free so emit + the editor can both import it. Type IDENTITY is
 * NOMINAL (compared by `id` string), per the research's "don't start with deep
 * structural/tree typing" guidance.
 */

import {
  checkFeed, listOfPoints, T_SCALAR,
  type StructType, type FeedCheck,
} from './struct-type';

/** A socket's flow direction. */
export type Direction = 'in' | 'out';
/** A single value, or a FLAT list of them (no nested trees — research decision). */
export type Cardinality = 'one' | 'list';
/** The KIND of thing a port carries. */
export type ElemShape = 'scalar' | 'flag' | 'point' | 'op' | 'transform' | 'geometry' | 'object';

/** One field of a COMPOSITE (record) type — a name + the id of its field type. */
export interface FieldDef { name: string; typeId: string; }

export interface PortType {
  /** Nominal id — the wire-compat key. e.g. 'scalar' · 'list<point>' · 'Casing'. */
  id: string;
  elem: ElemShape;
  card: Cardinality;
  /** Human label (menus / tooltips). */
  label: string;
  /** Socket dot colour (render hook). */
  color: string;
  /** Optional glyph drawn near the socket (e.g. '[]' for a list). */
  glyph?: string;
  /** For a LIST type — the id of its element type (e.g. list<Casing>.of = 'Casing'). */
  of?: string;
  /** For a COMPOSITE (record) type — its fields (the "shape definer" output). */
  fields?: FieldDef[];
  /** Optional per-type compatibility OVERRIDE. Absent ⇒ the default rule below. */
  feeds?: (target: PortType) => boolean;
}

/**
 * Default compatibility: an OUTPUT of `self` may feed an INPUT slot of `target` iff
 *   • exact same type id, OR
 *   • PRIMITIVE elems (scalar/point/geometry/…): same elem, and the cardinality
 *     matches OR a single value broadcasts into a list slot (longest-repeat-last),
 *   • OBJECT/record elems: NOMINAL — distinct named records never mix; a single
 *     record only broadcasts into a `list<thatRecord>` slot.
 * A list never auto-collapses into a single slot.
 */
export function canFeed(self: PortType, target: PortType): boolean {
  if (self.feeds) return self.feeds(target);
  if (self.id === target.id) return true;                 // exact type
  if (self.elem !== target.elem) return false;
  if (self.elem === 'object') {
    // record/composite types are nominal — only a one→list<self> broadcast.
    return self.card === 'one' && target.card === 'list' && target.of === self.id;
  }
  // primitive elems — structural by elem + card (with one→list broadcast).
  if (self.card === target.card) return true;
  return self.card === 'one' && target.card === 'list';
}

// ── registry ────────────────────────────────────────────────────────────────
const REGISTRY = new Map<string, PortType>();

/** Register (or replace) a port type. Returns it for `export const PT_X = …`. */
export function registerPortType(pt: PortType): PortType {
  REGISTRY.set(pt.id, pt);
  return pt;
}
/** Look up a port type by id. */
export function portType(id: string): PortType | undefined {
  return REGISTRY.get(id);
}
/** All registered types (menus, generative enumeration). */
export function allPortTypes(): PortType[] {
  return [...REGISTRY.values()];
}
/** Can an output of `outId` wire into an input slot of `inId`? (Unknown id ⇒ no.) */
export function canWire(outId: string, inId: string): boolean {
  const o = REGISTRY.get(outId), i = REGISTRY.get(inId);
  return !!(o && i && canFeed(o, i));
}

// ── composite-type builders (Layer 2 — the "shape definer" API) ───────────────
/**
 * Define a COMPOSITE (record) type — a named struct of fields. This is what the
 * visual shape-definer produces. Nominal: a `Casing` only wires into a `Casing`
 * (or `list<Casing>`) slot, never a structurally-similar other record.
 */
export function defineRecordType(
  id: string, label: string, fields: FieldDef[],
  opts: { color?: string; glyph?: string } = {},
): PortType {
  return registerPortType({
    id, elem: 'object', card: 'one', label,
    color: opts.color ?? '#7c3aed', glyph: opts.glyph, fields,
  });
}

/**
 * Derive (and register) the LIST type for an element type id — `list<Casing>`,
 * `list<point>`, … The list carries the element's elem shape so primitive lists
 * (list<point>) keep structural compat while record lists (list<Casing>) stay
 * nominal. Idempotent; returns the existing type if already registered.
 */
export function listOf(elemTypeId: string): PortType | undefined {
  const id = `list<${elemTypeId}>`;
  const existing = REGISTRY.get(id);
  if (existing) return existing;
  const el = REGISTRY.get(elemTypeId);
  if (!el) return undefined;
  return registerPortType({
    id, elem: el.elem, card: 'list', of: elemTypeId,
    label: `list of ${el.label}`, color: el.color, glyph: '[]',
  });
}

// ── the 3 core types (PR1) ────────────────────────────────────────────────────
/** A plain number — today's scalar expr output / coord / arg. */
export const PT_SCALAR = registerPortType({
  id: 'scalar', elem: 'scalar', card: 'one', label: 'number', color: '#0e7490',
});
/** A boolean toggle. */
export const PT_FLAG = registerPortType({
  id: 'flag', elem: 'flag', card: 'one', label: 'flag (bool)', color: '#16a34a', glyph: '✓',
});
/** A single [r,z] point. */
export const PT_POINT = registerPortType({
  id: 'point', elem: 'point', card: 'one', label: 'point', color: '#4f46e5',
});
/** A flat list of [r,z] points — the #11 expr-list output → polygon points / extrude profile. */
export const PT_LIST_POINT = registerPortType({
  id: 'list<point>', elem: 'point', card: 'list', label: 'list of points', color: '#4f46e5', glyph: '[]',
});
/** A single 3D `[x,y,z]` point. Shares the `point` elem (structurally compatible
 *  with 2D points), so a `list<point3>` can also feed a `list<point>` slot. */
export const PT_POINT3 = registerPortType({
  id: 'point3', elem: 'point', card: 'one', label: '3D point', color: '#7c3aed',
});
/** A baked solid — a part / Manifold output feeding a CSG/compose/Output slot. */
export const PT_GEOMETRY = registerPortType({
  id: 'geometry', elem: 'geometry', card: 'one', label: 'geometry', color: '#cc2222',
});
/** A flat list of baked solids — the future `list<part>` producer output (#38,
 *  docs/plans/complex-params-list-of-parts.md §2). Registration only in Phase 1;
 *  the `parts_map` producer + its wire path land in Phase 3. Nominal (checked by
 *  `canFeed`, geometry is outside the structural model), `[]`-glyphed. */
export const PT_LIST_GEOMETRY = registerPortType({
  id: 'list<geometry>', elem: 'geometry', card: 'list', of: 'geometry',
  label: 'list of geometry', color: PT_GEOMETRY.color, glyph: '[]',
});

// ── arity-specific point lists (typed-expression-outputs, Phase B) ────────────
// `list<point>` (PT_LIST_POINT) is arity-agnostic [r,z]/[x,y]. These two pin the
// coordinate count so a 2D-points output can't silently wire into a 3D-path slot
// (r_sweep.path) and vice-versa. Distinct colours so 2D vs 3D read apart.
/** A list of [x, y] pairs — polygon points, r_sweep.section. */
export const PT_LIST_POINT2 = registerPortType({
  id: 'list<point2>', elem: 'point', card: 'list', of: 'point',
  label: 'list of 2D points', color: '#4f46e5', glyph: '[]',
});
/** A list of [x, y, z] triples — r_sweep.path, a 3D point grid. */
export const PT_LIST_POINT3 = registerPortType({
  id: 'list<point3>', elem: 'point', card: 'list', of: 'point',
  label: 'list of 3D points', color: '#0ea5e9', glyph: '[]',
});

// ── socket colour by inferred structure (Phase B, item 1) ─────────────────────
/**
 * Stable socket colour for an inferred OUTPUT structure — reuses the registry
 * PortType colours so an inferred type and an explicitly-annotated one of the
 * same kind read identically. One colour per STRUCTURAL kind:
 *   scalar → teal · list<point2> → indigo · list<point3> → sky ·
 *   list<number> → cyan · record / list<record> → violet · unknown → slate.
 */
export function structColor(t: StructType | null): string {
  if (!t) return '#94a3b8';                               // unknown / not-yet-built
  switch (t.kind) {
    case 'scalar':  return PT_SCALAR.color;               // teal
    case 'flag':    return PT_FLAG.color;                 // green
    case 'record':  return '#7c3aed';                     // violet (defineRecordType default)
    case 'unknown': return '#94a3b8';                     // slate
    case 'list': {
      if (t.of.kind === 'list' && t.of.of.kind === 'scalar') {
        // a list of points — colour by arity (2D indigo, 3D sky, else generic indigo)
        if (t.of.len === 3) return PT_LIST_POINT3.color;  // sky
        return PT_LIST_POINT.color;                       // indigo (2D / any arity)
      }
      if (t.of.kind === 'scalar') return '#0891b2';       // list<number> — cyan
      if (t.of.kind === 'record') return '#7c3aed';       // list<record> — violet
      return PT_LIST_POINT.color;
    }
  }
}

// ── structural wire-checking (Phase B, item 2) ────────────────────────────────
/** Map a registry PortType to the structural shape a slot of that type expects.
 *  Returns null for types we don't structurally model (geometry, records, …) —
 *  the caller treats null as "allow" (don't over-block). */
function portTypeToExpect(target: PortType): StructType | null {
  switch (target.id) {
    case 'scalar':       return T_SCALAR;
    case 'list<point3>': return listOfPoints(3);
    case 'list<point2>': return listOfPoints(2);
    case 'list<point>':  return listOfPoints();   // any arity
    default:             return null;
  }
}

/**
 * Structural variant of `canFeed` — accepts an INFERRED source StructType (from
 * `struct-type.inferStructure`) rather than a registry PortType, and returns a
 * plain-language reason when the wire is incompatible. Conservative: a null /
 * unknown source, or a target whose shape we don't model, is allowed.
 */
export function canFeedStruct(src: StructType | null, target: PortType): FeedCheck {
  const expect = portTypeToExpect(target);
  if (!expect) return { ok: true, reason: null };
  return checkFeed(src, expect);
}
