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

export const COMPONENTS: ComponentDef[] = [
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
    category: "connection",
    description: "Internal threads — receives a pin end",
    tags: ["box end", "female connection", "receiver", "coupling box"],
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
    category: "connection",
    description: "External threads — inserts into a box end",
    tags: ["pin end", "male connection", "connector pin", "thread nose"],
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
    id: "thread_reg",
    name: "REG (Regular)",
    category: "connection",
    description: "Regular API thread — tapered pin with visible threads, shoulder landing",
    tags: ["API regular", "REG", "rotary shoulder", "tool joint"],
    params: {
      bodyOD: { label: "Body OD", min: 1, max: 6, step: 0.1 },
      pinOD: { label: "Pin OD", min: 0.5, max: 4, step: 0.1 },
      pinTaper: { label: "Pin Taper", min: 0.02, max: 0.15, step: 0.01 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      bodyLength: { label: "Body Length", min: 1, max: 8, step: 0.1 },
      pinLength: { label: "Pin Length", min: 0.5, max: 4, step: 0.1 },
      threadCount: { label: "Threads", min: 4, max: 20, step: 1 },
      threadDepth: { label: "Thread Depth", min: 0.02, max: 0.12, step: 0.01 },
      shoulderWidth: { label: "Shoulder Width", min: 0.1, max: 0.5, step: 0.05 },
    },
    defaults: { bodyOD: 3.5, pinOD: 2.2, pinTaper: 0.06, wall: 0.35, bodyLength: 3.0, pinLength: 2.0, threadCount: 12, threadDepth: 0.06, shoulderWidth: 0.25 },
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
    category: "connection",
    description: "Tubing connection — upset end thicker than body for thread strength",
    tags: ["EUE", "external upset", "tubing connection", "API tubing"],
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
    category: "transition",
    description: "Smooth diameter transition between two sections",
    tags: ["cone", "swage", "reducer", "expander", "transition"],
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
    category: "feature",
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
    category: "feature",
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
    category: "feature",
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
    category: "mechanical",
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
    id: "cone",
    name: "Setting Cone",
    category: "mechanical",
    description: "Tapered cone that drives slips outward",
    tags: ["setting cone", "hold-down cone", "release cone", "wedge"],
    params: {
      odTop: { label: "OD Top", min: 0.5, max: 4, step: 0.1 },
      odBottom: { label: "OD Bottom", min: 1, max: 6, step: 0.1 },
      wall: { label: "Wall", min: 0.1, max: 1, step: 0.05 },
      length: { label: "Length", min: 0.3, max: 3, step: 0.1 },
    },
    defaults: { odTop: 1.8, odBottom: 2.8, wall: 0.3, length: 1.2 },
  },
  {
    id: "j_latch",
    name: "J-Latch Profile",
    category: "mechanical",
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

export const CATEGORIES = [
  { id: "basic", name: "Basic Shapes" },
  { id: "connection", name: "Connections" },
  { id: "transition", name: "Transitions" },
  { id: "feature", name: "Features" },
  { id: "mechanical", name: "Mechanical" },
];
