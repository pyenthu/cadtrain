/**
 * Parametric Ratch-Latch Receiving Head
 *
 * From top to bottom:
 *   1. TOP CAP      — short flat section at full OD
 *   2. THREADED NECK — external threads, slightly narrower
 *   3. UPPER BODY   — straight red cylinder, full OD
 *   4. SHOULDER     — step-down to narrower section
 *   5. MANDREL      — inner grey sleeve running through body
 *   6. LOWER BODY   — red cylinder below shoulder
 *   7. BOTTOM       — slight taper at exit
 *
 * High aspect ratio tool (~8:1 height:diameter)
 */

export interface BodyParams {
  // Top cap
  topCapOD: number;
  topCapLength: number;

  // Threaded neck (external threads)
  threadOD: number;
  threadLength: number;
  numThreads: number;
  threadDepth: number;

  // Upper body
  upperOD: number;
  upperWall: number;
  upperLength: number;

  // Shoulder transition
  shoulderOD: number;       // OD below shoulder (narrower)
  shoulderTaperH: number;   // height of taper transition

  // Lower body
  lowerOD: number;
  lowerWall: number;
  lowerLength: number;

  // Bottom
  bottomTaperH: number;
  bottomOD: number;
}

export interface MandrelParams {
  mandrelOD: number;
  mandrelID: number;
  mandrelLength: number;
  mandrelOffset: number;    // Z offset from top of upper body
}

export interface SealParams {
  sealOD: number;
  sealHeight: number;
  sealOffset: number;       // Z offset from top
  numSeals: number;         // number of seal grooves
  grooveDepth: number;
}

export interface AssemblyParams {
  body: BodyParams;
  mandrel: MandrelParams;
  seal: SealParams;
}

/** Derive computed IDs from wall thickness */
export function deriveBody(b: BodyParams) {
  return {
    upperID: b.upperOD - 2 * b.upperWall,
    lowerID: b.lowerOD - 2 * b.lowerWall,
  };
}

export const DEFAULT_PARAMS: AssemblyParams = {
  body: {
    topCapOD: 2.4,
    topCapLength: 0.3,
    threadOD: 2.2,
    threadLength: 2.0,
    numThreads: 15,
    threadDepth: 0.06,
    upperOD: 2.4,
    upperWall: 0.35,
    upperLength: 4.0,
    shoulderOD: 2.0,
    shoulderTaperH: 0.3,
    lowerOD: 2.4,
    lowerWall: 0.4,
    lowerLength: 5.0,
    bottomTaperH: 0.4,
    bottomOD: 2.0,
  },
  mandrel: {
    mandrelOD: 1.6,
    mandrelID: 1.2,
    mandrelLength: 8.0,
    mandrelOffset: 1.0,
  },
  seal: {
    sealOD: 1.7,
    sealHeight: 1.5,
    sealOffset: 5.0,
    numSeals: 3,
    grooveDepth: 0.05,
  },
};

export const PARAM_LABELS: Record<string, Record<string, string>> = {
  body: {
    topCapOD: "Top Cap OD",
    topCapLength: "Top Cap Length",
    threadOD: "Thread OD",
    threadLength: "Thread Length",
    numThreads: "Thread Count",
    upperOD: "Upper OD",
    upperWall: "Upper Wall",
    upperLength: "Upper Length",
    shoulderOD: "Shoulder OD",
    shoulderTaperH: "Shoulder Taper",
    lowerOD: "Lower OD",
    lowerWall: "Lower Wall",
    lowerLength: "Lower Length",
    bottomTaperH: "Bottom Taper",
    bottomOD: "Bottom OD",
  },
  mandrel: {
    mandrelOD: "Mandrel OD",
    mandrelID: "Mandrel ID",
    mandrelLength: "Mandrel Length",
    mandrelOffset: "Mandrel Offset",
  },
  seal: {
    sealOD: "Seal OD",
    sealHeight: "Seal Height",
    sealOffset: "Seal Offset",
    numSeals: "Seal Count",
    grooveDepth: "Groove Depth",
  },
};
