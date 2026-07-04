/**
 * wson-2d.ts — PURE 2D SVG-schematic geometry builder for /wells.
 *
 * The 2D DEFAULT view (the #1 perf lever): a synchronous, O(#components) string-
 * of-primitives builder that emits `<rect>`/`<path>`/`<text>` SPECS — NO WASM,
 * NO Manifold CSG, NO GPU. This is why ewells is fast (see
 * `docs/research/wells-perf-ewells-vs-cadtrain.md`): its default surface is a
 * vector schematic, not a Manifold-boolean cutaway.
 *
 * Ported from SVTC's `~/code/SVTC/src/lib/apps/wson/wsonRender.js` (the pure
 * helpers `computeGeo` / `txPoint` / `buildDirPath` / `perfArrows` /
 * `cementRects`), adapted to cadtrain's WSON shape (`$lib/wells/wson`) + the
 * cadtrain depth pipeline (raw MD → DTX → ×zScale).
 *
 * DELIBERATELY PURE — no DOM, no Svelte, no Three. Returns plain data (numbers +
 * point arrays), never SVG strings, so it unit-tests headless
 * (`wson-2d.test.ts`) and the `.svelte` renderer just maps specs → elements.
 *
 * DEPTH SHARE: the depth remap (raw MD → display depth) is the SAME formula
 * `WellSchematic3D` uses — either passed in via `opts.remap` (so 2D + 3D match
 * exactly) or rebuilt here from `dtx`/`zScale` via {@link buildRemap}. Depths
 * stay true (metres) × the remap; diameters true (inches) × `diaScale`.
 */
import { autoNodes, lerpDTX, type Dtx } from './dtx';

// ── Layout constants (px) ────────────────────────────────────────────────────
/** Ruler column width. */
export const RULER_W = 46;
/** Top margin above depth 0 (room for the TD/label chrome). */
export const TOP_PAD = 24;
/** Bottom margin below TD. */
export const BOTTOM_PAD = 34;
/** Left margin for the OH/casing/cement labels (matches SVTC's +110). */
export const LEFT_MARGIN = 110;
/** Right margin for the completion labels. */
export const RIGHT_MARGIN = 200;
/** Metres between successive perforation arrow marks. */
export const PERF_DIST = 3;

// ── Loose input shape (a `.wson` doc; only the fields the 2D view reads) ──────
export interface Wson2DInput {
  meta?: { td?: number; wellName?: string };
  oh?: Array<{ bitSize: number; top: number; bot: number }>;
  ch?: Array<{ od: number; id?: number; top: number; bot: number; grade?: string; type?: string }>;
  cementing?: Array<{ od: number; top: number; bot: number }>;
  perforations?: Array<{ top: number; bot: number; label?: string; perfID?: number; color?: string }>;
  completions?: Array<{ description?: string; tool_comp?: string; od?: number; top?: number; bot?: number; length?: number }>;
  profile?: Array<{ md?: number; dev?: number; az?: number }>;
}

export interface Wson2DOpts {
  /** Radial exaggeration (inches → px). */
  diaScale: number;
  /** Depth stretch applied AFTER DTX (SVTC's yScale). */
  zScale: number;
  /** Apply DTX depth emphasis (expand cluttered zones). */
  dtx: boolean;
  /** Follow the deviation survey (false → straight vertical). */
  directional: boolean;
  /** SHARED remap (raw MD → display depth). When omitted it is rebuilt from
   *  `dtx`/`zScale` — identical to `WellSchematic3D`'s `remap`. */
  remap?: (md: number) => number;
}

export type Pt = [number, number];

// ── Spec types (plain data — no SVG strings) ─────────────────────────────────
export interface RectSpec { x: number; y: number; w: number; h: number; }

/** A depth-range body element (open hole / casing / tubing / completion body). */
export interface BodySeg {
  top: number; bot: number;
  /** Vertical form: a single centered rect spanning both faces. */
  rect: RectSpec;
  /** Deviated form: a closed outline polygon (left face down, right face up). */
  poly: Pt[];
  label: string;
}

