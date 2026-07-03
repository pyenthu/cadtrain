/**
 * DTX depth-scaling — CLIENT-side port of the pure-JS `autoNodes` + `lerpDTX`
 * from SVTC `src/routes/api/schematic/+server.js`. cadtrain runs this in the
 * browser (no server round-trip): the well schematic applies DTX to
 * depth/spacing BEFORE the trajectory warp (pipeline: raw MD → DTX → warp →
 * ×zScale — memory `well_schematic_3d_first`, `src/lib/wells/CLAUDE.md`).
 *
 * DTX ("depth transform") is a monotonic remap of true MD → display MD that
 * EXPANDS cluttered intervals (short spans densely packed with components) and
 * COMPRESSES long empty runs, so a 3000 m well with a 5 m completion stack at
 * TD still shows the stack legibly. It is depth-only — radial diameters are
 * left true (see CLAUDE.md scaling divergence).
 */

/** A depth interval to emphasise — e.g. a completion stack or a perf cluster.
 *  `start`/`end` in metres MD. */
export interface DtxNode { start: number; end: number; }

/** Result of {@link autoNodes}: paired arrays mapping true depth → display
 *  depth. Both start at 0 and are monotonically non-decreasing. */
export interface Dtx { depth: number[]; depthTx: number[]; }

/**
 * Build a DTX from a set of emphasis intervals over [0, maxDepth]. Short
 * intervals (< 50 m) fully covered by a node get a weight boost so they
 * occupy more display depth; everything else stays weight 1. The cumulative
 * weighted length is normalised back onto [0, maxDepth].
 *
 * Faithful port of the server `autoNodes` (the turf-free simplification of the
 * DLIS autonodes algorithm).
 */
export function autoNodes(nodes: DtxNode[], maxDepth: number): Dtx {
  // Collect all breakpoints.
  const breaks = new Set<number>([0, maxDepth]);
  for (const nd of nodes) { breaks.add(nd.start); breaks.add(nd.end); }
  const bpts = [...breaks].sort((a, b) => a - b);

  // Assign weight to each interval.
  const intervals: { s: number; e: number; len: number; w: number }[] = [];
  for (let i = 0; i < bpts.length - 1; i++) {
    const s = bpts[i], e = bpts[i + 1], len = e - s;
    if (len <= 0) continue; // skip zero-length or negative intervals
    let weight = 1;
    for (const nd of nodes) {
      if (nd.start <= s && nd.end >= e && len < 50) {
        const w = 50 / (0.3 * len);
        weight = Math.max(weight, isFinite(w) ? w : 1);
      }
    }
    intervals.push({ s, e, len, w: weight });
  }

  // Cumulative weighted → DTX.
  const totalW = intervals.reduce((sum, iv) => sum + iv.len * iv.w, 0);
  const depth = [0], depthTx = [0];
  let cumReal = 0, cumWt = 0;
  for (const iv of intervals) {
    cumReal += iv.len;
    cumWt   += iv.len * iv.w;
    depth.push(cumReal);
    depthTx.push(totalW > 0 ? cumWt * maxDepth / totalW : cumReal);
  }
  return { depth, depthTx };
}

/**
 * Linear interpolation of a true depth `d` (m MD) onto the DTX display depth.
 * Clamps to the endpoints outside the sampled range. Faithful port of the
 * server `lerpDTX` closure.
 */
export function lerpDTX(dtx: Dtx, d: number): number {
  if (dtx.depth.length < 2) return d;
  if (d <= dtx.depth[0]) return dtx.depthTx[0];
  if (d >= dtx.depth[dtx.depth.length - 1]) return dtx.depthTx[dtx.depthTx.length - 1];
  for (let i = 1; i < dtx.depth.length; i++) {
    if (d <= dtx.depth[i]) {
      const t = (d - dtx.depth[i - 1]) / (dtx.depth[i] - dtx.depth[i - 1]);
      return dtx.depthTx[i - 1] + t * (dtx.depthTx[i] - dtx.depthTx[i - 1]);
    }
  }
  return d;
}

/** Convenience: bind a DTX into a one-arg remap function `md → displayMd`. */
export function makeDtxLerp(dtx: Dtx): (d: number) => number {
  return (d: number) => lerpDTX(dtx, d);
}

/** Remap every survey station's MD through the DTX (SVTC's `autoSurvey`).
 *  Pass the result to `buildWellDirection` so the warp follows the scaled
 *  depths. Non-mutating. */
export function dtxRemapSurvey<T extends { md?: number }>(dtx: Dtx, survey: T[]): T[] {
  return survey.map((p) => ({ ...p, md: lerpDTX(dtx, p.md ?? 0) }));
}
