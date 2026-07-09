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
 * RUNG 1 (this commit): one casing string → one `bw_casing` Call under a `list`
 * root. Deliberately the smallest slice that proves the whole path end-to-end
 * (WSON → graph → emit → bake → editor). Rung 2 widens it to every section.
 *
 * NO FALLBACK: an untranslatable well throws `WsonTranslateError`. We never
 * emit a stand-in shape — a wrong well is worse than a visible error.
 */
import type { ArgValue, CallNode, ContainerNode, Graph, NodeId, ParamSchema } from '$lib/cad/composition-graph-types';
import { asLiteral, asParam } from '$lib/cad/composition-graph-types';
import { resolveStructural } from './registry';
import type { CasingString, Wson } from './wson';

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

export interface WsonToGraphOptions {
  /** Which `ch` row to translate (rung 1 handles exactly one). Default 0. */
  casingIndex?: number;
}

/** Node ids are DETERMINISTIC (`n_csg_0`), not the editor's random base36 suffix:
 *  re-translating an unchanged well must yield an identical graph, so it diffs
 *  cleanly, golden-tests, and doesn't churn the volume file on every save. */
const casingNodeId = (i: number): NodeId => `n_csg_${i}`;
const ROOT_ID: NodeId = 'n_root';

/** Wall thickness for a casing row: explicit when the row carries an ID, else
 *  left absent so `bw_casing`'s own default applies at bake time. */
function casingArgs(row: CasingString): Record<string, ArgValue> {
  const lengthM = row.bot - row.top;
  // Reuse the ONE existing kind→part+params mapping rather than a second copy of
  // the unit policy (it derives wall from od/id and passes length through in m).
  const { params } = resolveStructural('casing', { od: row.od, id: row.id }, lengthM);

  const args: Record<string, ArgValue> = {};
  if (params.od != null) args.od = asLiteral(clean(params.od));
  if (params.wall != null) args.wall = asLiteral(clean(params.wall));
  if (params.length != null) args.length = asLiteral(clean(params.length));
  // Depth placement rides on the part's own `top` param (bw_casing exposes it),
  // so rung 2 can stack N sections without introducing Mv nodes.
  args.top = asLiteral(clean(row.top));
  args.segments = asParam(SEGMENTS_PARAM);
  return args;
}

/**
 * Translate a WSON well into a composition graph.
 *
 * Rung 1: exactly one `bw_casing` Call, under a `list` root (the root's children
 * are the assembly's output parts — the same shape `w_multi_string` uses).
 *
 * @throws WsonTranslateError when the well has no casing string to translate, or
 *   the selected row has no positive length. Both are authoring errors we must
 *   show, not paper over.
 */
export function wsonToGraph(wson: Wson, opts: WsonToGraphOptions = {}): Graph {
  const idx = opts.casingIndex ?? 0;
  const rows = wson.ch ?? [];
  if (rows.length === 0) {
    throw new WsonTranslateError('well has no casing strings (wson.ch is empty) — nothing to translate');
  }
  const row = rows[idx];
  if (!row) {
    throw new WsonTranslateError(`casingIndex ${idx} out of range (well has ${rows.length} casing string(s))`);
  }
  if (!(row.bot > row.top)) {
    throw new WsonTranslateError(`casing ${idx} has non-positive length (top=${row.top}, bot=${row.bot})`);
  }

  const id = casingNodeId(idx);
  const call: CallNode = {
    id,
    type: 'call',
    src: 'bw_casing',
    alias: `CSG_${idx + 1}`,
    args: casingArgs(row),
  };
  const root: ContainerNode = { id: ROOT_ID, type: 'list', children: [id] };

  return {
    nodes: { [id]: call, [ROOT_ID]: root },
    root: ROOT_ID,
    // `segments` MUST be declared here: the Call wires its segments slot to
    // `p.segments`, and emit only writes a `meta.params` row (and the geom
    // function's positional arg) for params the graph declares. Omit it and the
    // emitted body reads `p.segments` off an assembly that has no such param.
    params: { [SEGMENTS_PARAM]: { ...SEGMENTS_SCHEMA } },
    imports: ['bw_casing'],
    // Denormalised + rebuilt by hydrateGraph (edges via collectEdges, layout via
    // its default grid pass), so an empty seed is correct rather than lossy.
    edges: [],
    layout: {},
  };
}
