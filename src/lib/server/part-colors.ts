/**
 * part-colors — build the per-part color lookup for a composite's render.
 *
 * Pairs with `tagInstanceSources` (primitive-loader): the loader stamps
 * each named part with `partHashId(name)`; this derives the matching
 * `hashId → color` table the renderer applies after CSG. The hashId is
 * the transport (survives boolean ops via Manifold's mesh relation); the
 * color is a CLIENT-OWNED, editable prop (`meta.instanceColors[name]`),
 * falling back to the deterministic per-name palette.
 *
 * Role rule (user spec): a part used as a SUBTRACT / INTERSECT tool does
 * not own a color — the surface it creates (the cut/bore wall) takes the
 * BODY's color, so a cutaway reads as one material with a hole, not a
 * differently-colored plug. We implement that by mapping a subtractive
 * part's hashId straight to the body color.
 */
import { recognizeComposite } from './recognize-composite';
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
  let rec: any;
  try { rec = recognizeComposite(source); } catch { return INACTIVE; }
  const uses = new Set<string>(rec.uses ?? []);
  const instances = (rec.instances ?? []).filter((i: any) => uses.has(i.call));
  if (!instances.length) return INACTIVE;

  let instanceColors: Record<string, any> = {};
  try {
    const meta = evalMetaLiteral(source);
    if (meta?.instanceColors && typeof meta.instanceColors === 'object') instanceColors = meta.instanceColors;
  } catch { /* meta-less / unparseable → palette only */ }

  // Roles from the composition chain(s). An operand referenced by name in a
  // `.subtract(X)` / `.intersect(X)` is a tool; base + `.add(X)` are additive.
  const subtractiveNames = new Set<string>();
  const additiveOrder: string[] = [];
  const collect = (ops: any[] | undefined) => {
    for (const o of ops ?? []) {
      if (!o?.name) continue;
      if (o.op === 'subtract' || o.op === 'intersect') subtractiveNames.add(o.name);
      else additiveOrder.push(o.name); // base (op null) or add
    }
  };
  collect(rec.operands);
  for (const k of Object.keys(rec.chains ?? {})) collect(rec.chains[k]);

  const instNames = new Set<string>(instances.map((i: any) => i.name));
  const bodyName = additiveOrder.find((n) => instNames.has(n)) ?? instances[0].name;
  const bodyId = partHashId(bodyName);
  const bodyPair = colorsForInstance(bodyName, instanceColors[bodyName]);

  const outer: Record<number, string> = {};
  const inner: Record<number, string> = {};
  const subtractive: number[] = [];
  for (const inst of instances) {
    const id = partHashId(inst.name);
    const c = colorsForInstance(inst.name, instanceColors[inst.name]);
    outer[id] = c.outer;
    inner[id] = c.inner;
    if (subtractiveNames.has(inst.name)) subtractive.push(id);
  }
  return { outer, inner, subtractive, bodyId, bodyInner: bodyPair.inner, bodyColor: bodyPair.outer, active: true };
}
