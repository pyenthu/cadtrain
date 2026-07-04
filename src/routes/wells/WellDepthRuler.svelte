<script lang="ts">
  /**
   * WellDepthRuler — on-diagram depth axis + component leader labels (W-C,
   * `docs/plans/wells-interface.md` §C). An HTML/SVG overlay pinned down the
   * LEFT edge of the stage — the robust approach over 3D billboards (which need
   * the live camera projection): a linear DISPLAY-depth axis with true-MD tick
   * labels + a side-rail label column with leader lines for casings, perfs and
   * completions.
   *
   * SHARED SCALE — this NEVER re-derives DTX. It receives the exact `remap`
   * (raw MD → display depth) that `WellSchematic3D` publishes via `onDepthMap`,
   * so cluttered zones get the same vertical emphasis the shells do. Ticks are
   * placed at even TRUE-MD intervals; their uneven Y spacing IS the DTX effect.
   *
   * The overlay is non-interactive (pointer-events:none) so it never steals
   * OrbitControls drags. `whiteBg` flips the palette to dark-on-white so it
   * stays legible on the white schematic background.
   */
  import type { WsonDoc } from './wson-summary';
  import { spreadLabels } from './label-layout';

  let {
    wson,
    remap,
    rawTd,
    whiteBg = false,
    leftInset = 0,
  }: {
    wson: WsonDoc | null;
    /** raw MD → display depth — the SAME fn WellSchematic3D uses. */
    remap: (md: number) => number;
    rawTd: number;
    whiteBg?: boolean;
    /** px offset from the stage's left edge (clears the element rail). */
    leftInset?: number;
  } = $props();

  // Measured drawable height (below the control bar → bottom inset).
  let h = $state(0);

  const displayTd = $derived(Math.max(1, remap(rawTd)));
  /** display-depth → pixel Y within the drawable band. */
  const yOf = $derived((md: number) => (remap(md) / displayTd) * h);

  // ── Nice MD tick step (aim ~7 ticks) ───────────────────────────────────────
  function niceStep(range: number, target: number): number {
    if (!(range > 0)) return 1;
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return step * mag;
  }
  const ticks = $derived.by(() => {
    const step = niceStep(rawTd, 7);
    const out: number[] = [];
    for (let d = 0; d <= rawTd + 1e-6; d += step) out.push(Math.round(d));
    if (out[out.length - 1] !== Math.round(rawTd)) out.push(Math.round(rawTd));
    return out;
  });

  // ── Component / perf leader labels ──────────────────────────────────────────
  interface RawRow { top?: number; bot?: number; od?: number; type?: string; grade?: string;
    label?: string; description?: string; tool_comp?: string; }
  type Lbl = { md: number; text: string; color: string };

  const labels = $derived.by<Lbl[]>(() => {
    if (!wson) return [];
    const out: Lbl[] = [];
    // Casing shoes (at bottom of each string).
    for (const c of (wson.ch ?? []) as RawRow[]) {
      if (typeof c.bot !== 'number') continue;
      const od = c.od != null ? `${c.od}" ` : '';
      out.push({ md: c.bot, text: `${od}${c.type ?? 'csg'} shoe`, color: '#94a3b8' });
    }
    // Perforations (at interval midpoint).
    for (const p of (wson.perforations ?? []) as RawRow[]) {
      if (typeof p.top !== 'number' || typeof p.bot !== 'number') continue;
      out.push({ md: (p.top + p.bot) / 2, text: p.label ?? 'Perf', color: '#ef4444' });
    }
    // Completions (skip the long tubing string — it's not a point feature).
    for (const c of (wson.completions ?? []) as RawRow[]) {
      const desc = c.description ?? c.tool_comp ?? '';
      if (!desc || /tubing joints/i.test(desc)) continue;
      const top = c.top ?? 0, bot = c.bot ?? top;
      out.push({ md: (top + bot) / 2, text: desc, color: '#f59e0b' });
    }
    return out.sort((a, b) => a.md - b.md);
  });

  // Vertical anti-overlap: a FORCE de-overlap (labella "simple" parity, pure
  // `spreadLabels`) that centres clustered labels on their anchors instead of
  // only nudging downward — dense zones read cleanly. Anchors stay put; only
  // the label boxes + their leaders move. Clamped into the drawable band.
  const LABEL_GAP = 15;
  const placedLabels = $derived.by(() => {
    const anchors = labels.map((l) => yOf(l.md));
    const ys = spreadLabels(anchors, { gap: LABEL_GAP, min: 6, max: Math.max(6, h - 6) });
    return labels.map((l, i) => ({ ...l, anchorY: anchors[i], y: ys[i] }));
  });

  // Palette (dark chrome vs. dark-on-white for the schematic background).
  const axisCol = $derived(whiteBg ? '#556' : '#8899bb');
  const tickTxt = $derived(whiteBg ? '#334' : '#aab');
  const leaderCol = $derived(whiteBg ? '#99a' : '#556');
  const labelBg = $derived(whiteBg ? 'rgba(255,255,255,0.85)' : 'rgba(16,16,26,0.8)');
  const labelTxt = $derived(whiteBg ? '#223' : '#dde');

  const AXIS_X = 46; // px from the left edge to the vertical axis line
  const LABEL_X = 58; // where leader labels start
</script>

<div class="wdr" style="left:{leftInset}px" bind:clientHeight={h} aria-hidden="true">
  {#if h > 0 && rawTd > 0}
    <svg width="100%" height={h} class="wdr-svg">
      <!-- vertical axis -->
      <line x1={AXIS_X} y1={0} x2={AXIS_X} y2={h} stroke={axisCol} stroke-width="1" />
      <!-- MD ticks -->
      {#each ticks as t}
        {@const y = yOf(t)}
        <line x1={AXIS_X - 5} y1={y} x2={AXIS_X} y2={y} stroke={axisCol} stroke-width="1" />
        <text x={AXIS_X - 7} y={y + 3} text-anchor="end" font-size="9"
          fill={tickTxt} font-family="ui-monospace, monospace">{t}</text>
      {/each}
      <!-- unit caption -->
      <text x={2} y={11} font-size="8" fill={tickTxt} font-family="ui-monospace, monospace"
        letter-spacing="0.5">MD·m</text>

      <!-- component leader labels -->
      {#each placedLabels as l}
        <line x1={AXIS_X} y1={l.anchorY} x2={LABEL_X} y2={l.y} stroke={leaderCol} stroke-width="1" />
        <circle cx={AXIS_X} cy={l.anchorY} r="2.2" fill={l.color} />
        <g transform="translate({LABEL_X}, {l.y})">
          <rect x="2" y="-7" width={l.text.length * 5.4 + 12} height="14" rx="3"
            fill={labelBg} stroke={l.color} stroke-opacity="0.6" />
          <circle cx="8" cy="0" r="2.4" fill={l.color} />
          <text x="14" y="3" font-size="9" fill={labelTxt} font-family="Arial, sans-serif">{l.text}</text>
        </g>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .wdr {
    position: absolute;
    left: 0; /* overridden inline by leftInset (clears the element rail) */
    top: 56px; /* clear the control bar */
    bottom: 10px;
    width: 220px;
    pointer-events: none; /* never steal OrbitControls drags */
    z-index: 15;
    overflow: visible;
  }
  .wdr-svg { display: block; overflow: visible; }
</style>