/** A cement interval — a two-sided annulus (casing OD ↔ open-hole bit). */
export interface CementSeg {
  top: number; bot: number;
  /** Vertical form: left + right annulus rects. */
  leftRect: RectSpec; rightRect: RectSpec;
  /** Deviated form: left + right annulus polygons. */
  leftPoly: Pt[]; rightPoly: Pt[];
}

/** A completion component with a style tag for the renderer. */
export interface CompSeg extends BodySeg {
  type: 'packer' | 'hanger' | 'icd' | 'liner' | 'tubing';
  od: number;
  outerRadius: number;
}

/** Perforation marks — a set of small arrow triangles (each = a 3-point poly). */
export interface PerfSeg { arrows: Pt[][]; color: string; }

/** A component label anchor. The renderer runs `label-layout` for Y de-overlap
 *  then draws the leader from (ax,ay) to the bank rail. `side` = which bank. */
export interface LabelAnchor {
  md: number; ax: number; ay: number; text: string; color: string; side: 'left' | 'right';
}

export interface Wson2DScene {
  deviated: boolean;
  centerX: number;
  width: number;
  height: number;
  yScale: number;
  diaScale: number;
  /** Deepest raw MD considered (incl. margin). */
  maxDepth: number;
  remap: (md: number) => number;
  /** raw MD → svg Y (== depthToY). */
  depthToY: (md: number) => number;
  /** signed radius (inches) + MD → svg [x,y] (== SVTC txPoint). */
  txPoint: (rInches: number, md: number) => Pt;
  /** convenience: centerX + sign·r·diaScale (vertical only). */
  radiusToX: (rInches: number, sign: number) => number;
  /** Wellbore centreline polyline (deviated) or the straight axis (vertical). */
  centerline: Pt[];
  ruler: Array<{ md: number; y: number }>;
  openHole: BodySeg[];
  casing: BodySeg[];
  cement: CementSeg[];
  tubing: BodySeg | null;
  completions: CompSeg[];
  perfs: PerfSeg[];
  td: { md: number; y: number; xL: number; xR: number } | null;
  labels: LabelAnchor[];
}

// ── Depth pipeline ───────────────────────────────────────────────────────────

/** Deepest raw MD across all layers (+ meta.td), before margin. */
export function maxDepthOf(wson: Wson2DInput): number {
  const ds: number[] = [];
  if (typeof wson.meta?.td === 'number') ds.push(wson.meta.td);
  for (const o of wson.oh ?? []) ds.push(o.bot);
  for (const c of wson.ch ?? []) ds.push(c.bot);
  for (const c of wson.cementing ?? []) ds.push(c.bot);
  for (const p of wson.perforations ?? []) ds.push(p.bot);
  for (const c of wson.completions ?? []) ds.push(c.bot ?? c.top ?? 0);
  const m = ds.length ? Math.max(...ds) : 1000;
  return m > 0 ? m : 1000;
}

/** Build the DTX emphasis transform from cluttered zones (completion stack +
 *  perf intervals) — mirrors `WellSchematic3D`'s `dtxObj`. */
export function buildDtx(wson: Wson2DInput, rawTd: number): Dtx {
  const nodes: { start: number; end: number }[] = [];
  for (const c of wson.completions ?? []) {
    if (Number.isFinite(c.top as number) && Number.isFinite(c.bot as number)) {
      nodes.push({ start: c.top as number, end: c.bot as number });
    }
  }
  for (const p of wson.perforations ?? []) nodes.push({ start: p.top, end: p.bot });
  return autoNodes(nodes, rawTd);
}

/** Build the raw-MD → display-depth remap. IDENTICAL to `WellSchematic3D`'s
 *  `remap` = `(md) => (dtx ? lerpDTX(dtx, md) : md) * zScale`, so the 2D and 3D
 *  views place depth in the same display space. */
export function buildRemap(wson: Wson2DInput, opts: { dtx: boolean; zScale: number }): (md: number) => number {
  const rawTd = maxDepthOf(wson);
  const dtxObj = opts.dtx ? buildDtx(wson, rawTd) : null;
  const z = opts.zScale || 1;
  return (md: number) => (dtxObj ? lerpDTX(dtxObj, md) : md) * z;
}

