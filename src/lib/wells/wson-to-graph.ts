/**
 * wson-to-graph — the WSON → composition-graph translator.
 *
 * THE point of this module (skill: "the agreed architecture"): a well is drawn
 * ONLY through the CAD graph mechanism, never a bespoke renderer. Every element
 * is a `bw_*` volume part, so a well is just an assembly graph — the same thing
 * `/primitives` bakes, and the same thing `GraphEditorPane` edits. Translate the
 * well into that language and the engines (Manifold · TrueForm · BREP) and the
 * editor come along for free.
 *
 * The output is a REAL `Graph` (`$lib/cad/composition-graph-types`), not a
 * wells-private intermediate, precisely so the well can be saved as a volume
 * `.asm.ts` (carrying `meta.graph`) and mounted with `<GraphEditorPane {id} />`.
 *
 * RUNG 2: every structural section becomes a Call — open holes, cement intervals
 * and casing strings — each placed down-hole by an `Mv` node. Completions and the
 * deviated-survey warp are later rungs.
 *
 * WHY Mv AND NOT A `top` PARAM: only `bw_casing` even declares `top`, and its
 * body ignores it (`mv(solid, [0,0,0])` is hardcoded), so passing `top` silently
 * places every string at surface. Placement therefore lives in the GRAPH, where
 * it is visible and editable, via one `Mv` per element. Z-down: +z is down-hole.
 *
 * NO FALLBACK: an untranslatable well throws `WsonTranslateError`. We never
 * emit a stand-in shape — a wrong well is worse than a visible error.
 */
import type { ArgValue, CallNode, ContainerNode, Graph, GraphNode, MvNode, NodeId, ParamSchema } from '$lib/cad/composition-graph-types';
import { asLiteral, asParam } from '$lib/cad/composition-graph-types';
import { resolveStructural } from './registry';
import type { CasingString, CementInterval, OpenHoleSection, Wson } from './wson';

/** The assembly-level param every generated well exposes, so segment count stays
 *  a single dial on the well rather than a literal baked into each element —
 *  mirrors the hand-built `w_multi_string`. */
export const SEGMENTS_PARAM = 'segments';

/** Matches `w_multi_string`'s dial so generated + hand-built wells look alike. */
const SEGMENTS_SCHEMA: ParamSchema = { default: 24, step: 1 };

/** Derived dimensions carry binary-float noise ((9.625-8.835)/2 = 0.39499…96),
 *  which would land verbatim in the saved `.asm.ts`. Round to a precision far
 *  finer than any real tubular tolerance so the file stays readable + stable. */
const clean = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Thrown when a well cannot be expressed as a graph. Surface it; never draw. */
export class WsonTranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsonTranslateError';
  }
}

const ROOT_ID: NodeId = 'n_root';

/** One translated element: the Call plus the Mv that places it down-hole. */
interface Element {
  call: CallNode;
  mv: MvNode;
}

/** The renderer's fallback outer diameter when no open-hole section covers a
 *  cement interval (`WellSchematic3D`: `cm.od * 1.15`). Mirrored so 3D and the
 *  graph agree on annulus size. */
const CEMENT_NO_HOLE_RATIO = 1.15;

/**
 * Cement fills the annulus between the casing it cements and the hole around it.
 *
 * `CementInterval.od` is the INNER diameter — the casing being cemented, not the
 * outer wall. The sample wells make that unambiguous: their `cementing` OD list
 * is exactly their `ch` OD list. The OUTER diameter is the bit size at the
 * interval's midpoint, which is precisely what `WellSchematic3D` does:
 *
 *     inner = cm.od
 *     outer = outerBitAtDepth((top + bot) / 2) ?? cm.od * 1.15
 *
 * Cross-check: a 9.625" casing cemented in a 12.25" hole → wall 1.3125, the value
 * `w_multi_string` hand-encodes. Mirrored here so the graph and the 3D scene
 * describe the same annulus.
 *
 * @throws WsonTranslateError when the hole is not wider than the casing — a
 *   degenerate annulus we must surface rather than bake inside-out.
 */
function cementDims(wson: Wson, interval: CementInterval, i: number): { od: number; wall: number } {
  const mid = (interval.top + interval.bot) / 2;
  const hole = (wson.oh ?? []).find((o) => mid >= o.top && mid <= o.bot);
  const outer = hole ? hole.bitSize : interval.od * CEMENT_NO_HOLE_RATIO;
  const wall = (outer - interval.od) / 2;
  if (!(wall > 0)) {
    throw new WsonTranslateError(
      `cement interval ${i} has a non-positive annulus (casing od=${interval.od}, hole od=${outer})`,
    );
  }
  return { od: clean(outer), wall: clean(wall) };
}

