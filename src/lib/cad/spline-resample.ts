/**
 * spline-resample.ts — a PURE-JS centripetal Catmull-Rom spline + arc-length
 * resampler (TODO #15, the spline-editor path card).
 *
 * The graph-editor's SplineEditorPopup uses three.js (`CatmullRomCurve3` +
 * `getSpacedPoints`) to draw + edit the curve interactively. But the Manifold
 * BAKE/sandbox has NO three.js — so the EMITTED part body must recompute the
 * sampled path with this dependency-free function instead. `resampleSpline` is
 * injected into the sandbox by name (primitive-sandbox.ts), exactly like
 * `sweepAlongPath`, and the emitted spline node lowers to
 *
 *     const _x_<id>_path = resampleSpline([[x,y,z], …], <N>);
 *
 * which wires into `r_sweep.path`. The output is N points spaced EQUALLY by
 * arc-length (chord length), closely matching three.js `getSpacedPoints(N-1)`.
 *
 * Algorithm:
 *   1. Build a centripetal Catmull-Rom curve through the control points
 *      (alpha = 0.5 — avoids the cusps/self-intersections uniform CR gets on
 *      sharp turns; the parameterisation three.js calls `centripetal`).
 *      Endpoints use reflected phantom points so the curve passes through the
 *      first + last control points.
 *   2. Densely sample each segment, accumulate cumulative chord lengths.
 *   3. Walk the cumulative-length table picking N targets at k/(N-1) · totalLen,
 *      linearly interpolating between the dense samples → equal arc-length spacing.
 */

export type Vec3 = [number, number, number];

const ALPHA = 0.5; // centripetal

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }

/** Next knot value: t_{i+1} = t_i + |P_{i+1} − P_i|^alpha. Guards coincident
 *  control points (a zero gap would divide-by-zero downstream) with a tiny
 *  epsilon so the curve degrades gracefully instead of producing NaN. */
function nextKnot(t: number, a: Vec3, b: Vec3): number {
  const d = Math.pow(len(sub(b, a)), ALPHA);
  return t + (d > 1e-9 ? d : 1e-9);
}

/** Evaluate one centripetal Catmull-Rom segment (between p1 and p2, with
 *  neighbours p0 + p3) at local parameter u ∈ [0,1]. Barry-Goldman pyramid. */
function evalSegment(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const t0 = 0;
  const t1 = nextKnot(t0, p0, p1);
  const t2 = nextKnot(t1, p1, p2);
  const t3 = nextKnot(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;

  const lin = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => {
    const dt = tb - ta || 1e-9;
    return add(scale(a, (tb - t) / dt), scale(b, (t - ta) / dt));
  };
  const A1 = lin(p0, p1, t0, t1);
  const A2 = lin(p1, p2, t1, t2);
  const A3 = lin(p2, p3, t2, t3);
  const B1 = lin(A1, A2, t0, t2);
  const B2 = lin(A2, A3, t1, t3);
  return lin(B1, B2, t1, t2);
}

/** Densely sample the whole spline → a polyline of points. `perSeg` samples
 *  per segment (the resolution of the arc-length table; higher = more accurate
 *  equal spacing). Returns the control points verbatim when < 2 are given.
 *
 *  `closed` (default false) makes the curve a LOOP: no reflected phantom
 *  endpoints — every segment's neighbours WRAP (p0 of the first seg = the last
 *  control point; p3 of the last seg = the first control point) and one extra
 *  closing segment runs from the last control point back to the first. The dense
 *  loop does NOT repeat the start vertex — each segment contributes its s=0..
 *  perSeg−1 samples (the endpoint is the next segment's start), so the polyline
 *  is `n · perSeg` points around the ring, with the closing edge implicit
 *  (dense[last] → dense[0]). The OPEN path is byte-identical to before. */
export function denseSampleSpline(points: Vec3[], perSeg = 64, closed = false): Vec3[] {
  // Accept 2D OR 3D control points (#26 lets a wired `list<point2|3>` drive the
  // spline): a 2D `[x,y]` pads to `[x,y,0]`. A 3D point is byte-identical
  // (Number(p[2]) unchanged; only a MISSING z coerces to 0).
  const pts = points.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Number(p[0]), Number(p[1]), Number(p[2]) || 0] as Vec3);
  if (pts.length < 2) return pts.slice();
  const n = pts.length;
  if (closed) {
    // Loop — n segments, each pts[i] → pts[(i+1)%n], neighbours wrapped. Each
    // segment emits s=0..perSeg−1 (skip the shared endpoint) so no duplicates;
    // dense[0] = pts[0] and the ring closes via dense[last] → dense[0].
    const out: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n]!;
      const p1 = pts[i]!;
      const p2 = pts[(i + 1) % n]!;
      const p3 = pts[(i + 2) % n]!;
      for (let s = 0; s < perSeg; s++) {
        out.push(evalSegment(p0, p1, p2, p3, s / perSeg));
      }
    }
    return out;
  }
  if (pts.length === 2) {
    // Straight line — just lerp (centripetal needs ≥ 2 segments to differ).
    const out: Vec3[] = [];
    for (let s = 0; s <= perSeg; s++) {
      const u = s / perSeg;
      out.push(add(scale(pts[0]!, 1 - u), scale(pts[1]!, u)));
    }
    return out;
  }
  const out: Vec3[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    // Reflected phantom endpoints so the curve hits the first/last control pt.
    const p0 = i === 0 ? sub(scale(p1, 2), p2) : pts[i - 1]!;
    const p3 = i === n - 2 ? sub(scale(p2, 2), p1) : pts[i + 2]!;
    const last = i === n - 2;
    const steps = last ? perSeg : perSeg - 1; // avoid duplicating shared vertex
    for (let s = 0; s <= steps; s++) {
      out.push(evalSegment(p0, p1, p2, p3, s / perSeg));
    }
  }
  return out;
}