// ── Deviation → 2D projection (pure, self-contained) ─────────────────────────
const DEG = Math.PI / 180;

/** A vertical-section projector: MD → screen-space centre `[x,y]` and unit
 *  perpendicular `[px,py]`. Vertical wells collapse to a straight axis with a
 *  horizontal perpendicular. Deviated wells walk the survey (average-angle),
 *  project the (east,north) displacement onto the departure azimuth, and place
 *  it horizontally at the SAME px/metre scale as depth (true aspect, like
 *  SVTC's `dirWarp`). */
interface Projector {
  center: (md: number) => Pt;
  perp: (md: number) => Pt;
  minH: number; // signed horizontal extent (display px)
  maxH: number;
}

function buildProjector(
  wson: Wson2DInput,
  directional: boolean,
  remap: (md: number) => number,
  yScale: number,
  centerX: number,
): Projector {
  const prof = (wson.profile ?? [])
    .filter((s) => Number.isFinite(s.md))
    .map((s) => ({ md: s.md as number, dev: s.dev ?? 0, az: s.az ?? 0 }))
    .sort((a, b) => a.md - b.md);
  const deviated = directional && prof.length >= 2 && prof.some((s) => s.dev > 0.5);

  if (!deviated) {
    return {
      center: (md) => [centerX, TOP_PAD + remap(md) * yScale],
      perp: () => [1, 0],
      minH: 0, maxH: 0,
    };
  }

  // Cumulative (east, north, tvd) at each station via the average-angle method.
  interface Cum { md: number; e: number; n: number; tvd: number; }
  const cum: Cum[] = [{ md: prof[0]!.md, e: 0, n: 0, tvd: prof[0]!.md }];
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1]!, b = prof[i]!;
    const dMD = b.md - a.md;
    const Iavg = ((a.dev + b.dev) / 2) * DEG;
    const Aavg = ((a.az + b.az) / 2) * DEG;
    const dH = dMD * Math.sin(Iavg);
    const dTVD = dMD * Math.cos(Iavg);
    const p = cum[cum.length - 1]!;
    cum.push({ md: b.md, e: p.e + dH * Math.sin(Aavg), n: p.n + dH * Math.cos(Aavg), tvd: p.tvd + dTVD });
  }
  // Departure azimuth = direction of the total horizontal displacement.
  const last = cum[cum.length - 1]!;
  const depMag = Math.hypot(last.e, last.n) || 1;
  const refx = last.e / depMag, refy = last.n / depMag;

  // Raw (h, tvd) sampled at an MD.
  const rawAt = (md: number): { h: number; tvd: number } => {
    if (md <= cum[0]!.md) return { h: 0, tvd: md };
    for (let i = 1; i < cum.length; i++) {
      if (md <= cum[i]!.md) {
        const a = cum[i - 1]!, b = cum[i]!;
        const t = (md - a.md) / (b.md - a.md || 1);
        const e = a.e + (b.e - a.e) * t, n = a.n + (b.n - a.n) * t, tvd = a.tvd + (b.tvd - a.tvd) * t;
        return { h: e * refx + n * refy, tvd };
      }
    }
    const t = md - last.md; // straight tail along the final tangent
    const prev = cum[cum.length - 2] ?? last;
    const dir = { e: last.e - prev.e, n: last.n - prev.n, tvd: last.tvd - prev.tvd };
    const dl = Math.hypot(dir.e, dir.n, dir.tvd) || 1;
    const e = last.e + (dir.e / dl) * t, n = last.n + (dir.n / dl) * t, tvd = last.tvd + (dir.tvd / dl) * t;
    return { h: e * refx + n * refy, tvd };
  };

  // Horizontal scaled by yScale (true aspect); vertical via remap for DTX.
  const center = (md: number): Pt => {
    const { h } = rawAt(md);
    return [centerX + h * yScale, TOP_PAD + remap(md) * yScale];
  };
  const perp = (md: number): Pt => {
    const d = Math.max(0.5, maxDepthOf(wson) * 0.001);
    const a = center(md - d), b = center(md + d);
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    // perpendicular to the tangent (screen space)
    return [-ty / m, tx / m];
  };

  // Horizontal extent for canvas sizing.
  let minH = 0, maxH = 0;
  const N = 60, td = maxDepthOf(wson);
  for (let i = 0; i <= N; i++) {
    const h = rawAt((td * i) / N).h * yScale;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  return { center, perp, minH, maxH };
}

