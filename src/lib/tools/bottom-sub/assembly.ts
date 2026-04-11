/**
 * Parametric Bottom Sub Assembly
 *
 * Three main components:
 *   1. HOUSING  — outer body with tapers, shoulders, bore, box end
 *   2. SLEEVE   — thin inner cylinder, runs ~60% height from top
 *   3. SLIPS    — segmented ring mounted on housing
 *
 * Each component has parametric dimensions that can be adjusted
 * to match a catalog drawing.
 */

export interface HousingParams {
  // Upper body
  bodyOD: number;         // outer diameter of upper body
  bodyWall: number;       // wall thickness → bodyID = bodyOD - 2*bodyWall
  bodyLength: number;     // length of straight section

  // Top taper (widens at top)
  taperTopOD: number;     // OD at top of taper
  taperLength: number;    // taper height
  flatTopLength: number;  // flat section above taper

  // Lower box end
  lowerOD: number;        // outer diameter of box end
  lowerWall: number;      // wall thickness → lowerID = lowerOD - 2*lowerWall
  lowerLength: number;    // length of box end

  // Bottom profile
  bottomNeckOD: number;   // OD of bottom neck
  bottomTaperH: number;   // taper height at bottom
  bottomNeckH: number;    // neck height at bottom
  bottomBoreID: number;   // bore at very bottom

  // Internal threads
  numThreads: number;     // number of thread grooves in box end
  threadDepth: number;    // depth of thread grooves
}

/** Derive computed IDs from wall thickness */
export function deriveHousing(h: HousingParams) {
  return {
    bodyID: h.bodyOD - 2 * h.bodyWall,
    lowerID: h.lowerOD - 2 * h.lowerWall,
  };
}

export interface SleeveParams {
  sleeveOD: number;       // outer diameter
  sleeveID: number;       // inner diameter
  sleeveLength: number;   // total length (from top down ~60%)
  sleeveOffset: number;   // Z offset from top

  // Shear pins connecting sleeve to housing
  numPins: number;        // number of pin pairs
  pinRadius: number;      // pin radius
  pinLength: number;      // pin length
  pinSpacing: number;     // spacing between pins along Z
}

export interface SlipsParams {
  slipOD: number;         // outer diameter of slips
  slipHeight: number;     // height of slip ring
  slipOffset: number;     // Z offset from bottom of body
  numSectors: number;     // number of slip segments
  gapWidth: number;       // gap between sectors
  numGrooves: number;     // serration grooves per slip
  grooveDepth: number;    // depth of grooves
  taperDirection: number; // 1 = taper down (wider at top), -1 = taper up, 0 = flat
  taperAmount: number;    // how much the OD changes from top to bottom of slip
}

export interface AssemblyParams {
  housing: HousingParams;
  sleeve: SleeveParams;
  slips: SlipsParams;
}

// Default parameters matching the original HAL10408 drawing
export const DEFAULT_PARAMS: AssemblyParams = {
  housing: {
    bodyOD: 2.1,
    bodyWall: 0.25,
    bodyLength: 2.3,
    taperTopOD: 2.9,
    taperLength: 0.8,
    flatTopLength: 0.4,
    lowerOD: 2.8,
    lowerWall: 0.75,
    lowerLength: 2.1,
    bottomNeckOD: 2.2,
    bottomTaperH: 0.55,
    bottomNeckH: 0.6,
    bottomBoreID: 1.8,
    numThreads: 2,
    threadDepth: 0.08,
  },
  sleeve: {
    sleeveOD: 1.5,
    sleeveID: 1.1,
    sleeveLength: 4.1,
    sleeveOffset: -0.1,
    numPins: 2,
    pinRadius: 0.08,
    pinLength: 0.4,
    pinSpacing: 1.2,
  },
  slips: {
    slipOD: 2.6,
    slipHeight: 2.6,
    slipOffset: 0.1,
    numSectors: 4,
    gapWidth: 0.1,
    numGrooves: 14,
    grooveDepth: 0.08,
    taperDirection: -1,
    taperAmount: 0.3,
  },
};

// Parameter labels for UI display
export const PARAM_LABELS: Record<string, Record<string, string>> = {
  housing: {
    bodyOD: "Body OD",
    bodyWall: "Body Wall",
    bodyLength: "Body Length",
    taperTopOD: "Top Taper OD",
    taperLength: "Taper Length",
    flatTopLength: "Flat Top Length",
    lowerOD: "Box End OD",
    lowerWall: "Box End Wall",
    lowerLength: "Box End Length",
    bottomNeckOD: "Bottom Neck OD",
    bottomTaperH: "Bottom Taper Height",
    bottomNeckH: "Bottom Neck Height",
    bottomBoreID: "Bottom Bore ID",
    numThreads: "Internal Threads",
    threadDepth: "Thread Depth",
  },
  sleeve: {
    sleeveOD: "Sleeve OD",
    sleeveID: "Sleeve ID",
    sleeveLength: "Sleeve Length",
    sleeveOffset: "Sleeve Z Offset",
    numPins: "Shear Pins",
    pinRadius: "Pin Radius",
    pinLength: "Pin Length",
    pinSpacing: "Pin Spacing",
  },
  slips: {
    slipOD: "Slip OD",
    slipHeight: "Slip Height",
    slipOffset: "Slip Z Offset",
    numSectors: "Sectors",
    gapWidth: "Gap Width",
    numGrooves: "Grooves",
    grooveDepth: "Groove Depth",
  },
};
