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
import { usesOf, fetchDepSource } from './primitive-loader';
import { colorsForInstance, DEFAULT_INNER_COLOR } from '$lib/shared/instance-colors';
import { partHashId } from '$lib/cad/part-id';
import type { PartAppearance } from '$lib/shared/part-appearance';
import type { PartColorLUT } from '$lib/cad/part-lut-types';
export type { PartColorLUT } from '$lib/cad/part-lut-types';

/** A single subpart's OWN appearance, harvested from ITS source `meta`
 *  (`colorOuter`/`colorInner`, falling back to `material.outer/inner.color`).
 *  Keyed by DEP ID (the called function name) in a `DepColorMap`. #86 — this
 *  is what makes a composed part show each subpart in the colour it was
 *  authored with, instead of a palette-by-instance-name colour. */
export interface DepColor {
  outer?: string;
  inner?: string;
  opacity?: number;
  material?: string;
  texture?: string;
}
export type DepColorMap = Record<string, DepColor>;

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function hexOrUndef(v: unknown): string | undefined {
  return (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim().toLowerCase() : undefined;
}
/** Pull a subpart's own {outer, inner} from its meta. `colorOuter`/`colorInner`
 *  win; a `material.outer.color`/`material.inner.color` (or a single
 *  `material.color`) fills whichever side the explicit colour didn't set. */
const MATL_RE = /^(none|steel|aluminum|titanium|brass)$/;
function matPresetOrUndef(v: unknown): string | undefined {
  return (typeof v === 'string' && MATL_RE.test(v.trim())) ? v.trim() : undefined;
}
function textureOrUndef(v: unknown): string | undefined {
  return (typeof v === 'string' && v.trim()) ? v.trim() : undefined;
}

function depColorFromMeta(meta: any): DepColor | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta.material && typeof meta.material === 'object' ? meta.material : undefined;
  const matOuter = hexOrUndef(m?.outer?.color) ?? hexOrUndef(m?.color);
  const matInner = hexOrUndef(m?.inner?.color) ?? hexOrUndef(m?.color);
  const outer = hexOrUndef(meta.colorOuter) ?? matOuter;
  const inner = hexOrUndef(meta.colorInner) ?? matInner;
  const material = (typeof meta.material === 'string' ? matPresetOrUndef(meta.material) : undefined)
    ?? matPresetOrUndef(m?.preset) ?? matPresetOrUndef(m?.name);
  const texture = textureOrUndef(meta.texture);
  // #61 G-MAT1 stage C — a subpart's OWN render opacity (meta.opacity, 0<o<1)
  // rides along so a composed assembly can render that subpart transparent
  // (e.g. bw_open_hole = 0.15) while its siblings stay opaque. Anything ≥1 /
  // non-finite / absent → undefined = fully opaque = byte-identical pre-alpha.
  const o = typeof meta.opacity === 'number' && Number.isFinite(meta.opacity) ? meta.opacity : NaN;
  const opacity = o > 0 && o < 1 ? o : undefined;
  if (!outer && !inner && opacity === undefined && !material && !texture) return undefined;
  return {
    ...(outer ? { outer } : {}),
    ...(inner ? { inner } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(material ? { material } : {}),
    ...(texture ? { texture } : {}),
  };
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
  seen: Set<string> = new Set(),
): Promise<DepColorMap> {
  const out: DepColorMap = {};
  let uses: string[] = [];
  try { uses = usesOf(source); } catch { return out; }
  const unique = [...new Set(uses)].filter((d) => /^[a-z_][a-z0-9_]*$/i.test(d) && !seen.has(d));
  await Promise.all(unique.map(async (dep) => {
    try {
      // Reuse the loader's 30s TTL dep-source cache (fetchDepSource) instead of a
      // raw prod-proxied fetch — this ran UNCACHED on EVERY /api/primitives/compile
      // (colours are computed outside the script cache), costing ~900 ms per
      // composite compile (the "still being compiled" latency on the hidden 3D
      // bake). Cached → a repeat compile pays 0 dep round-trips.
      let s = '';
      try { s = await fetchDepSource(dep, fetchFn); } catch { return; }
      if (!s) return;
      // EFFECTIVE-appearance inheritance (#86): resolve the dep's OWN color-by-
      // source RECURSIVELY, then hand its BODY's effective colour up — so a
      // material set at ANY level carries to the next assembly. A parent still
      // overrides per-instance (its instanceColors win over this inherited dep
      // colour in the parent's analyzeParts). `seen` breaks any use-cycle.
      const depOfDep = await resolveDepColors(s, fetchFn, new Set([...seen, dep]));
      let meta: any = null;
      try { meta = evalMetaLiteral(s); } catch { /* leaf-ish */ }
      const lut = analyzeParts(s, depOfDep);
      const eff = lut.active ? effectiveDepColor(meta, lut, depOfDep) : depColorFromMeta(meta);
      if (eff) out[dep] = eff;
    } catch { /* dep unreadable → palette fallback */ }
  }));
  return out;
}

/** The EFFECTIVE colour a part exports to its PARENT (#86 inheritance): the
 *  BODY's own per-part override ▸ this part's top-level Default (meta.colorOuter)
 *  ▸ the body's dep's effective colour. EXPLICIT only — a body coloured only by
 *  the deterministic palette exports NOTHING (the parent picks for that instance
 *  itself), so palette fallbacks never leak up a level. */
function effectiveDepColor(meta: any, lut: PartColorLUT, depOfDep: DepColorMap): DepColor | undefined {
  const ic = (lut.bodyName && meta?.instanceColors && typeof meta.instanceColors === 'object')
    ? (meta.instanceColors[lut.bodyName] ?? {}) : {};
  const dc = lut.bodyCall ? depOfDep[lut.bodyCall] : undefined;
  const outer = hexOrUndef(ic.outer) ?? hexOrUndef(meta?.colorOuter) ?? dc?.outer;
  const inner = hexOrUndef(ic.inner) ?? hexOrUndef(meta?.colorInner) ?? dc?.inner;
  const icOp = typeof ic.opacity === 'number' && ic.opacity > 0 && ic.opacity < 1 ? ic.opacity : undefined;
  const mOp = typeof meta?.opacity === 'number' && meta.opacity > 0 && meta.opacity < 1 ? meta.opacity : undefined;
  const opacity = icOp ?? mOp ?? dc?.opacity;
  const material = matPresetOrUndef(ic.material) ?? matPresetOrUndef(meta?.material) ?? dc?.material;
  const texture = textureOrUndef(ic.texture) ?? textureOrUndef(meta?.texture) ?? dc?.texture;
  if (!outer && !inner && opacity === undefined && !material && !texture) return undefined;
  return {
    ...(outer ? { outer } : {}),
    ...(inner ? { inner } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(material ? { material } : {}),
    ...(texture ? { texture } : {}),
  };
}

/** Extract a per-instance opacity override (0<o<1) from a parent's stored
 *  instanceColors / partAppearance entry — the parent's explicit pick, which
 *  WINS over the subpart's own meta.opacity. Anything else → undefined. */
function overrideOpacity(entry: unknown): number | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const o = (entry as any).opacity;
  return typeof o === 'number' && Number.isFinite(o) && o > 0 && o < 1 ? o : undefined;
}

function appearanceFromOverride(entry: unknown, dep?: DepColor, colors?: { outer: string; inner: string }): PartAppearance {
  const ic = (entry && typeof entry === 'object') ? entry as Record<string, unknown> : {};
  const outer = hexOrUndef(ic.outer) ?? dep?.outer ?? colors?.outer;
  const inner = hexOrUndef(ic.inner) ?? dep?.inner ?? colors?.inner;
  const opacity = overrideOpacity(entry) ?? dep?.opacity;
  const material = matPresetOrUndef(ic.material) ?? dep?.material;
  const texture = textureOrUndef(ic.texture) ?? dep?.texture;
  return {
    ...(outer ? { colorOuter: outer } : {}),
    ...(inner ? { colorInner: inner } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(material ? { material } : {}),
    ...(texture ? { texture } : {}),
  };
}

function finalizeLut(
  outer: Record<number, string>,
  inner: Record<number, string>,
  opacity: Record<number, number>,
  subtractive: number[],
  bodyId: number | null,
  bodyInner: string,
  bodyColor: string,
  bodyName: string | null,
  bodyCall: string | null,
  names: Record<number, string>,
  appearance: Record<number, PartAppearance>,
): PartColorLUT {
  return {
    outer, inner, opacity, subtractive, bodyId, bodyInner, bodyColor, bodyName, bodyCall,
    names, appearance, active: true,
  };
}

const INACTIVE: PartColorLUT = {
  outer: {}, inner: {}, opacity: {}, subtractive: [], bodyId: null,
  bodyInner: DEFAULT_INNER_COLOR, bodyColor: '#cc2222', bodyName: null, bodyCall: null, active: false,
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
  const opacity: Record<number, number> = {};
  const subtractive: number[] = [];
  const names: Record<number, string> = {};
  const appearance: Record<number, PartAppearance> = {};
  for (const inst of instances) {
    const id = partHashId(inst.name);
    const override = instanceColors[inst.name] ?? depColors?.[inst.call];
    const c = colorsForInstance(inst.name, override);
    outer[id] = c.outer;
    inner[id] = c.inner;
    names[id] = inst.name;
    appearance[id] = appearanceFromOverride(instanceColors[inst.name], depColors?.[inst.call], c);
    // #61 stage C — per-subpart alpha: the parent's explicit override wins,
    // else the subpart's own authored meta.opacity. Absent → opaque (omitted).
    const op = overrideOpacity(instanceColors[inst.name]) ?? depColors?.[inst.call]?.opacity;
    if (op !== undefined) opacity[id] = op;
    if (subtractiveNames.has(inst.name)) subtractive.push(id);
  }
  return finalizeLut(outer, inner, opacity, subtractive, bodyId, bodyPair.inner, bodyPair.outer, bodyName, bodyCall ?? null, names, appearance);
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
  const opacity: Record<number, number> = {};
  const subtractive: number[] = [];
  const names: Record<number, string> = {};
  const appearance: Record<number, PartAppearance> = {};
  for (const name of seen) {
    const id = partHashId(name);
    const c = colorsForInstance(name, instanceColors[name] ?? depColors?.[name]);
    outer[id] = c.outer;
    inner[id] = c.inner;
    names[id] = name;
    appearance[id] = appearanceFromOverride(instanceColors[name], depColors?.[name], c);
    // #61 stage C — per-subpart alpha (the .asm.ts Call alias doubles as the dep
    // id, so depColors[name] is the subpart's own opacity; parent override wins).
    const op = overrideOpacity(instanceColors[name]) ?? depColors?.[name]?.opacity;
    if (op !== undefined) opacity[id] = op;
    if (subtractiveNames.has(name)) subtractive.push(id);
  }
  // In the .asm.ts path the Call node's alias IS the dep fn name (n.fn), so the
  // body's instance name doubles as the dep it calls.
  return finalizeLut(outer, inner, opacity, subtractive, bodyId, bodyPair.inner, bodyPair.outer, bodyName, bodyName, names, appearance);
}
