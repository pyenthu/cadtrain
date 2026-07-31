// app_components/WellSchematic/well-schematic-layout.ts — PURE layout math for the well
// schematic (no Svelte, no DOM) so it unit-tests headless and server-renders identically.
//
// A well schematic is a depth cross-section: DEPTH increases DOWNWARD (top/shallow at the top of
// the diagram, TD at the bottom) — the natural well-log orientation, and consistent with the
// project's Z-down convention (deeper = further down-hole). DIAMETER maps horizontally, centred
// on the wellbore axis, so a string of outer-diameter `od` draws symmetric about the centre.
//
// Radial units are inches (od / bitSize); axial units are the depth unit of the data (ft or m).
// See src/lib/wells/ + memory wells_graph_bake_units_and_parts (radial=in, axial=m).

export interface StringRow {
  /** Outer diameter (radial units, e.g. inches). */
  od: number;
  /** Inner diameter (optional). */
  id?: number;
  /** Top depth (shallower). */
  top: number;
  /** Bottom depth (deeper). */
  bot: number;
  label?: string;
  grade?: string;
  color?: string;
}

export interface PerfRow {
  top: number;
  bot: number;
  label?: string;
  color?: string;
}

export interface SchematicInput {
  casings?: unknown[];
  holes?: unknown[];
  tubing?: unknown[];
  perforations?: unknown[];
  cement?: unknown[];
  /** Pixel size of the drawing. */
  width?: number;
  height?: number;
  /** Depth axis overrides (else derived from the data). */
  minDepth?: number;
  maxDepth?: number;
  /** Diameter axis override (else derived: the widest hole/casing). */
  maxDia?: number;
  margin?: Partial<Margin>;
}

export interface Margin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Plot {
  width: number;
  height: number;
  margin: Margin;
  /** Centre x (the wellbore axis, in pixels). */
  cx: number;
  /** Usable plot width / height (inside the margins). */
  plotW: number;
  plotH: number;
}

export interface Range {
  minDepth: number;
  maxDepth: number;
  /** The widest diameter (defines the horizontal scale). */
  maxDia: number;
}

export interface RectView {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  od: number;
  top: number;
  bot: number;
  label?: string;
  grade?: string;
  fill: string;
  stroke: string;
  dashed: boolean;
}

export interface PerfView {
  yTop: number;
  yBot: number;
  cx: number;
  /** Wall x on each side (perf ticks hang off the enclosing casing wall). */
  xLeft: number;
  xRight: number;
  color: string;
  label?: string;
  top: number;
  bot: number;
}

export interface TickView {
  y: number;
  depth: number;
  label: string;
}

export interface SchematicView {
  plot: Plot;
  range: Range;
  holes: RectView[];
  cement: RectView[];
  casings: RectView[];
  tubing: RectView[];
  perfs: PerfView[];
  depthTicks: TickView[];
  /** SVG width to render at: the plot width, grown to fit right-side shoe tags + perf labels so
   *  they don't clip against the canvas edge (text width is estimated — no DOM measurement). */
  contentWidth: number;
}

const DEFAULT_MARGIN: Margin = { top: 28, bottom: 24, left: 54, right: 20 };