/**
 * Resample a control-point list into `samples` points spaced EQUALLY by
 * arc-length along the centripetal Catmull-Rom curve through them. The path
 * producer node emits a call to this; the result feeds `r_sweep.path`.
 *
 * @param points  control points `[[x,y,z], …]` (≥ 2 for a curve).
 * @param samples N output points (≥ 2). Clamped to ≥ 2.
 * @param closed  loop the curve (default false). For a closed curve the N
 *                samples are spaced `k/N · totalLoopLength` (k = 0..N−1) around
 *                the FULL ring, so the last sample is one step BEFORE the first
 *                (no duplicate) — feed straight to a closed sweep. An OPEN curve
 *                spaces `k/(N−1) · totalLength` and hits both endpoints exactly
 *                (byte-identical to before).
 * @param perSeg  internal dense-sampling resolution per segment (default 64).
 */
export function resampleSpline(points: Vec3[], samples: number, closed = false, perSeg = 64): Vec3[] {
  const N = Math.max(2, Math.floor(Number(samples) || 2));
  const dense = denseSampleSpline(points, perSeg, closed);
  if (dense.length === 0) return [];
  if (dense.length === 1) return Array.from({ length: N }, () => dense[0]!.slice() as Vec3);

  // For a closed loop, append the start vertex as the explicit closing point so
  // the cumulative table covers the wrap edge (dense[last] → dense[0]); the
  // resample targets never reach it, so it's never emitted as a sample.
  const loop = closed ? [...dense, dense[0]!] : dense;

  // Cumulative arc length along the dense polyline.
  const cum: number[] = [0];
  for (let i = 1; i < loop.length; i++) {
    cum.push(cum[i - 1]! + len(sub(loop[i]!, loop[i - 1]!)));
  }
  const total = cum[cum.length - 1]!;
  if (total <= 1e-9) return Array.from({ length: N }, () => loop[0]!.slice() as Vec3);

  const out: Vec3[] = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    // Closed → space 0..(N−1)/N of the loop (last sample ≠ first). Open →
    // 0..1 inclusive so both endpoints are hit exactly.
    const target = closed ? (k / N) * total : (k / (N - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1]! < target) j++;
    const segLen = cum[j + 1]! - cum[j]! || 1e-9;
    const u = Math.min(1, Math.max(0, (target - cum[j]!) / segLen));
    out.push(add(scale(loop[j]!, 1 - u), scale(loop[j + 1]!, u)));
  }
  return out;
}
