<script lang="ts">
  // Gantt — a timeline of task BARS positioned by start/end across a shared axis, coloured by
  // status, grouped by lane (a swimlane per lane). SERVER-RENDERS: it reads its rows from an
  // app VARIABLE (props.rowsVar → vars[name]) or an inline props.rows array — no onMount fetch —
  // so all bars are in the first paint. Pure layout math lives in gantt-layout.ts (unit-tested).
  // BUNDLE component (app_components/Gantt/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';
  import {
    normalizeRows,
    computeRange,
    groupByLane,
    barGeometry,
    statusColor,
    statusLegend,
    axisTicks,
    type GanttFieldMap,
  } from './gantt-layout';

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

  // Rows: an inline props.rows (array or a $vars ref) wins; else vars[rowsVar] (default "tasks").
  const rowsVar = $derived(String(p.rowsVar ?? 'tasks'));
  const rawRows = $derived.by(() => {
    const inline = p.rows != null ? resolveRef(p.rows, { params, vars }) : undefined;
    if (Array.isArray(inline)) return inline;
    return (vars?.[rowsVar] as unknown) ?? [];
  });

  // Optional field remap (e.g. a /plan record uses `weeks` for duration instead of `end`).
  const fields = $derived.by<GanttFieldMap>(() => {
    const f: GanttFieldMap = {};
    for (const k of ['id', 'label', 'lane', 'start', 'end', 'status', 'details', 'duration'] as const) {
      const key = p[`${k}Field`];
      if (typeof key === 'string' && key) f[k] = key;
    }
    return f;
  });

  const rows = $derived(normalizeRows(rawRows, fields));
  const rangeStart = $derived(p.rangeStart != null ? Number(p.rangeStart) : undefined);
  const rangeEnd = $derived(p.rangeEnd != null ? Number(p.rangeEnd) : undefined);
  const range = $derived(computeRange(rows, rangeStart, rangeEnd));
  const lanes = $derived(groupByLane(rows));
  const ticks = $derived(axisTicks(range, Number(p.tickCount ?? 6)));
  const legend = $derived(statusLegend(rows));

  const unit = $derived(String(p.unit ?? ''));
  const title = $derived(resolveRef((p.title ?? panel.title) as string, { params, vars }));
  const labelW = $derived(Number(p.labelWidth ?? 240));

  function fmt(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
</script>

<div class="gantt" style="--label-w:{labelW}px;">
  {#if title}<div class="gantt-title">{title}</div>{/if}

  {#if legend.length}
    <div class="gantt-legend">
      {#each legend as l (l.status)}
        <span class="lg"><span class="dot" style="background:{l.color}"></span>{l.status} ({l.count})</span>
      {/each}
    </div>
  {/if}

  {#if rows.length}
    <div class="gantt-scroll">
      <!-- Axis header: label gutter + tick marks across the track. -->
      <div class="axis-row">
        <div class="axis-gutter">Task{unit ? ` (${unit})` : ''}</div>
        <div class="axis-track">
          {#each ticks as t, i (i)}
            <span class="axis-tick" style="left:{t.leftPct}%;">{fmt(t.value)}</span>
          {/each}
        </div>
      </div>

      {#each lanes as lane (lane.lane)}
        <div class="lane-head">{lane.lane} <span class="lane-count">· {lane.rows.length}</span></div>
        {#each lane.rows as row (row.id)}
          {@const g = barGeometry(row, range)}
          <div class="task-row">
            <div class="task-label" title={row.label}>
              <span class="task-code">#{row.id}</span>
              <span class="task-title">{row.label}</span>
            </div>
            <div class="task-track">
              {#each ticks as t, i (i)}<span class="gridline" style="left:{t.leftPct}%;"></span>{/each}
              <div
                class="bar"
                style="left:{g.leftPct}%; width:max({g.widthPct}%, 6px); background:{statusColor(row.status)};"
                title={`#${row.id} — ${row.label}\nlane: ${row.lane} · status: ${row.status}\n${fmt(row.start)} → ${fmt(row.end)}${unit ? ' ' + unit : ''}${row.details ? '\n' + row.details : ''}`}
              >
                <span class="bar-status">{row.status}</span>
              </div>
            </div>
          </div>
        {/each}
      {/each}
    </div>
  {:else}
    <div class="gantt-empty">no tasks — set props.rowsVar to an app variable holding a list of task records</div>
  {/if}
</div>

<style>
  .gantt {
    font: 12px/1.4 system-ui, Arial, sans-serif;
    color: var(--h-text, #0f172a);
    border: 1px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    background: var(--h-surface, #fff);
    overflow: hidden;
  }
  .gantt-title { padding: 10px 12px 6px; font-size: 15px; font-weight: 660; }
  .gantt-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 0 12px 8px; }
  .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--h-muted, #64748b); text-transform: capitalize; }
  .dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

  .gantt-scroll { overflow-x: auto; }
  .axis-row, .task-row { display: flex; align-items: stretch; }
  .axis-gutter, .task-label { width: var(--label-w, 240px); flex: 0 0 var(--label-w, 240px); box-sizing: border-box; padding: 4px 10px; border-right: 1px solid var(--h-border, #e5e7eb); }
  .axis-gutter { font-weight: 600; font-size: 11px; color: var(--h-muted, #64748b); text-transform: uppercase; letter-spacing: .3px; }
  .axis-track, .task-track { position: relative; flex: 1 1 auto; min-width: 320px; height: 24px; }
  .axis-row { border-bottom: 1px solid var(--h-border, #e5e7eb); background: var(--h-bg, #f8fafc); }
  .axis-track { height: 22px; }
  .axis-tick { position: absolute; top: 3px; transform: translateX(-50%); font-size: 10px; color: var(--h-muted, #94a3b8); white-space: nowrap; }
  .axis-tick:first-child { transform: none; }

  .lane-head { padding: 5px 10px; font-size: 11px; font-weight: 700; letter-spacing: .2px; background: color-mix(in srgb, var(--h-accent, #0369a1) 8%, transparent); color: var(--h-text, #0f172a); border-bottom: 1px solid var(--h-border, #eef2f7); }
  .lane-count { color: var(--h-muted, #94a3b8); font-weight: 500; }

  .task-row { border-bottom: 1px solid var(--h-border, #f1f5f9); }
  .task-label { display: flex; align-items: center; gap: 6px; overflow: hidden; }
  .task-code { flex: 0 0 auto; font: 600 10px ui-monospace, monospace; color: var(--h-muted, #94a3b8); }
  .task-title { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--h-border, #f1f5f9); }
  .bar { position: absolute; top: 3px; height: 16px; min-width: 6px; border-radius: 3px; display: flex; align-items: center; padding: 0 5px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06); overflow: hidden; }
  .bar-status { font-size: 9px; font-weight: 600; color: #fff; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; text-shadow: 0 1px 1px rgba(0,0,0,0.25); }
  .gantt-empty { padding: 16px; color: var(--h-muted, #94a3b8); font-style: italic; }
</style>
