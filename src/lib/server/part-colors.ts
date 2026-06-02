/**
 * part-colors — build the per-part color lookup for a composite's render.
 *
 * The K.63 emit path (composition-tree.ts) stamps each Call node with
 * `__tag(<call>, partHashId(alias))` at compose time, so the rendered
 * mesh carries the alias's hashId through Manifold's relation. This
 * module walks the source's `meta.composition` TreeNode and derives the
 * matching `hashId → color` table the renderer applies after CSG.
 *
 * The OLD primitive-composite branch (recognizeComposite-driven, for
 * pre-K.63 `.prim.ts` files with `const X = …` + `return X.add(Y)` chains)
 * was deleted with the old composite editor — primitives without
 * `meta.composition` fall through to the INACTIVE LUT and the renderer
 * uses its material/heuristic path for them.
 *
 * Role rule (user spec): a part used as a SUBTRACT / INTERSECT tool does
 * not own a color — the surface it creates (the cut/bore wall) takes the
 * BODY's color, so a cutaway reads as one material with a hole, not a
 * differently-colored plug. We implement that by mapping a subtractive
 * part's hashId straight to the body color.
 */
import { evalMetaLiteral } from './primitives-meta';
import { colorsForInstance, DEFAULT_INNER_COLOR } from '$lib/shared/instance-colors';
import { partHashId } from '$lib/cad/part-id';

export interface PartColorLUT {
  /** hashId → outer '#rrggbb' (each part's external skin). */
  outer: Record<number, string>;
  /** hashId → inner '#rrggbb' (the colour shown on this part's cut surfaces —
   *  e.g. a subtractive tool's bore wall). */
  inner: Record<number, string>;
  /** hashIds used as subtract/intersect tools → their faces are CUT surfaces
   *  and take the `inner` colour, not `outer`. */
  subtractive: number[];
  /** Primary body hashId (first additive part). null when none recognized. */
  bodyId: number | null;
  /** Primary body's inner colour — the cross-section (SECTION_ID) + unknown
   *  cut-surface fallback. */
  bodyInner: string;
  /** Primary body's outer colour — the unknown additive-surface fallback. */
  bodyColor: string;
  /** True when there's a usable table → renderer colors by source. */
  active: boolean;
}

const INACTIVE: PartColorLUT = {
  outer: {}, inner: {}, subtractive: [], bodyId: null,
  bodyInner: DEFAULT_INNER_COLOR, bodyColor: '#cc2222', active: false,
};

export function analyzeParts(source: string): PartColorLUT {
  // K.63 ASSEMBLY PATH — `.asm.ts` files carry meta.composition (a TreeNode)
  // and the loader's emit wraps each Call with `__tag(..., partHashId(alias))`.
  // Walk the composition tree to enumerate aliases + their CSG role and
  // build the LUT the renderer keys off. Non-assembly sources have no
  // meta.composition → INACTIVE (renderer falls back to material colours).
  let meta: any = null;
  try { meta = evalMetaLiteral(source); } catch { /* unparseable meta — fall through */ }
  if (!meta?.composition || typeof meta.composition !== 'object') return INACTIVE;
  return analyzeAssembly(meta);
}

/** Per-instance colour LUT for a K.63 .asm.ts source. Each Call node in
 *  meta.composition is an instance — keyed by the alphabetic alias the
 *  CompositionEditor assigned (`A`, `B`, `C`, …) — and the alias is
 *  hashed via partHashId to match the loader's tag stamp.
 *
 *  Subtract/intersect roles are derived by walking the tree: any Call
 *  that sits on the `.arg` side of a method node (or as a child of an
 *  intersect/subtract op anywhere on the tree) is a CSG tool. Tools
 *  take the body colour on their cut surfaces. */
function analyzeAssembly(meta: any): PartColorLUT {
  const instanceColors: Record<string, any> =
    (meta?.instanceColors && typeof meta.instanceColors === 'object') ? meta.instanceColors : {};

  // Walk the composition tree to enumerate Call nodes + their role.
  const additiveOrder: string[] = [];
  const subtractiveNames = new Set<string>();
  const seen = new Set<string>();
  const walk = (n: any, parentOp: 'subtract' | 'intersect' | null): void => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'call' && typeof n.fn === 'string') {
      if (!seen.has(n.fn)) {
        seen.add(n.fn);
        if (parentOp) subtractiveNames.add(n.fn);
        else additiveOrder.push(n.fn);
      }
    }
    if (n.type === 'method') {
      const op: 'subtract' | 'intersect' | null =
        (n.op === 'subtract' || n.op === 'intersect') ? n.op : null;
      walk(n.obj, null);          // base of the method (additive)
      walk(n.arg, op);            // arg side is the CSG tool
      return;
    }
    if (n.type === 'list' || n.type === 'stack') {
      for (const c of (n.children ?? [])) walk(c, parentOp);
      return;
    }
    if (n.type === 'overlay') { walk(n.anchor, parentOp); walk(n.child, parentOp); return; }
    if (n.type === 'mv' || n.type === 'rot') { walk(n.child, parentOp); return; }
    // call args may carry nested Calls (rare) — recurse for safety
    if (n.type === 'call') for (const a of (n.args ?? [])) walk(a, parentOp);
  };
  walk(meta.composition, null);

  if (additiveOrder.length === 0 && subtractiveNames.size === 0) return INACTIVE;

  const bodyName = additiveOrder[0] ?? [...subtractiveNames][0]!;
  const bodyId = partHashId(bodyName);
  const bodyPair = colorsForInstance(bodyName, instanceColors[bodyName]);

  const outer: Record<number, string> = {};
  const inner: Record<number, string> = {};
  const subtractive: number[] = [];
  for (const name of seen) {
    const id = partHashId(name);
    const c = colorsForInstance(name, instanceColors[name]);
    outer[id] = c.outer;
    inner[id] = c.inner;
    if (subtractiveNames.has(name)) subtractive.push(id);
  }
  return { outer, inner, subtractive, bodyId, bodyInner: bodyPair.inner, bodyColor: bodyPair.outer, active: true };
}
