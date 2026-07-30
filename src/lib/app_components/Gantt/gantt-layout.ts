// app_components/Gantt/gantt-layout.ts — PURE, headless layout math for the Gantt/timeline
// component. No Svelte, no DOM: normalize raw records → typed rows, compute the time range,
// group by lane, and place each bar as a PERCENTAGE of the track (so the render SSRs without
// measuring pixels and stays responsive). Kept separate from Gantt.svelte so it is unit-testable
// under vitest (environment:'node'). See src/lib/app_components/CLAUDE.md.

/** One normalized task bar. `start`/`end` are numbers on an arbitrary axis (e.g. weeks). */
export interface GanttRow {
  id: string | number;
  label: string;
  lane: string;
  start: number;
  end: number;
  status: string;
  details?: string;
}

/** Which source-record keys map onto the normalized fields. Lets a Gantt read /plan-style
 *  records ({start, weeks}) via `duration:'weeks'`, or {start,end} records directly. */
export interface GanttFieldMap {
  id?: string;
  label?: string;
  lane?: string;
  start?: string;
  end?: string;
  status?: string;
  details?: string;
  /** When set, `end = start + record[duration]` (instead of reading an `end` field). */
  duration?: string;
}

const DEFAULT_FIELDS: Required<Omit<GanttFieldMap, 'duration'>> = {
  id: 'id',
  label: 'label',
  lane: 'lane',
  start: 'start',
  end: 'end',
  status: 'status',
  details: 'details',
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an unknown source array into typed GanttRows. Non-objects are dropped; missing
 *  fields fall back sensibly (id→index, end→start so a zero-width bar never goes negative). */
export function normalizeRows(raw: unknown, fields: GanttFieldMap = {}): GanttRow[] {
  if (!Array.isArray(raw)) return [];
  const f = { ...DEFAULT_FIELDS, ...fields };
  const out: GanttRow[] = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const rec = r as Record<string, unknown>;
    const start = num(rec[f.start]);
    const end =
      fields.duration != null && rec[fields.duration] != null
        ? start + num(rec[fields.duration])
        : rec[f.end] != null
          ? num(rec[f.end])
          : start;
    out.push({
      id: (rec[f.id] as string | number) ?? i,
      label: String(rec[f.label] ?? rec[f.id] ?? `Task ${i + 1}`),
      lane: String(rec[f.lane] ?? 'default'),
      start,
      end: Math.max(end, start),
      status: String(rec[f.status] ?? 'open'),
      details: rec[f.details] != null ? String(rec[f.details]) : undefined,
    });
  });
  return out;
}

export interface GanttRange {
  min: number;
  max: number;
  span: number;
}

/** The axis window. Explicit rangeStart/rangeEnd override; otherwise the data's own extent.
 *  `span` is always > 0 (a single-point range widens to 1) so percentage math never divides by 0. */
export function computeRange(rows: GanttRow[], rangeStart?: number, rangeEnd?: number): GanttRange {
  let min = rangeStart;
  let max = rangeEnd;
  if (min == null || max == null) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      lo = Math.min(lo, r.start);
      hi = Math.max(hi, r.end);
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (min == null) min = lo;
    if (max == null) max = hi;
  }
  if (max <= min) max = min + 1;
  return { min, max, span: max - min };
}

export interface GanttLane {
  lane: string;
  rows: GanttRow[];
}

/** Group rows by lane, preserving FIRST-SEEN lane order (stable, deterministic for SSR). */
export function groupByLane(rows: GanttRow[]): GanttLane[] {
  const order: string[] = [];
  const map = new Map<string, GanttRow[]>();
  for (const r of rows) {
    let bucket = map.get(r.lane);
    if (!bucket) {
      bucket = [];
      map.set(r.lane, bucket);
      order.push(r.lane);
    }
    bucket.push(r);
  }
  return order.map((lane) => ({ lane, rows: map.get(lane) as GanttRow[] }));
}

export interface BarGeom {
  /** Left offset as a % of the track width. */
  leftPct: number;
  /** Bar width as a % of the track width (>= 0). */
  widthPct: number;
}

/** Place a bar within the axis window as percentages of the track. */
export function barGeometry(row: GanttRow, range: GanttRange): BarGeom {
  const leftPct = ((row.start - range.min) / range.span) * 100;
  const widthPct = Math.max(((row.end - row.start) / range.span) * 100, 0);
  return { leftPct, widthPct };
}

/** Status → bar colour. Downhole-neutral palette; unknown statuses fall back to 'open'. */
export const STATUS_COLORS: Record<string, string> = {
  done: '#10b981',
  active: '#f59e0b',
  open: '#3b82f6',
  todo: '#6366f1',
  deferred: '#94a3b8',
  'on-demand': '#a855f7',
  blocked: '#ef4444',
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.open;
}

/** The distinct statuses present in `rows`, each with its colour — for a legend. */
export function statusLegend(rows: GanttRow[]): Array<{ status: string; color: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, color: statusColor(status), count }));
}

export interface AxisTick {
  value: number;
  leftPct: number;
}

/** `count + 1` evenly-spaced ticks across the axis window (0%..100%). */
export function axisTicks(range: GanttRange, count = 6): AxisTick[] {
  const n = Math.max(1, Math.floor(count));
  const ticks: AxisTick[] = [];
  for (let i = 0; i <= n; i++) {
    ticks.push({ value: range.min + (range.span * i) / n, leftPct: (i / n) * 100 });
  }
  return ticks;
}
