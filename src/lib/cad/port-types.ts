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

/** A socket's flow direction. */
export type Direction = 'in' | 'out';
/** A single value, or a FLAT list of them (no nested trees — research decision). */
export type Cardinality = 'one' | 'list';
/** The KIND of thing a port carries. */
export type ElemShape = 'scalar' | 'point' | 'op' | 'transform' | 'geometry' | 'object';

export interface PortType {
  /** Nominal id — the wire-compat key. e.g. 'scalar' · 'list<point>' · 'geometry'. */
  id: string;
  elem: ElemShape;
  card: Cardinality;
  /** Human label (menus / tooltips). */
  label: string;
  /** Socket dot colour (render hook). */
  color: string;
  /** Optional glyph drawn near the socket (e.g. '[]' for a list). */
  glyph?: string;
  /** Optional per-type compatibility OVERRIDE. Absent ⇒ the default rule below. */
  feeds?: (target: PortType) => boolean;
}

/**
 * Default compatibility: an OUTPUT of `self` may feed an INPUT slot of `target`
 * iff they carry the same ELEMENT shape, and the cardinality matches OR a single
 * value broadcasts into a list slot (the research's longest-repeat-last lacing).
 * A list never auto-collapses into a single slot.
 */
export function canFeed(self: PortType, target: PortType): boolean {
  if (self.feeds) return self.feeds(target);
  if (self.elem !== target.elem) return false;
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

// ── the 3 core types (PR1) ────────────────────────────────────────────────────
/** A plain number — today's scalar expr output / coord / arg. */
export const PT_SCALAR = registerPortType({
  id: 'scalar', elem: 'scalar', card: 'one', label: 'number', color: '#0e7490',
});
/** A flat list of [r,z] points — the #11 expr-list output → polygon points / extrude profile. */
export const PT_LIST_POINT = registerPortType({
  id: 'list<point>', elem: 'point', card: 'list', label: 'list of points', color: '#4f46e5', glyph: '[]',
});
/** A baked solid — a part / Manifold output feeding a CSG/compose/Output slot. */
export const PT_GEOMETRY = registerPortType({
  id: 'geometry', elem: 'geometry', card: 'one', label: 'geometry', color: '#cc2222',
});
