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
      od: { label: "OD", min: 0.5, max: 14, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      length: { label: "Length", min: 0.5, max: 6, step: 0.1 },
      threadCount: { label: "Threads", min: 2, max: 40, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.15, step: 0.01 },
      taper: { label: "Taper (per length)", min: 0, max: 0.2, step: 0.005 },
    },
    defaults: { od: 3.0, wall: 0.5, length: 2.5, threadCount: 8, threadDepth: 0.08, taper: 0 },
  },
  {
    id: "threaded_pin",
    name: "Threaded Pin (Male)",
    category: "basic",
    description: "External threads — inserts into a box end. Generic primitive; specific connection forms (EUE, LTC, REG, NEW VAM…) compose this with a body and per-spec thread profile.",
    tags: ["pin connection", "pin end", "male connection", "connector pin", "thread nose", "generic_end", "connection", "thread"],
    params: {
      od: { label: "OD", min: 0.5, max: 14, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      length: { label: "Length", min: 0.5, max: 6, step: 0.1 },
      threadCount: { label: "Threads", min: 2, max: 40, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.15, step: 0.01 },
      taper: { label: "Taper (per length)", min: 0, max: 0.2, step: 0.005 },
    },
    defaults: { od: 2.5, wall: 0.3, length: 2.0, threadCount: 10, threadDepth: 0.06, taper: 0 },
  },

  // ── Anatomical (collared) pin primitive ──────────────────────────────────
  // Realistic API EUE-style anatomy on the male end: body OD → taper
  // transition → collar OD (where threads are cut). bodyStubLength=0 +
  // taperHeight=0 + collarOD=od collapses to the bare threaded_pin shape.
  {
    id: "threaded_pin_collared",
    name: "Threaded Pin (Collared)",
    category: "basic",
    description: "Male end with explicit collar (upset OD), taper transition, and optional flush body stub. External threads cut into the collar OD.",
    tags: ["pin connection", "collared", "EUE", "upset", "collar", "anatomical", "API"],
    parent: "threaded_pin",
    params: {
      od:             { label: "Body OD",       min: 1, max: 14, step: 0.05 },
      wall:           { label: "Wall",          min: 0.1, max: 1, step: 0.05 },
      collarOD:       { label: "Collar OD",     min: 1, max: 16, step: 0.05 },
      taperHeight:    { label: "Taper Height",  min: 0, max: 2, step: 0.05 },
      collarLength:   { label: "Collar Length", min: 0.3, max: 6, step: 0.05 },
      bodyStubLength: { label: "Body Stub Length", min: 0, max: 2, step: 0.05 },
      threadCount:    { label: "Threads",       min: 2, max: 40, step: 1 },
      threadDepth:    { label: "Thread Depth",  min: 0.02, max: 0.15, step: 0.01 },
      taper:          { label: "Thread Taper (1:N)", min: 0, max: 0.2, step: 0.005 },
    },
    defaults: { od: 2.875, wall: 0.217, collarOD: 3.668, taperHeight: 0.4, collarLength: 0.8, bodyStubLength: 0.0, threadCount: 8, threadDepth: 0.04, taper: 0.0625 },
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
    description: "Tubing connection — pin end with an external upset (thicker wall) carrying API EUE cut threads. Pin-style external threads cut into the upset section. Specialization of threaded_pin with the EUE upset feature.",
    tags: ["EUE", "external upset", "tubing connection", "API tubing", "pin end", "upset pin"],
    parent: "threaded_pin",
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

  // --- CATALOG-INSPIRED PRIMITIVES (Halliburton Intelligent Completions
  //     + Multilateral Technology) ---
  {
    id: "window_cutout",
    name: "Pre-Milled Window",
    category: "basic",
    description: "Casing joint with a rectangular pre-milled window — multilateral lateral-exit base. Window opens during junction construction.",
    tags: ["multilateral", "window", "pre-milled", "lateral", "LatchRite", "TAML"],
    params: {
      od: { label: "OD", min: 4, max: 14, step: 0.1 },
      wall: { label: "Wall", min: 0.2, max: 1, step: 0.05 },
      length: { label: "Length", min: 3, max: 8, step: 0.1 },
      windowWidth: { label: "Window Width", min: 0.5, max: 4, step: 0.1 },
      windowHeight: { label: "Window Height", min: 1, max: 5, step: 0.1 },
      windowOffset: { label: "Window Offset", min: 0.5, max: 5, step: 0.1 },
    },
    defaults: { od: 7.0, wall: 0.4, length: 5.0, windowWidth: 2.0, windowHeight: 3.0, windowOffset: 1.0 },
  },
  {
    id: "whipstock",
    name: "Whipstock",
    category: "basic",
    description: "Angled deflector wedge — kicks the milling/drilling bit off-center toward a lateral exit at a multilateral junction.",
    tags: ["whipstock", "deflector", "ramp", "multilateral junction", "kick-off"],
    params: {
      od: { label: "OD", min: 2, max: 10, step: 0.1 },
      length: { label: "Length", min: 2, max: 8, step: 0.1 },
      rampHeight: { label: "Ramp Height", min: 0.5, max: 4, step: 0.1 },
      rampOffset: { label: "Ramp Offset", min: 0, max: 2, step: 0.1 },
    },
    defaults: { od: 5.0, length: 4.0, rampHeight: 2.0, rampOffset: 0 },
  },
  {
    id: "drill_pipe_tool_joint",
    name: "Drill-Pipe Tool Joint",
    category: "basic",
    description: "Drill-pipe tool joint upset with parametric grade-identification markings: numGrooves circumferential grooves + numSlots axial slots on the tong-area band. Per the API drill-pipe identification chart.",
    tags: ["drill pipe", "tool joint", "DP", "identification", "tong area", "grade marking", "API drill pipe"],
    params: {
      pipeOD: { label: "Pipe OD", min: 2.5, max: 8, step: 0.05 },
      toolJointOD: { label: "Tool-Joint OD", min: 3, max: 10, step: 0.05 },
      wall: { label: "Wall", min: 0.2, max: 1.5, step: 0.05 },
      length: { label: "Length", min: 4, max: 12, step: 0.1 },
      numGrooves: { label: "Grooves", min: 0, max: 4, step: 1 },
      numSlots: { label: "Slots", min: 0, max: 2, step: 1 },
      grooveDepth: { label: "Groove Depth", min: 0.02, max: 0.12, step: 0.01 },
      grooveWidth: { label: "Groove Width", min: 0.1, max: 0.6, step: 0.05 },
      grooveWide: { label: "Wide Groove (0/1)", min: 0, max: 1, step: 1 },
      slotWidth: { label: "Slot Width", min: 0.05, max: 0.4, step: 0.05 },
      slotLength: { label: "Slot Length", min: 0.2, max: 1.5, step: 0.05 },
    },
    defaults: { pipeOD: 5.0, toolJointOD: 6.625, wall: 0.5, length: 6.0, numGrooves: 1, numSlots: 0, grooveDepth: 0.05, grooveWidth: 0.2, grooveWide: 0, slotWidth: 0.15, slotLength: 0.6 },
  },
  {
    id: "sliding_sleeve",
    name: "Sliding-Sleeve Valve Mandrel",
    category: "basic",
    description: "Hollow mandrel with axial ports + polished seal bores at each end. Generic body for interval control valves (HS-ICV, MCC-ICV, circulating valves) without thread/trim detail.",
    tags: ["ICV", "interval control valve", "sliding sleeve", "HS-ICV", "MCC-ICV", "circulating valve", "seal bore", "valve mandrel", "completion"],
    params: {
      od: { label: "OD", min: 2, max: 8, step: 0.1 },
      wall: { label: "Wall", min: 0.2, max: 1, step: 0.05 },
      length: { label: "Length", min: 3, max: 10, step: 0.1 },
      numPorts: { label: "Ports", min: 1, max: 8, step: 1 },
      portWidth: { label: "Port Width", min: 0.1, max: 1, step: 0.05 },
      portHeight: { label: "Port Height", min: 0.3, max: 2, step: 0.05 },
      sealBoreDepth: { label: "Seal-Bore Depth", min: 0.02, max: 0.15, step: 0.01 },
      sealBoreHeight: { label: "Seal-Bore Height", min: 0.2, max: 1, step: 0.05 },
    },
    defaults: { od: 3.5, wall: 0.4, length: 5.0, numPorts: 4, portWidth: 0.4, portHeight: 0.8, sealBoreDepth: 0.06, sealBoreHeight: 0.5 },
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

// API casing connection variants — SC (Short), LC (Long), BC (Buttress).
// Defaults derived from static/kb/api/casing-tubing-data.json, anchored to
// 7" casing as a representative size. The visual distinction comes from
// (length × threadCount) reflecting the spec's TPI × engagement length:
//   SC: 8 TPI · short  (~length 2.5)  → ~20 threads visible
//   LC: 8 TPI · long   (~length 4.0)  → ~32 threads visible
//   BC: 5 TPI · long   (~length 4.0)  → ~20 threads but visually coarser
// (Lengths scaled down 3× from real-world inches for canvas readability.)
//
// Parent ids use the KB shorthand (SC/LC/BC) — STC/LTC/BTC are aliases
// included in tagsAdd for the search filter.
const VARIATION_SPECS: VariationSpec[] = [
  // --- threaded_box children: API casing couplings ---
  {
    id: 'box_sc', name: 'SC Box (Short Thread Coupling)', parent: 'threaded_box',
    description: 'API Short-thread (SC/STC) coupling box — 8 TPI, short engagement (~6–8" real). Coupling collar slips over two SC pin ends.',
    tagsAdd: ['SC', 'STC', 'short thread casing', 'API SC', 'casing coupling', '8 TPI'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2, max: 1 },
      length: { min: 1.5, max: 3 },
      threadCount: { min: 16, max: 28 },
      threadDepth: { min: 0.03, max: 0.06 },
    },
    defaults: { od: 7.0, wall: 0.5, length: 2.5, threadCount: 20, threadDepth: 0.04, taper: 0.0625 },
  },
  {
    id: 'box_lc', name: 'LC Box (Long Thread Coupling)', parent: 'threaded_box',
    description: 'API Long-thread (LC/LTC) coupling box — 8 TPI, long engagement (~10.5" real). Same thread density as SC; longer body for higher joint strength.',
    tagsAdd: ['LC', 'LTC', 'long thread casing', 'API LC', 'deep well', 'casing coupling', '8 TPI'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2, max: 1 },
      length: { min: 3, max: 5 },
      threadCount: { min: 26, max: 40 },
      threadDepth: { min: 0.03, max: 0.06 },
    },
    defaults: { od: 7.0, wall: 0.5, length: 4.0, threadCount: 32, threadDepth: 0.04 },
  },
  {
    id: 'box_bc', name: 'BC Box (Buttress Thread Coupling)', parent: 'threaded_box',
    description: 'API Buttress (BC/BTC) coupling box — 5 TPI, long engagement (~10.6" real). Square buttress profile for high-tension casing strings; visibly coarser threads than SC/LC.',
    tagsAdd: ['BC', 'BTC', 'buttress thread casing', 'API BC', 'high tension', 'casing coupling', '5 TPI'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2, max: 1 },
      length: { min: 3, max: 5 },
      threadCount: { min: 16, max: 26 },
      threadDepth: { min: 0.05, max: 0.10 },
    },
    defaults: { od: 7.0, wall: 0.6, length: 4.0, threadCount: 20, threadDepth: 0.07 },
  },

  // --- threaded_pin children: API casing pin ends ---
  // Mirror the box defaults so a pin + box pair makes up consistently.
  {
    id: 'pin_sc', name: 'SC Pin (Short Thread Pin)', parent: 'threaded_pin',
    description: 'API Short-thread (SC/STC) pin end — mates inside the SC coupling box. 8 TPI, short engagement.',
    tagsAdd: ['SC', 'STC', 'short thread casing', 'API SC', 'casing pin', '8 TPI'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2, max: 1 },
      length: { min: 1.5, max: 3 },
      threadCount: { min: 16, max: 28 },
      threadDepth: { min: 0.03, max: 0.06 },
    },
    defaults: { od: 7.0, wall: 0.5, length: 2.5, threadCount: 20, threadDepth: 0.04, taper: 0.0625 },
  },
  {
    id: 'pin_lc', name: 'LC Pin (Long Thread Pin)', parent: 'threaded_pin',
    description: 'API Long-thread (LC/LTC) pin end — mates inside the LC coupling box. 8 TPI, long engagement.',
    tagsAdd: ['LC', 'LTC', 'long thread casing', 'API LC', 'deep well', 'casing pin', '8 TPI'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2, max: 1 },
      length: { min: 3, max: 5 },
      threadCount: { min: 26, max: 40 },
      threadDepth: { min: 0.03, max: 0.06 },
    },
    defaults: { od: 7.0, wall: 0.5, length: 4.0, threadCount: 32, threadDepth: 0.04 },
  },
  {
    id: 'pin_bc', name: 'BC Pin (Buttress Thread Pin)', parent: 'threaded_pin',
    description: 'API Buttress (BC/BTC) pin end — mates inside the BC coupling box. 5 TPI, long engagement, coarse thread profile.',
    tagsAdd: ['BC', 'BTC', 'buttress thread casing', 'API BC', 'high tension', 'casing pin', '5 TPI'],
    paramOverrides: {
      od: { min: 4, max: 14 }, wall: { min: 0.2, max: 1 },
      length: { min: 3, max: 5 },
      threadCount: { min: 16, max: 26 },
      threadDepth: { min: 0.05, max: 0.10 },
    },
    defaults: { od: 7.0, wall: 0.6, length: 4.0, threadCount: 20, threadDepth: 0.07 },
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