// ── Completion style heuristic (ported from SVTC compTypeOf) ─────────────────
export function compTypeOf(c: { tool_comp?: string; description?: string }): CompSeg['type'] {
  const key = ((c.tool_comp ?? '') + ' ' + (c.description ?? '')).toLowerCase();
  if (key.includes('hanger')) return 'hanger';
  if (key.includes('packer')) return 'packer';
  if (key.includes('ina') || key.includes('icd') || key.includes('inflow') || key.includes('nozzle')) return 'icd';
  if (key.includes('liner')) return 'liner';
  return 'tubing';
}

const CATEGORY_COLOR: Record<string, string> = {
  packer: '#f59e0b', hanger: '#64748b', icd: '#2563eb', liner: '#16a34a', tubing: '#334155',
};

/** Which open-hole section owns a depth (for pairing cement to a bit size). */
function ohBitAt(md: number, oh: NonNullable<Wson2DInput['oh']>): number | null {
  for (const s of oh) if (md >= s.top && md <= s.bot) return s.bitSize;
  return null;
}

/** Resolve completion [top,bot], accumulating `length` from the previous. */
function completionExtents(comps: NonNullable<Wson2DInput['completions']>): Array<{ top: number; bot: number }> {
  let cursor = 0;
  return comps.map((c) => {
    if (Number.isFinite(c.top as number) && Number.isFinite(c.bot as number)) {
      cursor = c.bot as number;
      return { top: c.top as number, bot: c.bot as number };
    }
    const len = Number.isFinite(c.length as number) ? (c.length as number) : 0;
    const top = cursor; const bot = cursor + len; cursor = bot;
    return { top, bot };
  });
}

// ── THE builder ──────────────────────────────────────────────────────────────
/**
 * Build the full 2D schematic spec set for a WSON doc. Pure — the same inputs
 * always give the same output; unit-tested in `wson-2d.test.ts`.
 */
