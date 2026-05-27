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
import { colorForInstance } from '$lib/shared/instance-colors';
import { partHashId } from '$lib/cad/part-id';

export interface PartColorLUT {
  /** hashId → '#rrggbb' (subtractive tools already remapped to body color). */
  idToColor: Record<number, string>;
  /** Primary body hashId (first additive part) — the color for unknown /
   *  anonymous cut surfaces. null when no additive part was recognized. */
  bodyId: number | null;
  /** Body color hex, for the unknown-id fallback. */
  bodyColor: string;
  /** True when there's a usable table → renderer colors by source. */
  active: boolean;
}

const INACTIVE: PartColorLUT = { idToColor: {}, bodyId: null, bodyColor: '#cc2222', active: false };

export function analyzeParts(source: string): PartColorLUT {
  let rec: any;
  try { rec = recognizeComposite(source); } catch { return INACTIVE; }
  const uses = new Set<string>(rec.uses ?? []);
  const instances = (rec.instances ?? []).filter((i: any) => uses.has(i.call));
  if (!instances.length) return INACTIVE;

  let instanceColors: Record<string, string> = {};
  try {
    const meta = evalMetaLiteral(source);
    if (meta?.instanceColors && typeof meta.instanceColors === 'object') instanceColors = meta.instanceColors;
  } catch { /* meta-less / unparseable → palette only */ }

  // Roles from the composition chain(s). An operand referenced by name in a
  // `.subtract(X)` / `.intersect(X)` is a tool; base + `.add(X)` are additive.
  const subtractive = new Set<string>();
  const additiveOrder: string[] = [];
  const collect = (ops: any[] | undefined) => {
    for (const o of ops ?? []) {
      if (!o?.name) continue;
      if (o.op === 'subtract' || o.op === 'intersect') subtractive.add(o.name);
      else additiveOrder.push(o.name); // base (op null) or add
    }
  };
  collect(rec.operands);
  for (const k of Object.keys(rec.chains ?? {})) collect(rec.chains[k]);

  const instNames = new Set<string>(instances.map((i: any) => i.name));
  const bodyName = additiveOrder.find((n) => instNames.has(n)) ?? instances[0].name;
  const bodyId = partHashId(bodyName);
  const bodyColor = colorForInstance(bodyName, instanceColors[bodyName]);

  const idToColor: Record<number, string> = {};
  for (const inst of instances) {
    const id = partHashId(inst.name);
    idToColor[id] = subtractive.has(inst.name)
      ? bodyColor // cut/bore wall reads as the body material
      : colorForInstance(inst.name, instanceColors[inst.name]);
  }
  return { idToColor, bodyId, bodyColor, active: true };
}
