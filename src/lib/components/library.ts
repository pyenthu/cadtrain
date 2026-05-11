/**
 * Component Library — Parametric primitives for downhole tools
 *
 * Each component is a function that takes params → ManifoldCAD geometry.
 * Components can be composed into sub-assemblies and full tools.
 */

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

export interface ComponentDef {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];       // alternate names / roles this shape can play
  params: Record<string, ParamDef>;
  defaults: Record<string, number>;
  /** Optional parent primitive id. When set, this entry is a SPECIALIZATION
   *  of the parent — same builder geometry, but with the parameter ranges
   *  narrowed / fixed to match a specific industry spec. Rendered as an
   *  indented child of the parent in the sidebar. Example: thread_eue
   *  inherits from threaded_box with API EUE-specific dimensions. */
  parent?: string;
}

export interface ParamDef {
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

// ═══════════════════════════════════════════════
// COMPONENT DEFINITIONS
// ═══════════════════════════════════════════════
// COMPONENTS is the final exported list. It's built in two steps:
//   1. BASE_COMPONENTS — hand-authored entries (true primitives + a few
//      special-case derivations that don't fit the variant generator).
//   2. Generated variations — driven by VARIATION_SPECS, expanded via
//      deriveVariation(parent, spec). Each generated entry inherits the
//      parent's param schema + builder geometry and overrides only the
//      pieces that distinguish the variant (defaults, optional param
//      ranges, names, tags). Builder dispatch walks the `parent` chain
//      so no new builder function is needed per variant.

const BASE_COMPONENTS: ComponentDef[] = [
  // --- CYLINDERS ---
  {
    id: "hollow_cylinder",
    name: "Hollow Cylinder",
    category: "basic",
    description: "Plain tube — the fundamental building block",
    tags: ["mandrel", "sleeve", "body", "tube", "pup joint", "sub", "coupling"],
    params: {
      od: { label: "OD", min: 0.5, max: 6, step: 0.1, unit: "in" },
      wall: { label: "Wall", min: 0.05, max: 1, step: 0.05, unit: "in" },
      length: { label: "Length", min: 0.5, max: 15, step: 0.1, unit: "in" },
    },
    defaults: { od: 2.5, wall: 0.3, length: 4.0 },
  },
  {
    id: "threaded_box",
    name: "Threaded Box (Female)",
    category: "basic",
    description: "Internal threads — receives a pin end. Generic primitive; specific connection forms (EUE, LTC, REG, NEW VAM…) compose this with a body and per-spec thread profile.",
    tags: ["box connection", "box end", "female connection", "receiver", "coupling box", "generic_end", "connection", "thread"],
    params: {
      od: { label: "OD", min: 0.5, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      length: { label: "Length", min: 0.5, max: 6, step: 0.1 },
      threadCount: { label: "Threads", min: 2, max: 20, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.15, step: 0.01 },
    },
    defaults: { od: 3.0, wall: 0.5, length: 2.5, threadCount: 8, threadDepth: 0.08 },
  },
  {
    id: "threaded_pin",
    name: "Threaded Pin (Male)",
    category: "basic",
    description: "External threads — inserts into a box end. Generic primitive; specific connection forms (EUE, LTC, REG, NEW VAM…) compose this with a body and per-spec thread profile.",
    tags: ["pin connection", "pin end", "male connection", "connector pin", "thread nose", "generic_end", "connection", "thread"],
    params: {
      od: { label: "OD", min: 0.5, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      length: { label: "Length", min: 0.5, max: 6, step: 0.1 },
      threadCount: { label: "Threads", min: 2, max: 20, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.15, step: 0.01 },
    },
    defaults: { od: 2.5, wall: 0.3, length: 2.0, threadCount: 10, threadDepth: 0.06 },
  },

  {
    id: "thread_if",
    name: "IF (Internal Flush)",
    category: "connection",
    description: "Internal flush — smooth bore through connection, no ID restriction",
    tags: ["IF", "internal flush", "flush joint", "drill pipe"],
    params: {
      bodyOD: { label: "Body OD", min: 1, max: 6, step: 0.1 },
      pinOD: { label: "Pin OD", min: 0.8, max: 5, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      bodyLength: { label: "Body Length", min: 1, max: 8, step: 0.1 },
      pinLength: { label: "Pin Length", min: 0.5, max: 4, step: 0.1 },
      threadCount: { label: "Threads", min: 4, max: 20, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.10, step: 0.01 },
    },
    defaults: { bodyOD: 3.2, pinOD: 3.0, wall: 0.3, bodyLength: 3.5, pinLength: 2.5, threadCount: 14, threadDepth: 0.05 },
  },
  {
    id: "thread_fh",
    name: "FH (Full Hole)",
    category: "connection",
    description: "Full hole — larger bore, moderate upset, balanced strength",
    tags: ["FH", "full hole", "drill collar connection"],
    params: {
      bodyOD: { label: "Body OD", min: 1, max: 6, step: 0.1 },
      pinOD: { label: "Pin OD", min: 0.8, max: 5, step: 0.1 },
      wall: { label: "Wall", min: 0.15, max: 1, step: 0.05 },
      bodyLength: { label: "Body Length", min: 1, max: 8, step: 0.1 },
      pinLength: { label: "Pin Length", min: 0.5, max: 3, step: 0.1 },
      threadCount: { label: "Threads", min: 4, max: 16, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.10, step: 0.01 },
      shoulderWidth: { label: "Shoulder Width", min: 0.1, max: 0.6, step: 0.05 },
    },
    defaults: { bodyOD: 3.8, pinOD: 3.0, wall: 0.4, bodyLength: 3.0, pinLength: 1.8, threadCount: 10, threadDepth: 0.06, shoulderWidth: 0.3 },
  },
  {
    id: "thread_nc",
    name: "NC (Numbered Connection)",
    category: "connection",
    description: "Numbered connection — heavy-duty, wide shoulder, thick wall",
    tags: ["NC", "numbered connection", "NC38", "NC50", "BHA connection"],
    params: {
      bodyOD: { label: "Body OD", min: 2, max: 8, step: 0.1 },
      pinOD: { label: "Pin OD", min: 1, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.2, max: 1.5, step: 0.05 },
      bodyLength: { label: "Body Length", min: 1, max: 6, step: 0.1 },
      pinLength: { label: "Pin Length", min: 0.5, max: 3, step: 0.1 },
      threadCount: { label: "Threads", min: 4, max: 14, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.03, max: 0.12, step: 0.01 },
      shoulderWidth: { label: "Shoulder Width", min: 0.15, max: 0.8, step: 0.05 },
    },
    defaults: { bodyOD: 4.5, pinOD: 3.2, wall: 0.5, bodyLength: 2.5, pinLength: 1.5, threadCount: 8, threadDepth: 0.08, shoulderWidth: 0.45 },
  },
  {
    id: "thread_eue",
    name: "EUE (External Upset End)",
    category: "basic",
    description: "Tubing connection — upset end thicker than body for thread strength. Specialization of threaded_box with API EUE-specific dimensions.",
    tags: ["EUE", "external upset", "tubing connection", "API tubing"],
    parent: "threaded_box",
    params: {
      bodyOD: { label: "Body OD", min: 1, max: 5, step: 0.1 },
      upsetOD: { label: "Upset OD", min: 1.5, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 0.8, step: 0.05 },
      bodyLength: { label: "Body Length", min: 2, max: 10, step: 0.1 },
      upsetLength: { label: "Upset Length", min: 0.5, max: 3, step: 0.1 },
      threadCount: { label: "Threads", min: 4, max: 16, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.10, step: 0.01 },
      taperH: { label: "Taper Height", min: 0.1, max: 0.5, step: 0.05 },
    },
    defaults: { bodyOD: 2.375, upsetOD: 2.875, wall: 0.25, bodyLength: 4.0, upsetLength: 1.5, threadCount: 10, threadDepth: 0.05, taperH: 0.2 },
  },
  {
    id: "thread_ltc",
    name: "LTC (Long Thread Coupled)",
    category: "connection",
    description: "Casing connection — long thread for deep wells, coupling required",
    tags: ["LTC", "long thread", "casing connection", "API casing"],
    params: {
      od: { label: "OD", min: 2, max: 10, step: 0.1 },
      wall: { label: "Wall", min: 0.15, max: 1, step: 0.05 },
      length: { label: "Length", min: 2, max: 8, step: 0.1 },
      threadCount: { label: "Threads", min: 8, max: 24, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.10, step: 0.01 },
      couplingOD: { label: "Coupling OD", min: 2, max: 12, step: 0.1 },
      couplingLength: { label: "Coupling Length", min: 0.5, max: 3, step: 0.1 },
    },
    defaults: { od: 5.5, wall: 0.35, length: 4.0, threadCount: 16, threadDepth: 0.05, couplingOD: 6.05, couplingLength: 1.5 },
  },

  // --- TRANSITIONS ---
  {
    id: "taper",
    name: "Taper (Cone)",
    category: "basic",
    description: "Smooth diameter transition between two sections. Doubles as setting/release cones in packer assemblies — same geometry, different role.",
    tags: ["cone", "swage", "reducer", "expander", "transition", "setting cone", "hold-down cone", "release cone", "wedge"],
    params: {
      odTop: { label: "OD Top", min: 0.5, max: 6, step: 0.1 },
      odBottom: { label: "OD Bottom", min: 0.5, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.05, max: 1, step: 0.05 },
      length: { label: "Length", min: 0.2, max: 4, step: 0.1 },
    },
    defaults: { odTop: 2.0, odBottom: 3.0, wall: 0.3, length: 0.8 },
  },
  {
    id: "shoulder",
    name: "Shoulder (Step)",
    category: "transition",
    description: "Abrupt diameter change — bearing surface",
    tags: ["step", "upset", "landing shoulder", "stop ring", "bearing face"],
    params: {
      odSmall: { label: "Small OD", min: 0.5, max: 4, step: 0.1 },
      odLarge: { label: "Large OD", min: 1, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      smallLength: { label: "Small Length", min: 0.5, max: 6, step: 0.1 },
      largeLength: { label: "Large Length", min: 0.5, max: 6, step: 0.1 },
      taperH: { label: "Taper Height", min: 0, max: 0.5, step: 0.05 },
    },
    defaults: { odSmall: 2.0, odLarge: 3.0, wall: 0.3, smallLength: 3.0, largeLength: 2.0, taperH: 0.15 },
  },

  // --- FEATURES ---
  {
    id: "slotted_cylinder",
    name: "Slotted Cylinder",
    category: "basic",
    description: "Tube with longitudinal or circumferential slots",
    tags: ["collet", "drag spring", "port sub", "flow port", "vent sub"],
    params: {
      od: { label: "OD", min: 0.5, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.05, max: 1, step: 0.05 },
      length: { label: "Length", min: 1, max: 10, step: 0.1 },
      numSlots: { label: "Slots", min: 1, max: 12, step: 1 },
      slotWidth: { label: "Slot Width", min: 0.05, max: 0.5, step: 0.05 },
      slotDepth: { label: "Slot Depth", min: 0.05, max: 0.5, step: 0.05 },
    },
    defaults: { od: 2.5, wall: 0.3, length: 4.0, numSlots: 4, slotWidth: 0.15, slotDepth: 0.2 },
  },
  {
    id: "seal_bore",
    name: "Seal Bore (Polished)",
    category: "basic",
    description: "Smooth internal bore with seal grooves",
    tags: ["PBR", "polished bore receptacle", "seal assembly", "sealbore extension"],
    params: {
      od: { label: "OD", min: 0.5, max: 6, step: 0.1 },
      boreID: { label: "Bore ID", min: 0.3, max: 4, step: 0.1 },
      length: { label: "Length", min: 1, max: 10, step: 0.1 },
      numGrooves: { label: "Grooves", min: 0, max: 8, step: 1 },
      grooveDepth: { label: "Groove Depth", min: 0.02, max: 0.1, step: 0.01 },
      grooveWidth: { label: "Groove Width", min: 0.05, max: 0.3, step: 0.05 },
    },
    defaults: { od: 2.8, boreID: 2.0, length: 3.0, numGrooves: 3, grooveDepth: 0.05, grooveWidth: 0.1 },
  },
  {
    id: "grooved_cylinder",
    name: "Grooved Cylinder",
    category: "basic",
    description: "External circumferential grooves (for seals, snap rings)",
    tags: ["snap ring groove", "lock ring", "seal groove", "profile nipple", "landing nipple"],
    params: {
      od: { label: "OD", min: 0.5, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      length: { label: "Length", min: 1, max: 8, step: 0.1 },
      numGrooves: { label: "Grooves", min: 1, max: 12, step: 1 },
      grooveDepth: { label: "Groove Depth", min: 0.02, max: 0.15, step: 0.01 },
    },
    defaults: { od: 2.5, wall: 0.3, length: 3.0, numGrooves: 4, grooveDepth: 0.08 },
  },

  // --- MECHANICAL ---
  {
    id: "slips",
    name: "Slip Assembly",
    category: "basic",
    description: "Segmented gripping ring with sawtooth profile",
    tags: ["slip", "grip", "anchor", "hold-down", "drag block"],
    params: {
      slipOD: { label: "Slip OD", min: 1, max: 6, step: 0.1 },
      bodyOD: { label: "Body OD (inner)", min: 0.5, max: 4, step: 0.1 },
      height: { label: "Height", min: 0.5, max: 4, step: 0.1 },
      numSectors: { label: "Sectors", min: 2, max: 8, step: 1 },
      numGrooves: { label: "Grooves", min: 4, max: 20, step: 1 },
      grooveDepth: { label: "Groove Depth", min: 0.02, max: 0.15, step: 0.01 },
      gapWidth: { label: "Gap Width", min: 0.05, max: 0.3, step: 0.05 },
      smoothBand: { label: "Smooth Band %", min: 0, max: 0.3, step: 0.05 },
    },
    defaults: { slipOD: 2.8, bodyOD: 2.0, height: 2.0, numSectors: 4, numGrooves: 12, grooveDepth: 0.08, gapWidth: 0.1, smoothBand: 0.1 },
  },
  {
    id: "j_latch",
    name: "J-Latch Profile",
    category: "basic",
    description: "J-slot mechanism for lock/unlock rotation",
    tags: ["j-slot", "ratch-latch", "lock mandrel", "locator", "running tool"],
    params: {
      od: { label: "OD", min: 0.5, max: 4, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 0.8, step: 0.05 },
      length: { label: "Length", min: 0.5, max: 3, step: 0.1 },
      slotWidth: { label: "Slot Width", min: 0.05, max: 0.3, step: 0.05 },
      slotDepth: { label: "Slot Depth", min: 0.1, max: 0.5, step: 0.05 },
      numSlots: { label: "J-Slots", min: 1, max: 4, step: 1 },
    },
    defaults: { od: 2.2, wall: 0.3, length: 1.5, slotWidth: 0.15, slotDepth: 0.25, numSlots: 2 },
  },
  {
    id: "packer_element",
    name: "Packer Element",
    category: "mechanical",
    description: "Elastomer sealing element — expands to seal annulus",
    tags: ["rubber element", "elastomer", "seal element", "swab cup", "packer rubber"],
    params: {
      odCompressed: { label: "OD (set)", min: 1, max: 6, step: 0.1 },
      odExpanded: { label: "OD (expanded)", min: 2, max: 8, step: 0.1 },
      mandrelOD: { label: "Mandrel OD", min: 0.5, max: 3, step: 0.1 },
      length: { label: "Length", min: 0.5, max: 4, step: 0.1 },
      numRings: { label: "Rings", min: 1, max: 5, step: 1 },
    },
    defaults: { odCompressed: 2.5, odExpanded: 4.0, mandrelOD: 1.5, length: 2.0, numRings: 3 },
  },
];

// ═══════════════════════════════════════════════
// VARIATION GENERATOR
// ═══════════════════════════════════════════════

/** Delta spec for a generated variation. Only `id`, `name`, `parent`, and
 *  `defaults` are required; the rest are merged onto the parent. Tags from
 *  `tagsAdd` are appended after the parent's tags, so the variant remains
 *  discoverable by both its own name and the parent's vocabulary. */
export interface VariationSpec {
  id: string;
  name: string;
  parent: string;
  defaults: Record<string, number>;
  /** Optional per-param overrides — narrow ranges, change step, etc.
   *  Anything omitted inherits from the parent. */
  paramOverrides?: Partial<Record<string, Partial<ParamDef>>>;
  /** Description override; defaults to "<parent.description> — <variant.name>". */
  description?: string;
  /** Tags appended to the parent's tags. */
  tagsAdd?: string[];
  /** Category override; defaults to the parent's category. */
  category?: string;
}

/** Build a derived ComponentDef from a base + a variation spec. Throws if
 *  the parent isn't in BASE_COMPONENTS. The result carries `parent: base.id`
 *  so sidebar nesting + builder fallback both work transparently. */
function deriveVariation(spec: VariationSpec): ComponentDef {
  const base = BASE_COMPONENTS.find((c) => c.id === spec.parent);
  if (!base) throw new Error(`deriveVariation: unknown parent "${spec.parent}"`);
  const params: Record<string, ParamDef> = {};
  for (const k of Object.keys(base.params)) {
    params[k] = { ...base.params[k], ...(spec.paramOverrides?.[k] ?? {}) };
  }
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category ?? base.category,
    description: spec.description ?? `${base.description} Specialization: ${spec.name}.`,
    tags: [...base.tags, ...(spec.tagsAdd ?? [])],
    params,
    defaults: { ...base.defaults, ...spec.defaults },
    parent: spec.parent,
  };
}

// API box/pin variants — STC / LTC / BTC for both genders. The 6 variants
// share two parents (threaded_box, threaded_pin) so the spec table is just
// the dimension-and-name delta from each parent's defaults.
const VARIATION_SPECS: VariationSpec[] = [
  // --- threaded_box children ---
  {
    id: 'box_stc', name: 'STC Box (Short Thread Casing)', parent: 'threaded_box',
    description: 'Short-thread coupled box for casing — fewer threads, compact body. Specialization of threaded_box with API STC dimensions.',
    tagsAdd: ['STC', 'short thread casing', 'API STC', 'casing box', 'coupling'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2 },
      length: { min: 1.2, max: 3 }, threadCount: { min: 6, max: 12 },
      threadDepth: { min: 0.03, max: 0.08 },
    },
    defaults: { od: 5.5, wall: 0.35, length: 1.8, threadCount: 8, threadDepth: 0.05 },
  },
  {
    id: 'box_ltc', name: 'LTC Box (Long Thread Casing)', parent: 'threaded_box',
    description: 'Long-thread coupled box for deep-well casing — more thread engagement, longer body. Specialization of threaded_box with API LTC dimensions.',
    tagsAdd: ['LTC', 'long thread casing', 'API LTC', 'deep well', 'casing box'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2 },
      length: { min: 2.5, max: 5 }, threadCount: { min: 12, max: 24 },
      threadDepth: { min: 0.03, max: 0.08 },
    },
    defaults: { od: 5.5, wall: 0.35, length: 3.5, threadCount: 16, threadDepth: 0.05 },
  },
  {
    id: 'box_btc', name: 'BTC Box (Buttress Thread Casing)', parent: 'threaded_box',
    description: 'Buttress-thread coupled box — square thread profile for high-tension casing strings. Specialization of threaded_box with API BTC dimensions.',
    tagsAdd: ['BTC', 'buttress thread casing', 'API BTC', 'high tension', 'casing box'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2 },
      length: { min: 2, max: 4 }, threadCount: { min: 10, max: 18 },
      threadDepth: { min: 0.04, max: 0.10 },
    },
    defaults: { od: 7.0, wall: 0.4, length: 2.5, threadCount: 12, threadDepth: 0.06 },
  },

  // --- threaded_pin children ---
  {
    id: 'pin_stc', name: 'STC Pin (Short Thread Casing)', parent: 'threaded_pin',
    description: 'Short-thread casing pin — mates with the STC box coupling. Specialization of threaded_pin with API STC dimensions.',
    tagsAdd: ['STC', 'short thread casing', 'API STC', 'casing pin'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2 },
      length: { min: 1.2, max: 3 }, threadCount: { min: 6, max: 12 },
      threadDepth: { min: 0.03, max: 0.08 },
    },
    defaults: { od: 5.5, wall: 0.35, length: 1.8, threadCount: 8, threadDepth: 0.05 },
  },
  {
    id: 'pin_ltc', name: 'LTC Pin (Long Thread Casing)', parent: 'threaded_pin',
    description: 'Long-thread casing pin — mates with the LTC box coupling. Specialization of threaded_pin with API LTC dimensions.',
    tagsAdd: ['LTC', 'long thread casing', 'API LTC', 'deep well', 'casing pin'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2 },
      length: { min: 2.5, max: 5 }, threadCount: { min: 12, max: 24 },
      threadDepth: { min: 0.03, max: 0.08 },
    },
    defaults: { od: 5.5, wall: 0.35, length: 3.5, threadCount: 16, threadDepth: 0.05 },
  },
  {
    id: 'pin_btc', name: 'BTC Pin (Buttress Thread Casing)', parent: 'threaded_pin',
    description: 'Buttress-thread casing pin — mates with the BTC box coupling. Specialization of threaded_pin with API BTC dimensions.',
    tagsAdd: ['BTC', 'buttress thread casing', 'API BTC', 'high tension', 'casing pin'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2 },
      length: { min: 2, max: 4 }, threadCount: { min: 10, max: 18 },
      threadDepth: { min: 0.04, max: 0.10 },
    },
    defaults: { od: 7.0, wall: 0.4, length: 2.5, threadCount: 12, threadDepth: 0.06 },
  },
];

/** Final exported library. Order: base entries first (true primitives +
 *  hand-written specializations), then auto-generated variants. */
export const COMPONENTS: ComponentDef[] = [
  ...BASE_COMPONENTS,
  ...VARIATION_SPECS.map(deriveVariation),
];

export const CATEGORIES = [
  { id: "basic", name: "Basic Shapes" },
  { id: "connection", name: "Connections" },
  { id: "transition", name: "Transitions" },
  { id: "feature", name: "Features" },
  { id: "mechanical", name: "Mechanical" },
];