export function computeWson2D(wson: Wson2DInput, opts: Wson2DOpts): Wson2DScene {
  const diaScale = opts.diaScale;
  const remap = opts.remap ?? buildRemap(wson, { dtx: opts.dtx, zScale: opts.zScale });

  const oh = wson.oh ?? [];
  const ch = wson.ch ?? [];
  const cem = wson.cementing ?? [];
  const perf = wson.perforations ?? [];
  const compsRaw = wson.completions ?? [];

  const rawTd = maxDepthOf(wson);
  const displayMax = remap(rawTd);

  // Auto depth pixel-scale (SVTC autoYScale) — clamp so deep + shallow wells
  // both read. Depth stretch (zScale) is already folded into `remap`.
  const yScale = Math.min(Math.max(400 / Math.max(1, displayMax), 0.08), 0.35);

  const maxBit = oh.length ? Math.max(...oh.map((s) => s.bitSize)) : 20;
  const maxOD = ch.length ? Math.max(...ch.map((c) => c.od)) : maxBit;
  const maxR = Math.max(maxBit, maxOD) / 2;

  // Provisional centerX; corrected for deviation shift once projector is built.
  const provCenterX = RULER_W + LEFT_MARGIN + maxR * diaScale;
  const proj0 = buildProjector(wson, opts.directional, remap, yScale, provCenterX);
  const leftShift = Math.max(0, -proj0.minH);
  const centerX = provCenterX + leftShift;
  const proj = buildProjector(wson, opts.directional, remap, yScale, centerX);
  const deviated = proj.maxH !== 0 || proj.minH !== 0;

  const width = centerX + maxR * diaScale + RIGHT_MARGIN + Math.max(0, proj.maxH);
  const height = TOP_PAD + displayMax * yScale + BOTTOM_PAD;

  const depthToY = (md: number) => proj.center(md)[1];
  const txPoint = (rInches: number, md: number): Pt => {
    const c = proj.center(md);
    const p = proj.perp(md);
    return [c[0] + p[0] * rInches * diaScale, c[1] + p[1] * rInches * diaScale];
  };
  const radiusToX = (rInches: number, sign: number) => centerX + sign * rInches * diaScale;

  // Body outline polygon for a [top,bot] range with signed radii (deviated).
  const bodyPoly = (top: number, bot: number, rL: number, rR: number, steps = 24): Pt[] => {
    const L: Pt[] = [], R: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const md = top + ((bot - top) * i) / steps;
      L.push(txPoint(-rL, md));
      R.push(txPoint(rR, md));
    }
    return [...L, ...R.reverse()];
  };
  // One annulus side (deviated cement): between rIn and rOut on `sign` side.
  const sidePoly = (top: number, bot: number, rIn: number, rOut: number, sign: number, steps = 24): Pt[] => {
    const I: Pt[] = [], O: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const md = top + ((bot - top) * i) / steps;
      I.push(txPoint(sign * rIn, md));
      O.push(txPoint(sign * rOut, md));
    }
    return [...I, ...O.reverse()];
  };
  const rectFor = (top: number, bot: number, r: number): RectSpec => {
    const y = depthToY(top);
    return { x: radiusToX(r, -1), y, w: 2 * r * diaScale, h: depthToY(bot) - y };
  };

  // ── Open hole ──────────────────────────────────────────────────────────────
  const openHole: BodySeg[] = oh.map((s) => ({
    top: s.top, bot: s.bot,
    rect: rectFor(s.top, s.bot, s.bitSize / 2),
    poly: deviated ? bodyPoly(s.top, s.bot, s.bitSize / 2, s.bitSize / 2) : [],
    label: `${s.bitSize}" OH to ${s.bot}m`,
  }));

  // ── Casing strings (tubing-type handled separately) ──────────────────────────
  const casing: BodySeg[] = ch
    .filter((c) => c.type !== 'tubing')
    .map((c) => ({
      top: c.top, bot: c.bot,
      rect: rectFor(c.top, c.bot, c.od / 2),
      poly: deviated ? bodyPoly(c.top, c.bot, c.od / 2, c.od / 2) : [],
      label: `${c.od}" ${c.grade ?? ''}`.trim(),
    }));

  // ── Cement (annulus casing OD ↔ open-hole bit) ─────────────────────────────
  const cement: CementSeg[] = [];
  for (const c of cem) {
    const bit = ohBitAt((c.top + c.bot) / 2, oh);
    const holeR = (bit != null ? bit : c.od * 1.15) / 2;
    const casingR = c.od / 2;
    if (holeR <= casingR) continue;
    const y = depthToY(c.top); const h = depthToY(c.bot) - y;
    cement.push({
      top: c.top, bot: c.bot,
      leftRect: { x: radiusToX(holeR, -1), y, w: (holeR - casingR) * diaScale, h },
      rightRect: { x: radiusToX(casingR, 1), y, w: (holeR - casingR) * diaScale, h },
      leftPoly: deviated ? sidePoly(c.top, c.bot, casingR, holeR, -1) : [],
      rightPoly: deviated ? sidePoly(c.top, c.bot, casingR, holeR, 1) : [],
    });
  }

  // ── Completions ────────────────────────────────────────────────────────────
  const ext = completionExtents(compsRaw);
  const completions: CompSeg[] = [];
  let tubing: BodySeg | null = null;
  compsRaw.forEach((c, i) => {
    const { top, bot } = ext[i]!;
    const r = (c.od ?? 2.875) / 2;
    const type = compTypeOf(c);
    const isTubingJoints = /tubing/i.test(c.description ?? '') && /joints/i.test(c.description ?? '');
    if (isTubingJoints) {
      tubing = {
        top, bot,
        rect: rectFor(top, bot, r),
        poly: deviated ? bodyPoly(top, bot, r, r) : [],
        label: c.description ?? 'Tubing',
      };
      return;
    }
    const outerRadius = r * (type === 'packer' || type === 'hanger' ? 1.5 : 1.2);
    completions.push({
      top, bot, type, od: c.od ?? 2.875, outerRadius,
      rect: rectFor(top, bot, r),
      poly: deviated ? bodyPoly(top, bot, r, r) : [],
      label: c.description || c.tool_comp || 'Completion',
    });
  });

  // ── Perforation arrows (chevrons at PERF_DIST intervals) ─────────────────────
  const perfs: PerfSeg[] = perf.map((p) => {
    const arrows: Pt[][] = [];
    const intervals = Math.max(1, Math.round((p.bot - p.top) / PERF_DIST));
    const tip = (p.perfID ?? 7) / 2;
    const ext2 = tip + 5;
    for (let i = 0; i < intervals; i++) {
      const t = p.top + PERF_DIST * i;
      const mid = t + PERF_DIST / 2;
      const b = Math.min(t + PERF_DIST, p.bot);
      arrows.push([txPoint(-tip, t), txPoint(-ext2, mid), txPoint(-tip, b)]);
      arrows.push([txPoint(tip, t), txPoint(ext2, mid), txPoint(tip, b)]);
    }
    return { arrows, color: p.color ?? '#e53e3e' };
  });

  // ── TD marker (deepest open hole) ────────────────────────────────────────────
  let td: Wson2DScene['td'] = null;
  if (oh.length) {
    const tdMd = Math.max(...oh.map((s) => s.bot));
    const l = txPoint(-2, tdMd), rr = txPoint(2, tdMd);
    td = { md: tdMd, y: (l[1] + rr[1]) / 2, xL: l[0], xR: rr[0] };
  }

  // ── Ruler ticks (nice interval, ~8 ticks) ────────────────────────────────────
  const ruler: Array<{ md: number; y: number }> = [];
  {
    const raw = rawTd / 8;
    const exp = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const step = [1, 2, 5, 10].map((m) => m * exp).find((m) => rawTd / m <= 12) ?? raw;
    for (let d = 0; d <= rawTd + 1e-6; d += step) ruler.push({ md: Math.round(d), y: depthToY(d) });
  }

  // ── Centreline polyline ──────────────────────────────────────────────────────
  const centerline: Pt[] = [];
  {
    const N = 80;
    for (let i = 0; i <= N; i++) centerline.push(proj.center((rawTd * i) / N));
  }

  // ── Label anchors (bh → left face; completions/perfs → right face) ───────────
  const labels: LabelAnchor[] = [];
  const push = (signedR: number, md: number, text: string, color: string) => {
    const [ax, ay] = txPoint(signedR, md);
    labels.push({ md, ax, ay, text, color, side: ax < centerX ? 'left' : 'right' });
  };
  for (const s of oh) push(-(s.bitSize / 2), s.bot, `${s.bitSize}" OH to ${s.bot}m`, '#9333ea');
  for (const c of ch) {
    if (c.type === 'tubing') continue;
    push(-(c.od / 2), c.top, `${c.od}" ${c.grade ?? ''}`.trim(), '#111827');
  }
  for (const c of cem) push(-((c.od ?? 8) / 2), c.top, `Cem ${c.od ?? '?'}"`, '#8a7a55');
  for (const cs of completions) {
    push(cs.outerRadius, (cs.top + cs.bot) / 2, `${cs.label} ${cs.od}"`, CATEGORY_COLOR[cs.type] ?? '#334155');
  }
  for (const p of perf) {
    if (!(p.bot > p.top)) continue;
    push((p.perfID ?? 7) / 2 + 5, (p.top + p.bot) / 2, p.label ?? `Perf ${p.top}–${p.bot}m`, p.color ?? '#e53e3e');
  }

  return {
    deviated, centerX, width, height, yScale, diaScale, maxDepth: rawTd,
    remap, depthToY, txPoint, radiusToX, centerline, ruler,
    openHole, casing, cement, tubing, completions, perfs, td, labels,
  };
}
