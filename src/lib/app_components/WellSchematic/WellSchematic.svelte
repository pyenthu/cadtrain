<script lang="ts">
  // WellSchematic — a lightweight SVG well cross-section: casing strings, open-hole sections,
  // a centred tubing string, cement, and perforations, drawn from SEEDED app variables.
  //
  // SERVER-RENDERS like Gantt: it reads its rows from app VARIABLES (props.<x>Var → vars[name])
  // or inline props arrays — no onMount fetch — so the whole diagram is in the first paint and
  // curl'able for headless verify. Pure layout math lives in well-schematic-layout.ts (unit-tested).
  // BUNDLE component (app_components/WellSchematic/). See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';
  import { buildSchematic } from './well-schematic-layout';

  let {
    panel,
    params,
    vars,
  }: {
    panel: Panel;
    params?: Record<string, unknown>;
    vars?: Record<string, unknown>;
  } = $props();

  const p = $derived((panel.props ?? {}) as Record<string, unknown>);

  // An inline props.<x> (array or a $vars ref) wins; else vars[<x>Var] (a seeded list<record>).
  function rows(inlineKey: string, varKey: string, fallbackVar: string): unknown[] {
    const inline = p[inlineKey] != null ? resolveRef(p[inlineKey], { params, vars }) : undefined;
    if (Array.isArray(inline)) return inline;
    const name = String(p[varKey] ?? fallbackVar);
    const v = vars?.[name];
    return Array.isArray(v) ? v : [];
  }

  const casings = $derived(rows('casings', 'casingsVar', 'casings'));
  const holes = $derived(rows('holes', 'holesVar', 'holes'));
  const tubing = $derived(rows('tubing', 'tubingVar', 'tubing'));
  const perforations = $derived(rows('perforations', 'perfsVar', 'perforations'));
  const cement = $derived(rows('cement', 'cementVar', 'cement'));

  const width = $derived(Number(p.width ?? 380));
  const height = $derived(Number(p.height ?? 520));
  const unit = $derived(String(p.depthUnit ?? 'ft'));

  // Header label from a seeded `well` record (props.wellVar) or an explicit title.
  const well = $derived.by(() => {
    const name = String(p.wellVar ?? 'well');
    const w = vars?.[name];
    return w && typeof w === 'object' ? (w as Record<string, unknown>) : {};
  });
  const title = $derived(
    String(resolveRef((p.title ?? panel.title) as string, { params, vars }) ?? '') ||
      String(well.name ?? 'Well Schematic'),
  );
  const subtitle = $derived(
    [well.field, well.company].filter(Boolean).join(' · ') || String(well.location ?? ''),
  );

  const view = $derived(buildSchematic({ casings, holes, tubing, perforations, cement, width, height }));

  const legend = [
    { key: 'casing', label: 'Casing', fill: '#e6f2f7', stroke: '#0f3d56' },
    { key: 'openhole', label: 'Open hole', fill: '#f3e3ec', stroke: '#b4477f' },
    { key: 'tubing', label: 'Tubing', fill: '#fde9a9', stroke: '#8a5a00' },
    { key: 'cement', label: 'Cement', fill: '#d8d8d8', stroke: '#888' },
    { key: 'perf', label: 'Perforation', fill: '#e11d48', stroke: '#e11d48' },
  ];

  function fmt(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
</script>

<div class="ws">
  <div class="ws-head">
    <div class="ws-title">{title}</div>
    {#if subtitle}<div class="ws-sub">{subtitle}</div>{/if}
  </div>

  <div class="ws-legend">
    {#each legend as l (l.key)}
      <span class="lg"><span class="sw" style="background:{l.fill};border-color:{l.stroke}"></span>{l.label}</span>
    {/each}
  </div>

  <div class="ws-scroll">
    <svg
      class="ws-svg"
      viewBox="0 0 {view.plot.width} {view.plot.height}"
      width={view.plot.width}
      height={view.plot.height}
      role="img"
      aria-label={`Well schematic for ${title}`}
    >
      <defs>
        <pattern id="ws-cement" patternUnits="userSpaceOnUse" width="6" height="6">
          <rect width="6" height="6" fill="#ededed" />
          <circle cx="2" cy="2" r="1" fill="#8a8a8a" />
        </pattern>
      </defs>

      <!-- centre axis -->
      <line
        class="ws-axis"
        x1={view.plot.cx}
        y1={view.plot.margin.top}
        x2={view.plot.cx}
        y2={view.plot.margin.top + view.plot.plotH}
      />

      <!-- depth ruler -->
      {#each view.depthTicks as t (t.depth)}
        <line class="ws-grid" x1={view.plot.margin.left} y1={t.y} x2={view.plot.width - view.plot.margin.right} y2={t.y} />
        <text class="ws-depth" x={view.plot.margin.left - 6} y={t.y + 3} text-anchor="end">{t.label}</text>
      {/each}
      <text class="ws-unit" x={view.plot.margin.left - 6} y={view.plot.margin.top - 12} text-anchor="end">{unit}</text>

      <!-- open hole (behind) -->
      {#each view.holes as h, i (i)}
        <rect
          class="ws-rect ws-hole"
          x={h.x}
          y={h.y}
          width={h.w}
          height={h.h}
          fill={h.fill}
          stroke={h.stroke}
        />
      {/each}

      <!-- cement -->
      {#each view.cement as c, i (i)}
        <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} stroke="none" />
      {/each}

      <!-- casings (widest first) -->
      {#each view.casings as c, i (i)}
        <rect class="ws-rect" x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} stroke={c.stroke} />
        <text class="ws-lbl" x={c.x + c.w + 3} y={c.y + 11}>{fmt(c.od)}"{c.grade ? ` ${c.grade}` : ''}</text>
      {/each}

      <!-- tubing (centred) -->
      {#each view.tubing as t, i (i)}
        <rect class="ws-rect" x={t.x} y={t.y} width={t.w} height={t.h} fill={t.fill} stroke={t.stroke} />
      {/each}

      <!-- perforations: chevron ticks on both walls -->
      {#each view.perfs as pf, i (i)}
        {@const my = (pf.yTop + pf.yBot) / 2}
        <rect class="ws-perf-band" x={pf.xLeft} y={pf.yTop} width={pf.xRight - pf.xLeft} height={Math.max(2, pf.yBot - pf.yTop)} fill={pf.color} />
        <polygon class="ws-perf" points={`${pf.xLeft},${pf.yTop} ${pf.xLeft - 8},${my} ${pf.xLeft},${pf.yBot}`} fill={pf.color} />
        <polygon class="ws-perf" points={`${pf.xRight},${pf.yTop} ${pf.xRight + 8},${my} ${pf.xRight},${pf.yBot}`} fill={pf.color} />
        {#if pf.label}<text class="ws-perf-lbl" x={pf.xRight + 11} y={my + 3}>{pf.label}</text>{/if}
      {/each}
    </svg>
  </div>
</div>

<style>
  .ws {
    font: 12px/1.4 system-ui, Arial, sans-serif;
    color: var(--h-text, #0f172a);
    border: 1px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    background: var(--h-surface, #fff);
    overflow: hidden;
  }
  .ws-head { padding: 10px 12px 4px; }
  .ws-title { font-size: 15px; font-weight: 660; }
  .ws-sub { font-size: 11px; color: var(--h-muted, #64748b); }
  .ws-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 4px 12px 8px; }
  .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--h-muted, #64748b); }
  .sw { width: 11px; height: 11px; border-radius: 2px; border: 1px solid; display: inline-block; }
  .ws-scroll { overflow: auto; padding: 0 8px 10px; }
  .ws-svg { display: block; }
  .ws-axis { stroke: #cbd5e1; stroke-width: 1; stroke-dasharray: 3 3; }
  .ws-grid { stroke: #f1f5f9; stroke-width: 1; }
  .ws-depth { font-size: 9px; fill: var(--h-muted, #94a3b8); }
  .ws-unit { font-size: 9px; fill: var(--h-muted, #94a3b8); font-weight: 600; }
  .ws-rect { stroke-width: 1.5; }
  .ws-hole { stroke-width: 1.5; stroke-dasharray: 3 2; }
  .ws-lbl { font-size: 9px; fill: #0f3d56; font-weight: 600; }
  .ws-perf-band { opacity: 0.85; }
  .ws-perf-lbl { font-size: 8.5px; fill: var(--h-muted, #64748b); }
</style>
