<script lang="ts">
  // Chart — a data chart drawn as PURE, SSR-safe inline SVG: bar / line / area / pie / donut.
  // Like Gantt/NodeTree it SERVER-RENDERS — it reads its rows from an app VARIABLE
  // (props.rowsVar → vars[name]) or an inline props.rows array (or a server-resolved `preloaded`
  // when a source is bound), and computes ALL scales/axis/ticks/slice-geometry in plain JS at
  // render (no canvas, no browser APIs, no onMount) so the whole chart is in the first paint.
  // SINGLE-SERIES for v1 (one yField) — the data pipeline is shaped so a future yFields[] slots
  // in cleanly. BUNDLE component (app_components/Chart/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';

  let {
    panel,
    params,
    vars,
    preloaded,
  }: {
    panel: Panel;
    params?: Record<string, unknown>;
    vars?: Record<string, unknown>;
    /** Server-resolved rows (SSR) when a `source` is bound; used synchronously — no client fetch. */
    preloaded?: unknown;
  } = $props();

  const VIEW_W = 600; // internal SVG coordinate width; height is props.height. Responsive via viewBox.

  // A fixed categorical palette for pie/donut slices (bar/line/area use props.color). Colour-safe,
  // theme-neutral. First entry ~= the default accent so a single-series feel stays consistent.
  const PALETTE = [
    '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899',
    '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#eab308',
  ];

  // ---- pure helpers (no state, no browser APIs) -----------------------------------------------
  function get(obj: any, path: string): unknown {
    if (obj == null) return undefined;
    if (path.indexOf('.') < 0) return obj[path];
    return path.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), obj);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function fmt(v: number): string {
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    if (a >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (a >= 1_000) return (v / 1_000).toFixed(a >= 10_000 ? 0 : 1) + 'k';
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(a < 1 ? 2 : 1);
  }
  function niceNum(range: number, round: boolean): number {
    if (!(range > 0)) return 1;
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function niceTicks(min: number, max: number, count: number): { ticks: number[]; min: number; max: number } {
    if (!(max > min)) return { ticks: [min], min, max: min + 1 };
    const range = niceNum(max - min, false);
    const step = niceNum(range / Math.max(1, count - 1), true);
    const nMin = Math.floor(min / step) * step;
    const nMax = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    for (let v = nMin; v <= nMax + step * 0.5; v += step) ticks.push(Math.round(v / step) * step);
    return { ticks, min: nMin, max: nMax };
  }
  // A slice/wedge path; innerR > 0 → donut ring segment, else a full pie wedge from the centre.
  function arcPath(cx: number, cy: number, r: number, a0: number, a1: number, innerR: number): string {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = r2(cx + r * Math.cos(a0)), y0 = r2(cy + r * Math.sin(a0));
    const x1 = r2(cx + r * Math.cos(a1)), y1 = r2(cy + r * Math.sin(a1));
    if (innerR > 0) {
      const xi1 = r2(cx + innerR * Math.cos(a1)), yi1 = r2(cy + innerR * Math.sin(a1));
      const xi0 = r2(cx + innerR * Math.cos(a0)), yi0 = r2(cy + innerR * Math.sin(a0));
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${innerR} ${innerR} 0 ${large} 0 ${xi0} ${yi0} Z`;
    }
    return `M ${r2(cx)} ${r2(cy)} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
  }

  // ---- props ----------------------------------------------------------------------------------
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const type = $derived(String(p.type ?? 'bar'));
  const color = $derived(String(p.color ?? '#3b82f6'));
  const height = $derived(Math.max(120, Number(p.height ?? 240)));
  const showAxis = $derived(p.showAxis !== false);
  const showLegend = $derived(p.showLegend === true);
  const valueLabels = $derived(p.valueLabels === true);
  const title = $derived(String(resolveRef((p.title ?? panel.title ?? '') as string, { params, vars }) ?? ''));

  const isPie = $derived(type === 'pie' || type === 'donut');
  const isLine = $derived(type === 'line' || type === 'area');
  const isBar = $derived(!isPie && !isLine); // bar + any unknown type falls back to bars

  // ---- rows: server-resolved `preloaded` wins → inline props.rows → vars[rowsVar] --------------
  const rowsVar = $derived(String(p.rowsVar ?? 'rows'));
  const rawRows = $derived.by<any[]>(() => {
    if (preloaded !== undefined) return Array.isArray(preloaded) ? preloaded : preloaded ? [preloaded] : [];
    const inline = p.rows != null ? resolveRef(p.rows, { params, vars }) : undefined;
    if (Array.isArray(inline)) return inline;
    const v = vars?.[rowsVar];
    return Array.isArray(v) ? v : [];
  });

  // x = category/label field, y = numeric value field; inferred from the first row when omitted.
  const fields = $derived.by(() => {
    const first = (rawRows.find((r) => r && typeof r === 'object') ?? {}) as Record<string, unknown>;
    const keys = Object.keys(first);
    const x = String(p.xField ?? '') || keys.find((k) => typeof first[k] === 'string') || keys[0] || 'x';
    const y =
      String(p.yField ?? '') ||
      keys.find((k) => k !== x && Number.isFinite(Number(first[k]))) ||
      keys.find((k) => k !== x) ||
      keys[0] ||
      'y';
    return { x, y };
  });

  // One data series (v1). Coerce y to a number; skip non-finite. (Shape ready for future yFields[].)
  const series = $derived.by(() => {
    const out: Array<{ label: string; value: number; i: number }> = [];
    let i = 0;
    for (const r of rawRows) {
      if (!r || typeof r !== 'object') continue;
      const y = Number(get(r, fields.y));
      if (!Number.isFinite(y)) continue;
      const lbl = get(r, fields.x);
      out.push({ label: lbl == null ? String(i + 1) : String(lbl), value: y, i });
      i++;
    }
    return out;
  });

  // ---- cartesian layout (bar / line / area) ---------------------------------------------------
  const cart = $derived.by(() => {
    if (isPie || !series.length) return null;
    const W = VIEW_W, H = height;
    const padL = showAxis ? 46 : 14, padR = 14, padT = 12, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const vals = series.map((s) => s.value);
    let dMin = Math.min(0, ...vals);
    let dMax = Math.max(...vals);
    if (dMax === dMin) dMax = dMin + 1;
    const nt = niceTicks(dMin, dMax, 4);
    const span = nt.max - nt.min || 1;
    const yToPx = (v: number) => padT + plotH - ((v - nt.min) / span) * plotH;
    const baseline = yToPx(0);
    const n = series.length;
    const slot = plotW / n;

    const bars = series.map((s, i) => {
      const bw = Math.max(1, slot * 0.62);
      const cx = padL + slot * i + slot / 2;
      const yv = yToPx(s.value);
      return { x: r2(cx - bw / 2), y: r2(Math.min(yv, baseline)), w: r2(bw), h: r2(Math.abs(yv - baseline)), cx: r2(cx), yv, value: s.value, label: s.label };
    });

    const pxAt = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
    const pts = series.map((s, i) => ({ x: r2(pxAt(i)), y: r2(yToPx(s.value)), value: s.value, label: s.label }));
    const linePath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    const areaPath = pts.length ? `${linePath} L ${pts[pts.length - 1].x} ${r2(baseline)} L ${pts[0].x} ${r2(baseline)} Z` : '';

    const ticks = nt.ticks.map((v) => ({ v, y: r2(yToPx(v)) }));
    const xTicks = series.map((s, i) => ({ x: isBar ? bars[i].cx : pts[i].x, label: s.label }));
    const labelStep = Math.max(1, Math.ceil(n / 12)); // thin x labels so they don't collide

    return { W, H, padL, padR, padT, padB, plotW, plotH, baseline: r2(baseline), bars, pts, linePath, areaPath, ticks, xTicks, labelStep, n };
  });

  // ---- pie / donut layout ---------------------------------------------------------------------
  const pie = $derived.by(() => {
    if (!isPie || !series.length) return null;
    const W = VIEW_W, H = height;
    const positives = series.filter((s) => s.value > 0);
    const total = positives.reduce((a, s) => a + s.value, 0);
    if (total <= 0) return null;
    const cx = showLegend ? W * 0.34 : W / 2;
    const cy = H / 2;
    const r = Math.max(10, Math.min(showLegend ? W * 0.3 : W * 0.42, H * 0.42));
    const innerR = type === 'donut' ? r * 0.58 : 0;
    const single = positives.length === 1;
    let a = -Math.PI / 2;
    const slices = positives.map((s, idx) => {
      const frac = s.value / total;
      const a0 = a, a1 = a + frac * Math.PI * 2;
      a = a1;
      const mid = (a0 + a1) / 2;
      const labelR = innerR > 0 ? (innerR + r) / 2 : r * 0.62;
      return {
        path: single ? null : arcPath(cx, cy, r, a0, a1, innerR),
        color: PALETTE[idx % PALETTE.length],
        label: s.label,
        value: s.value,
        frac,
        pct: Math.round(frac * 100),
        big: frac > 0.06,
        lx: r2(cx + Math.cos(mid) * labelR),
        ly: r2(cy + Math.sin(mid) * labelR),
      };
    });
    return { W, H, cx: r2(cx), cy: r2(cy), r: r2(r), innerR: r2(innerR), slices, single };
  });

  // ---- legend ---------------------------------------------------------------------------------
  const legend = $derived.by(() => {
    if (!showLegend || !series.length) return [];
    if (isPie) return (pie?.slices ?? []).map((s) => ({ color: s.color, label: s.label, value: fmt(s.value) }));
    return [{ color, label: fields.y, value: '' }]; // single-series cartesian
  });

  const ariaLabel = $derived(`${type} chart${title ? ` — ${title}` : ''}: ${series.length} points`);
</script>

<div class="chart">
  {#if title}<div class="chart-title">{title}</div>{/if}

  {#if !series.length}
    <div class="chart-empty">no data — set props.rowsVar to an app variable holding a list of records (and xField/yField)</div>
  {:else}
    {#if legend.length}
      <div class="chart-legend">
        {#each legend as l, i (i)}
          <span class="lg"><span class="dot" style="background:{l.color}"></span>{l.label}{l.value ? ` (${l.value})` : ''}</span>
        {/each}
      </div>
    {/if}

    <svg
      class="chart-svg"
      viewBox="0 0 {VIEW_W} {height}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      {#if cart}
        <!-- faint horizontal gridlines at each y tick -->
        {#each cart.ticks as t (t.v)}
          <line class="grid" x1={cart.padL} y1={t.y} x2={VIEW_W - cart.padR} y2={t.y} />
          {#if showAxis}
            <text class="y-lbl" x={cart.padL - 6} y={t.y + 3} text-anchor="end">{fmt(t.v)}</text>
          {/if}
        {/each}

        <!-- y axis + zero baseline -->
        {#if showAxis}<line class="axis" x1={cart.padL} y1={cart.padT} x2={cart.padL} y2={cart.padT + cart.plotH} />{/if}
        <line class="baseline" x1={cart.padL} y1={cart.baseline} x2={VIEW_W - cart.padR} y2={cart.baseline} />

        {#if type === 'area'}
          <path class="area" d={cart.areaPath} fill={color} fill-opacity="0.18" stroke="none" />
        {/if}

        {#if isLine}
          <path class="line" d={cart.linePath} fill="none" stroke={color} />
          {#each cart.pts as pt (pt.label + pt.x)}
            <circle class="pt" cx={pt.x} cy={pt.y} r="2.6" fill={color} />
            {#if valueLabels}<text class="v-lbl" x={pt.x} y={pt.y - 6} text-anchor="middle">{fmt(pt.value)}</text>{/if}
          {/each}
        {/if}

        {#if isBar}
          {#each cart.bars as b (b.label + b.x)}
            <rect class="bar" x={b.x} y={b.y} width={b.w} height={b.h} rx="2" fill={color}>
              <title>{b.label}: {fmt(b.value)}</title>
            </rect>
            {#if valueLabels}
              <text class="v-lbl" x={b.cx} y={(b.value >= 0 ? b.y : b.y + b.h) - 4} text-anchor="middle">{fmt(b.value)}</text>
            {/if}
          {/each}
        {/if}

        <!-- x category labels (thinned so they don't collide) -->
        {#each cart.xTicks as xt, i (i)}
          {#if i % cart.labelStep === 0}
            <text class="x-lbl" x={xt.x} y={cart.padT + cart.plotH + 16} text-anchor="middle">{truncate(xt.label, 10)}</text>
          {/if}
        {/each}
      {:else if pie}
        {#if pie.single}
          <!-- a single 100% slice can't be drawn as one arc → a plain circle (donut = ring) -->
          <circle cx={pie.cx} cy={pie.cy} r={pie.r} fill={pie.slices[0].color} />
          {#if pie.innerR > 0}<circle class="donut-hole" cx={pie.cx} cy={pie.cy} r={pie.innerR} />{/if}
          {#if pie.slices[0].big && !showLegend}
            <text class="slice-lbl" x={pie.cx} y={pie.cy} text-anchor="middle">{truncate(pie.slices[0].label, 14)}</text>
          {/if}
        {:else}
          {#each pie.slices as s, i (s.label + i)}
            <path class="slice" d={s.path} fill={s.color}>
              <title>{s.label}: {fmt(s.value)} ({s.pct}%)</title>
            </path>
          {/each}
          {#each pie.slices as s, i (s.label + i)}
            {#if s.big}
              {#if !showLegend}
                <text class="slice-lbl" x={s.lx} y={s.ly - 4} text-anchor="middle">{truncate(s.label, 12)}</text>
                <text class="slice-pct" x={s.lx} y={s.ly + 9} text-anchor="middle">{s.pct}%</text>
              {:else}
                <text class="slice-pct" x={s.lx} y={s.ly + 3} text-anchor="middle">{s.pct}%</text>
              {/if}
            {/if}
          {/each}
        {/if}
      {/if}
    </svg>
  {/if}
</div>

<style>
  .chart {
    font: 12px/1.4 system-ui, Arial, sans-serif;
    color: var(--h-text, #0f172a);
    border: 1px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    background: var(--h-surface, #fff);
    overflow: hidden;
  }
  .chart-title { padding: 10px 12px 6px; font-size: 15px; font-weight: 660; }
  .chart-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 0 12px 8px; }
  .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--h-muted, #64748b); }
  .dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; flex: 0 0 auto; }

  .chart-svg { display: block; width: 100%; height: auto; max-width: 100%; padding: 4px 8px 8px; box-sizing: border-box; }

  .grid { stroke: var(--h-border, #eef2f7); stroke-width: 1; }
  .axis { stroke: var(--h-border, #cbd5e1); stroke-width: 1; }
  .baseline { stroke: var(--h-border, #94a3b8); stroke-width: 1.25; }
  .line { stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .bar { opacity: 0.92; }
  .slice { stroke: var(--h-surface, #fff); stroke-width: 1.25; }
  .donut-hole { fill: var(--h-surface, #fff); }

  .y-lbl, .x-lbl { font-size: 10px; fill: var(--h-muted, #94a3b8); }
  .v-lbl { font-size: 10px; font-weight: 600; fill: var(--h-muted, #64748b); }
  .slice-lbl { font-size: 10px; font-weight: 600; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,0.28); stroke-width: 2px; }
  .slice-pct { font-size: 9px; font-weight: 600; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,0.28); stroke-width: 2px; }

  .chart-empty { padding: 16px; color: var(--h-muted, #94a3b8); font-style: italic; }
</style>