/** Coerce to a finite number, else the fallback. */
export function num(v: unknown, d = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Normalize a raw record into a StringRow (numbers coerced, top/bot ordered). */
export function toStringRow(r: any): StringRow {
  const top = num(r?.top);
  const bot = num(r?.bot);
  return {
    od: num(r?.od ?? r?.bitSize),
    id: r?.id != null ? num(r.id) : undefined,
    top: Math.min(top, bot),
    bot: Math.max(top, bot),
    label: r?.label ?? r?.description,
    grade: r?.grade,
    color: r?.color,
  };
}

function toHoleRow(r: any): StringRow {
  const top = num(r?.top);
  const bot = num(r?.bot);
  return {
    od: num(r?.bitSize ?? r?.od),
    top: Math.min(top, bot),
    bot: Math.max(top, bot),
    label: r?.label,
  };
}

function toPerfRow(r: any): PerfRow {
  const top = num(r?.top);
  const bot = num(r?.bot);
  return {
    top: Math.min(top, bot),
    bot: Math.max(top, bot),
    label: r?.label ?? r?.perfSpec ?? r?.company,
    color: r?.color,
  };
}

/** Derive the depth + diameter range from every string/hole/perf, honouring overrides. */
export function computeRange(input: SchematicInput): Range {
  const casings = (input.casings ?? []).map(toStringRow);
  const holes = (input.holes ?? []).map(toHoleRow);
  const tubing = (input.tubing ?? []).map(toStringRow);
  const perfs = (input.perforations ?? []).map(toPerfRow);
  const cement = (input.cement ?? []).map(toStringRow);

  const bots: number[] = [];
  const dias: number[] = [];
  for (const s of [...casings, ...holes, ...tubing, ...cement]) {
    bots.push(s.bot);
    dias.push(s.od);
  }
  for (const p of perfs) bots.push(p.bot);

  const minDepth = input.minDepth != null ? input.minDepth : 0;
  const maxDepth =
    input.maxDepth != null ? input.maxDepth : bots.length ? Math.max(...bots) : minDepth + 1;
  const maxDia = input.maxDia != null ? input.maxDia : dias.length ? Math.max(...dias) : 1;
  return {
    minDepth,
    maxDepth: maxDepth > minDepth ? maxDepth : minDepth + 1,
    maxDia: maxDia > 0 ? maxDia : 1,
  };
}

/** Build the plot box (centre axis + usable inner rect). */
export function makePlot(width: number, height: number, margin?: Partial<Margin>): Plot {
  const m: Margin = { ...DEFAULT_MARGIN, ...(margin ?? {}) };
  const plotW = Math.max(1, width - m.left - m.right);
  const plotH = Math.max(1, height - m.top - m.bottom);
  return { width, height, margin: m, cx: m.left + plotW / 2, plotW, plotH };
}

/** Depth → pixel y (deeper = larger y; top of the plot = minDepth). */
export function yScale(depth: number, range: Range, plot: Plot): number {
  const span = range.maxDepth - range.minDepth || 1;
  return plot.margin.top + ((depth - range.minDepth) / span) * plot.plotH;
}

/** Signed radius (inches; left = negative) → pixel x about the centre axis. */
export function xForRadius(r: number, range: Range, plot: Plot): number {
  const half = range.maxDia / 2 || 1;
  return plot.cx + (r / half) * (plot.plotW / 2);
}

/** Rectangle geometry for one string (od symmetric about the axis, top→bot vertically). */
export function stringRect(
  row: StringRow,
  range: Range,
  plot: Plot,
  style: { fill: string; stroke: string; dashed?: boolean },
): RectView {
  const xL = xForRadius(-row.od / 2, range, plot);
  const xR = xForRadius(row.od / 2, range, plot);
  const yT = yScale(row.top, range, plot);
  const yB = yScale(row.bot, range, plot);
  return {
    x: xL,
    y: yT,
    w: xR - xL,
    h: yB - yT,
    cx: plot.cx,
    od: row.od,
    top: row.top,
    bot: row.bot,
    label: row.label,
    grade: row.grade,
    fill: style.fill,
    stroke: style.stroke,
    dashed: !!style.dashed,
  };
}

/** The radius (px offset from centre) of the innermost casing spanning a depth — where a perf
 *  tick hangs. Falls back to the outer plot edge when no casing encloses the depth. */
export function enclosingRadius(depth: number, casings: StringRow[], range: Range, plot: Plot): number {
  let best: StringRow | undefined;
  for (const c of casings) {
    if (depth >= c.top && depth <= c.bot) {
      if (!best || c.od < best.od) best = c;
    }
  }
  const od = best ? best.od : range.maxDia;
  return Math.abs(xForRadius(od / 2, range, plot) - plot.cx);
}

/** Evenly spaced depth-axis ticks (inclusive of both ends). */
export function depthTicks(range: Range, plot: Plot, count = 6): TickView[] {
  const n = Math.max(2, Math.floor(count));
  const span = range.maxDepth - range.minDepth || 1;
  const out: TickView[] = [];
  for (let i = 0; i < n; i++) {
    const depth = range.minDepth + (span * i) / (n - 1);
    out.push({ depth, y: yScale(depth, range, plot), label: fmtDepth(depth) });
  }
  return out;
}

function fmtDepth(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(0);
}

const STYLE = {
  hole: { fill: '#f3e3ec', stroke: '#b4477f', dashed: true },
  casing: { fill: '#e6f2f7', stroke: '#0f3d56', dashed: false },
  tubing: { fill: '#fde9a9', stroke: '#8a5a00', dashed: false },
  cement: { fill: 'url(#ws-cement)', stroke: 'none', dashed: false },
};

/** The full view-model the component renders — every pixel computed here (pure). */
export function buildSchematic(input: SchematicInput): SchematicView {
  const width = num(input.width, 380);
  const height = num(input.height, 520);
  const range = computeRange(input);
  const plot = makePlot(width, height, input.margin);

  const casingRows = (input.casings ?? []).map(toStringRow).filter((r) => r.od > 0 && r.bot > r.top);
  const holeRows = (input.holes ?? []).map(toHoleRow).filter((r) => r.od > 0 && r.bot > r.top);
  const tubingRows = (input.tubing ?? []).map(toStringRow).filter((r) => r.od > 0 && r.bot > r.top);
  const cementRows = (input.cement ?? []).map(toStringRow).filter((r) => r.od > 0 && r.bot > r.top);
  const perfRows = (input.perforations ?? []).map(toPerfRow);

  const holes = holeRows.map((r) => stringRect(r, range, plot, STYLE.hole));
  const cement = cementRows.map((r) => stringRect(r, range, plot, STYLE.cement));
  // Widest strings first so narrower inner strings paint on top.
  const casings = [...casingRows].sort((a, b) => b.od - a.od).map((r) => stringRect(r, range, plot, STYLE.casing));
  const tubing = [...tubingRows].sort((a, b) => b.od - a.od).map((r) => stringRect(r, range, plot, STYLE.tubing));
  const perfs: PerfView[] = perfRows.map((p) => {
    const r = enclosingRadius((p.top + p.bot) / 2, casingRows, range, plot);
    return {
      yTop: yScale(p.top, range, plot),
      yBot: yScale(p.bot, range, plot),
      cx: plot.cx,
      xLeft: plot.cx - r,
      xRight: plot.cx + r,
      color: p.color || '#e11d48',
      label: p.label,
      top: p.top,
      bot: p.bot,
    };
  });

  // Grow the canvas so right-side text (shoe tags at casing.x+w+10, perf labels at xRight+11) is not
  // clipped by the SVG edge. Text width is estimated (≈0.58·chars·fontPx) — SSR-safe, no measurement.
  let contentWidth = width;
  for (const c of casings) {
    const tag = `${fmtDia(c.od)}"${c.grade ? ` ${c.grade}` : ''}`;
    contentWidth = Math.max(contentWidth, c.x + c.w + 10 + estTextWidth(tag, 9));
  }
  for (const pf of perfs) {
    if (pf.label) contentWidth = Math.max(contentWidth, pf.xRight + 11 + estTextWidth(pf.label, 8.5));
  }

  return {
    plot,
    range,
    holes,
    cement,
    casings,
    tubing,
    perfs,
    depthTicks: depthTicks(range, plot, 7),
    contentWidth: Math.ceil(contentWidth + plot.margin.right),
  };
}

/** Rough SVG text width (no DOM): average glyph ≈ 0.58·fontPx. Good enough to reserve label room. */
function estTextWidth(s: string, fontPx: number): number {
  return s.length * fontPx * 0.58;
}

/** Diameter formatting mirrored from the component (integer → plain, else one decimal). */
function fmtDia(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