/** Build the Call + its placing Mv. `top` is the element's down-hole start (m). */
function element(
  idBase: string,
  alias: string,
  src: string,
  args: Record<string, ArgValue>,
  top: number,
): Element {
  const callId = `n_${idBase}`;
  const call: CallNode = { id: callId, type: 'call', src, alias, args };
  const mv: MvNode = {
    id: `n_${idBase}_mv`,
    type: 'mv',
    child: callId,
    // Z-down: a positive z offset moves the element DOWN the hole.
    offset: [asLiteral(0), asLiteral(0), asLiteral(clean(top))],
  };
  return { call, mv };
}

/** Shared arg build for a structural section: od/wall/length off `resolveStructural`
 *  (the ONE existing kind→part+params policy) + the assembly's segments dial. */
function structuralArgs(
  kind: Parameters<typeof resolveStructural>[0],
  dims: Parameters<typeof resolveStructural>[1],
  lengthM: number,
  opts: { wall?: number; segments: boolean },
): Record<string, ArgValue> {
  const { params } = resolveStructural(kind, dims, lengthM);
  const args: Record<string, ArgValue> = {};
  if (params.od != null) args.od = asLiteral(clean(params.od));
  const wall = opts.wall ?? params.wall;
  if (wall != null) args.wall = asLiteral(clean(wall));
  if (params.length != null) args.length = asLiteral(clean(params.length));
  // `bw_prod_tubing` has no segments dial; only wire it where the part declares it.
  if (opts.segments) args.segments = asParam(SEGMENTS_PARAM);
  return args;
}

function requirePositiveLength(what: string, i: number, top: number, bot: number): void {
  if (!(bot > top)) {
    throw new WsonTranslateError(`${what} ${i} has non-positive length (top=${top}, bot=${bot})`);
  }
}

/**
 * Translate a WSON well into a composition graph of `bw_*` Calls.
 *
 * Emission order is OUTER → INNER (open hole, cement, casing), matching the
 * hand-built `w_multi_string` so a generated well reads the same way in the
 * editor and the transparent outer shells render over the inner strings.
 *
 * @throws WsonTranslateError when the well has no structural sections at all, or
 *   any section has non-positive length. Both are authoring errors we must show.
 */
export function wsonToGraph(wson: Wson): Graph {
  const elements: Element[] = [];

  (wson.oh ?? []).forEach((o: OpenHoleSection, i) => {
    requirePositiveLength('open hole', i, o.top, o.bot);
    elements.push(element(
      `oh_${i}`, `OH_${i + 1}`, 'bw_open_hole',
      structuralArgs('openhole', { od: o.bitSize }, o.bot - o.top, { segments: true }),
      o.top,
    ));
  });

  (wson.cementing ?? []).forEach((c: CementInterval, i) => {
    requirePositiveLength('cement interval', i, c.top, c.bot);
    const { od, wall } = cementDims(wson, c, i);
    elements.push(element(
      `cem_${i}`, `CEM_${i + 1}`, 'bw_cement',
      structuralArgs('cement', { od }, c.bot - c.top, { wall, segments: true }),
      c.top,
    ));
  });

  (wson.ch ?? []).forEach((c: CasingString, i) => {
    requirePositiveLength('casing', i, c.top, c.bot);
    elements.push(element(
      `csg_${i}`, `CSG_${i + 1}`, 'bw_casing',
      structuralArgs('casing', { od: c.od, id: c.id }, c.bot - c.top, { segments: true }),
      c.top,
    ));
  });

  if (elements.length === 0) {
    throw new WsonTranslateError(
      'well has no structural sections (oh / cementing / ch are all empty) — nothing to translate',
    );
  }

  const nodes: Record<NodeId, GraphNode> = {};
  for (const { call, mv } of elements) {
    nodes[call.id] = call;
    nodes[mv.id] = mv;
  }
  // The root's children are the assembly's output parts — each element's Mv, not
  // its raw Call (the Call is consumed by the Mv).
  const root: ContainerNode = { id: ROOT_ID, type: 'list', children: elements.map((e) => e.mv.id) };
  nodes[ROOT_ID] = root;

  return {
    nodes,
    root: ROOT_ID,
    // `segments` MUST be declared: the Calls wire their segments slot to
    // `p.segments`, and emit only writes a `meta.params` row (and the geom
    // function's arg) for params the graph declares.
    params: { [SEGMENTS_PARAM]: { ...SEGMENTS_SCHEMA } },
    imports: [...new Set(elements.map((e) => e.call.src))],
    // Denormalised + rebuilt by hydrateGraph (edges via collectEdges, layout via
    // its default grid pass), so an empty seed is correct rather than lossy.
    edges: [],
    layout: {},
  };
}
