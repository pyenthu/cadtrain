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
import { usesOf } from './primitive-loader';
import { colorsForInstance, DEFAULT_INNER_COLOR } from '$lib/shared/instance-colors';
import { partHashId } from '$lib/cad/part-id';

/** A single subpart's OWN appearance, harvested from ITS source `meta`
 *  (`colorOuter`/`colorInner`, falling back to `material.outer/inner.color`).
 *  Keyed by DEP ID (the called function name) in a `DepColorMap`. #86 — this
 *  is what makes a composed part show each subpart in the colour it was
 *  authored with, instead of a palette-by-instance-name colour. */
export interface DepColor { outer?: string; inner?: string }
export type DepColorMap = Record<string, DepColor>;

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function hexOrUndef(v: unknown): string | undefined {
  return (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim().toLowerCase() : undefined;
}
/** Pull a subpart's own {outer, inner} from its meta. `colorOuter`/`colorInner`
 *  win; a `material.outer.color`/`material.inner.color` (or a single
 *  `material.color`) fills whichever side the explicit colour didn't set. */
function depColorFromMeta(meta: any): DepColor | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta.material && typeof meta.material === 'object' ? meta.material : undefined;
  const matOuter = hexOrUndef(m?.outer?.color) ?? hexOrUndef(m?.color);
  const matInner = hexOrUndef(m?.inner?.color) ?? hexOrUndef(m?.color);
  const outer = hexOrUndef(meta.colorOuter) ?? matOuter;
  const inner = hexOrUndef(meta.colorInner) ?? matInner;
  if (!outer && !inner) return undefined;
  return { ...(outer ? { outer } : {}), ...(inner ? { inner } : {}) };
}

/**
 * #86 — resolve each `meta.uses` dependency's OWN appearance (colour/material)
 * so a composed part can render every subpart in the colour it was authored
 * with. Fetches each unique dep source via `fetchFn` (dev → prod proxy, TTL-
 * cached by the loader), reads its meta, and returns a `depId → {outer,inner}`
 * map. Pass the result to `analyzeParts(source, depColors)`.
 *
 * Fully tolerant: any fetch / parse failure just omits that dep (it falls back
 * to the palette, exactly as today). A leaf part (no `uses`) → `{}` → the LUT
 * is byte-identical to the pre-#86 output.
 */
export async function resolveDepColors(
  source: string,
  fetchFn: typeof globalThis.fetch,
): Promise<DepColorMap> {
  const out: DepColorMap = {};
  let uses: string[] = [];
  try { uses = usesOf(source); } catch { return out; }
  const unique = [...new Set(uses)].filter((d) => /^[a-z_][a-z0-9_]*$/i.test(d));
  await Promise.all(unique.map(async (dep) => {
    try {
      const r = await fetchFn(`/api/primitives/source?name=${encodeURIComponent(dep)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const s = typeof d?.source === 'string' ? d.source : '';
      if (!s) return;
      const c = depColorFromMeta(evalMetaLiteral(s));
      if (c) out[dep] = c;
    } catch { /* dep unreadable → palette fallback */ }
  }));
  return out;
}

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

export function analyzeParts(source: string, depColors?: DepColorMap): PartColorLUT {
  // K.63 ASSEMBLY PATH — `.asm.ts` files carry meta.composition (a TreeNode)
  // instead of the older `const X = …;` instance declarations
  // recognizeComposite scans for. Detect the assembly shape and walk the
  // composition tree separately so the per-instance colour swatches in
  // CompositionEditor actually drive the bake. Without this branch, the
  // K.63 source path 0-instances → INACTIVE → colours are written to
  // meta.instanceColors but never applied at render time.
  let metaForAsm: any = null;
  try { metaForAsm = evalMetaLiteral(source); } catch { /* fall through */ }
  if (metaForAsm?.composition && typeof metaForAsm.composition === 'object') {
    return analyzeAssembly(metaForAsm, depColors);
  }

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
  // #86 colour priority per instance: the PARENT's explicit override
  // (meta.instanceColors[<instanceName>]) wins; else the SUBPART's own authored
  // colour (depColors[<call>]); else the deterministic palette (via
  // colorsForInstance's fallback). `?? undefined` on the dep lookup keeps a leaf
  // / unresolved dep byte-identical to the pre-#86 palette output.
  const bodyCall = instances.find((i: any) => i.name === bodyName)?.call as string | undefined;
  const bodyOverride = instanceColors[bodyName] ?? (bodyCall ? depColors?.[bodyCall] : undefined);
  const bodyPair = colorsForInstance(bodyName, bodyOverride);

  const outer: Record<number, string> = {};
  const inner: Record<number, string> = {};
  const subtractive: number[] = [];
  for (const inst of instances) {
    const id = partHashId(inst.name);
    const override = instanceColors[inst.name] ?? depColors?.[inst.call];
    const c = colorsForInstance(inst.name, override);
    outer[id] = c.outer;
    inner[id] = c.inner;
    if (subtractiveNames.has(inst.name)) subtractive.push(id);
  }
  return { outer, inner, subtractive, bodyId, bodyInner: bodyPair.inner, bodyColor: bodyPair.outer, active: true };
}

/** Per-instance colour LUT for a K.63 .asm.ts source. Each Call node in
 *  meta.composition is an instance — keyed by the alphabetic alias the
 *  CompositionEditor assigned (`A`, `B`, `C`, …) — and the alias is
 *  hashed via partHashId to match the loader's tagInstanceSources stamp.
 *
 *  Subtract/intersect roles are derived by walking the tree: any Call
 *  that sits on the `.arg` side of a method node (or as a child of an
 *  intersect/subtract op anywhere on the tree) is a CSG tool. Tools
 *  take the body colour on their cut surfaces — same rule the primitive
 *  composite path uses. */
function analyzeAssembly(meta: any, depColors?: DepColorMap): PartColorLUT {
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
  // In the .asm.ts path the Call node's alias IS the dep fn name (n.fn), so the
  // instance name doubles as the dep id — depColors[name] is the subpart's own
  // colour. Parent override (instanceColors[name]) still wins. (#86)
  const bodyPair = colorsForInstance(bodyName, instanceColors[bodyName] ?? depColors?.[bodyName]);

  const outer: Record<number, string> = {};
  const inner: Record<number, string> = {};
  const subtractive: number[] = [];
  for (const name of seen) {
    const id = partHashId(name);
    const c = colorsForInstance(name, instanceColors[name] ?? depColors?.[name]);
    outer[id] = c.outer;
    inner[id] = c.inner;
    if (subtractiveNames.has(name)) subtractive.push(id);
  }
  return { outer, inner, subtractive, bodyId, bodyInner: bodyPair.inner, bodyColor: bodyPair.outer, active: true };
}
