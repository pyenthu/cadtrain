/**
 * Well assembler (W1) — turns a WSON document into 3D-placed parts: every casing
 * string, open-hole section, cement interval, completion component and perf is
 * positioned along the wellbore trajectory by depth (Z-DOWN: z increases with
 * depth, matching cadtrain's convention). This is the CORE of 3D-first — the
 * canonical 3D well that both the scene and the (later) 2D schematic render.
 *
 * Trajectory: vertical wells → straight down the z axis. Deviated wells → an
 * average-angle survey walk to (east, north, tvd), interpolated by MD. (A
 * minimum-curvature upgrade can replace buildTrajectory without touching callers.)
 *
 * Dimensions stay TRUE (depths metres, diameters inches); the scene applies a
 * radial exaggeration so a 9⅝" string in a 1000 m well is visible.
 */
import type { Wson, SurveyStation } from './wson';
import { completionExtents } from './wson';
import { resolveComponent, resolveStructural, CATEGORY_COLOR, type WellCompCategory } from './registry';

export type Vec3 = [number, number, number];

export type WellPartKind = 'casing' | 'openhole' | 'cement' | 'completion' | 'perf';

export interface WellPart {
  kind: WellPartKind;
  label: string;
  color: string;
  odIn: number;            // outer diameter (inches)
  idIn?: number;           // inner diameter (inches) — tubulars are hollow
  top: number; bot: number;   // MD (metres)
  pTop: Vec3; pBot: Vec3;     // 3D endpoints (metres, z-down)
  partId?: string;            // completions → cadtrain g_* part
  category?: WellCompCategory;
  matched?: boolean;          // false → generic-tube fallback (icon hint)
}

export interface AssembledWell {
  parts: WellPart[];
  tvdMax: number;          // deepest TVD (metres) — for camera + depth axis
  maxOdIn: number;         // widest OD — for the radial scale
  deviated: boolean;
}

const DEG = Math.PI / 180;

/** Build an MD→(east,north,tvd) function via the average-angle method. Vertical
 *  (no/flat profile) → straight down. */
function buildTrajectory(profile?: SurveyStation[]): (md: number) => Vec3 {
  const prof = (profile ?? []).filter((s) => Number.isFinite(s.md)).sort((a, b) => a.md - b.md);
  if (prof.length < 2 || prof.every((s) => (s.dev ?? 0) < 0.5)) {
    return (md) => [0, 0, md];
  }
  // Cumulative (e,n,tvd) at each station.
  const cum: { md: number; p: Vec3 }[] = [{ md: prof[0].md, p: [0, 0, prof[0].md] }];
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1], b = prof[i];
    const dMD = b.md - a.md;
    const Iavg = ((a.dev + b.dev) / 2) * DEG;
    const Aavg = ((a.az + b.az) / 2) * DEG;
    const dTVD = dMD * Math.cos(Iavg);
    const dH = dMD * Math.sin(Iavg);
    const prev = cum[cum.length - 1].p;
    cum.push({ md: b.md, p: [prev[0] + dH * Math.sin(Aavg), prev[1] + dH * Math.cos(Aavg), prev[2] + dTVD] });
  }
  return (md) => {
    if (md <= cum[0].md) return [0, 0, md];
    for (let i = 1; i < cum.length; i++) {
      if (md <= cum[i].md) {
        const a = cum[i - 1], b = cum[i];
        const t = (md - a.md) / (b.md - a.md || 1);
        return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t];
      }
    }
    // Below last station — extend straight along the last tangent direction.
    const last = cum[cum.length - 1];
    const prev = cum[cum.length - 2];
    const dir: Vec3 = [last.p[0] - prev.p[0], last.p[1] - prev.p[1], last.p[2] - prev.p[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const ext = md - last.md;
    return [last.p[0] + (dir[0] / len) * ext, last.p[1] + (dir[1] / len) * ext, last.p[2] + (dir[2] / len) * ext];
  };
}

const CASING_COLOR: Record<string, string> = {
  conductor: '#94a3b8', surface: '#64748b', intermediate: '#475569',
  production: '#334155', liner: '#1e293b', tubing: '#9ca3af',
};

export function assembleWell(wson: Wson): AssembledWell {
  const at = buildTrajectory(wson.profile);
  const parts: WellPart[] = [];
  let tvdMax = 0, maxOdIn = 0;
  const note = (top: number, bot: number, od: number) => {
    tvdMax = Math.max(tvdMax, at(bot)[2], at(top)[2]);
    maxOdIn = Math.max(maxOdIn, od);
  };

  for (const o of wson.oh ?? []) {
    const s = resolveStructural('openhole', { od: o.bitSize }, o.bot - o.top);
    parts.push({ kind: 'openhole', label: `OH ${o.bitSize}"`, color: '#6b4f3a', odIn: o.bitSize, top: o.top, bot: o.bot, pTop: at(o.top), pBot: at(o.bot), partId: s.partId });
    note(o.top, o.bot, o.bitSize);
  }
  for (const c of wson.cementing ?? []) {
    const s = resolveStructural('cement', { od: c.od }, c.bot - c.top);
    parts.push({ kind: 'cement', label: `cement ${c.od}"`, color: '#a8a29e', odIn: c.od, top: c.top, bot: c.bot, pTop: at(c.top), pBot: at(c.bot), partId: s.partId });
    note(c.top, c.bot, c.od);
  }
  for (const c of wson.ch ?? []) {
    const isTubing = c.type === 'tubing';
    const s = resolveStructural(isTubing ? 'tubing' : 'casing', { od: c.od, id: c.id }, c.bot - c.top);
    parts.push({ kind: 'casing', label: `${c.type ?? 'casing'} ${c.od}"`, color: CASING_COLOR[c.type ?? 'casing'] ?? '#475569', odIn: c.od, idIn: c.id, top: c.top, bot: c.bot, pTop: at(c.top), pBot: at(c.bot), partId: s.partId });
    note(c.top, c.bot, c.od);
  }
  const comps = wson.completions ?? [];
  const ext = completionExtents(comps);
  comps.forEach((c, i) => {
    const { top, bot } = ext[i];
    const r = resolveComponent(c, bot - top);
    parts.push({
      kind: 'completion', label: c.description || c.tool_comp, color: CATEGORY_COLOR[r.category],
      odIn: c.od ?? 2.875, top, bot, pTop: at(top), pBot: at(bot),
      partId: r.partId, category: r.category, matched: r.matched,
    });
    note(top, bot, c.od ?? 2.875);
  });
  for (const p of wson.perforations ?? []) {
    parts.push({ kind: 'perf', label: p.label ?? 'perf', color: p.color ?? '#e53e3e', odIn: 0, top: p.top, bot: p.bot, pTop: at(p.top), pBot: at(p.bot) });
    note(p.top, p.bot, 0);
  }

  return { parts, tvdMax, maxOdIn: maxOdIn || 10, deviated: wson.profile != null && wson.profile.length > 1 };
}
