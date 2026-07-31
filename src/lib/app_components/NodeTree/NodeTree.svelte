<script lang="ts">
  // NodeTree — an SSR-safe architecture graph: a nodes+edges list laid out LEFT→RIGHT by depth
  // (x = depth·colWidth; siblings stack; parents centre over their subtree), drawn as PURE SVG.
  // Replicates the /design ArchGraph idiom WITHOUT xyflow (which is client-only) so it renders
  // server-side. SERVER-RENDERS like Gantt/WellSchematic: it reads its nodes/edges from app
  // VARIABLES (props.nodesVar/edgesVar → vars[name]) or inline props arrays — no onMount fetch —
  // so the whole diagram is in the first paint and curl'able. Pure layout math lives in
  // node-tree-layout.ts (unit-tested). BUNDLE component (app_components/NodeTree/). See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';
  import {
    normalizeNodes,
    normalizeEdges,
    layoutTree,
    layoutEdges,
    nodeColor,
    edgeColor,
    nodeLegend,
    truncate,
  } from './node-tree-layout';

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
  function rows(inlineKey: string, varKey: string, fallbackVar: string): unknown {
    const inline = p[inlineKey] != null ? resolveRef(p[inlineKey], { params, vars }) : undefined;
    if (Array.isArray(inline)) return inline;
    const name = String(p[varKey] ?? fallbackVar);
    return vars?.[name];
  }

  const nodes = $derived(normalizeNodes(rows('nodes', 'nodesVar', 'nodes')));
  const edges = $derived(normalizeEdges(rows('edges', 'edgesVar', 'edges')));

  const opts = $derived({
    colWidth: Number(p.colWidth ?? 210),
    rowGap: Number(p.rowGap ?? 46),
    nodeW: Number(p.nodeWidth ?? 172),
  });

  const layout = $derived(layoutTree(nodes, opts));
  const laidEdges = $derived(layoutEdges(edges, layout.byId));
  const legend = $derived(nodeLegend(nodes));

  const title = $derived(String(resolveRef((p.title ?? panel.title) as string, { params, vars }) ?? ''));
  const showHier = $derived(p.showHierarchy !== false); // draw the parent→child skeleton unless off
  const showEdgeLabels = $derived(p.edgeLabels !== false);
</script>

<div class="nt">
  {#if title}<div class="nt-title">{title}</div>{/if}

  {#if legend.length}
    <div class="nt-legend">
      {#each legend as l (l.kind)}
        <span class="lg"><span class="sw" style="background:{l.color.fill};border-color:{l.color.stroke}"></span>{l.kind} ({l.count})</span>
      {/each}
    </div>
  {/if}

  {#if nodes.length}
    <div class="nt-scroll">
      <svg
        class="nt-svg"
        viewBox="0 0 {layout.width} {layout.height}"
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={`Architecture graph${title ? ` — ${title}` : ''}: ${nodes.length} nodes, ${edges.length} edges`}
      >
        <!-- parent→child skeleton (subtle) -->
        {#if showHier}
          {#each layout.links as lk, i (i)}
            <path class="nt-hier" d={lk.path} fill="none" stroke={edgeColor('hier')} />
          {/each}
        {/if}

        <!-- seeded edges (coloured by relationship kind) -->
        {#each laidEdges as e, i (i)}
          <path
            class="nt-edge"
            d={e.path}
            fill="none"
            stroke={edgeColor(e.kind)}
            stroke-dasharray={e.kind === 'flow' ? '5 4' : undefined}
          />
          {#if showEdgeLabels && e.label}
            <text class="nt-edge-lbl" x={e.mid.x} y={e.mid.y - 3} text-anchor="middle" fill={edgeColor(e.kind)}>{e.label}</text>
          {/if}
        {/each}

        <!-- nodes -->
        {#each layout.nodes as n (n.id)}
          {@const c = nodeColor(n.kind)}
          {@const dashed = n.planned || n.archived}
          <g class="nt-node" opacity={n.archived ? 0.55 : 1} data-kind={n.kind} data-id={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={n.w}
              height={n.h}
              rx="6"
              fill={c.fill}
              stroke={n.accent ?? c.stroke}
              stroke-width={n.kind === 'system' || n.kind === 'container' ? 2 : 1.25}
              stroke-dasharray={dashed ? '5 3' : undefined}
            />
            <!-- kind accent tab on the left edge -->
            <rect x={n.x} y={n.y} width="4" height={n.h} rx="2" fill={n.accent ?? c.stroke} />
            {#if n.tech}
              <text class="nt-lbl" x={n.x + 12} y={n.cy - 3} fill={c.text}>{truncate(n.label, 24)}</text>
              <text class="nt-tech" x={n.x + 12} y={n.cy + 11} fill={c.text}>{truncate(n.tech, 26)}</text>
            {:else}
              <text class="nt-lbl nt-lbl-mid" x={n.x + 12} y={n.cy + 4} fill={c.text}>{truncate(n.label, 24)}</text>
            {/if}
          </g>
        {/each}
      </svg>
    </div>
  {:else}
    <div class="nt-empty">no nodes — set props.nodesVar to an app variable holding a list of node records</div>
  {/if}
</div>

<style>
  .nt {
    font: 12px/1.4 system-ui, Arial, sans-serif;
    color: var(--h-text, #0f172a);
    border: 1px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    background: var(--h-surface, #fff);
    overflow: hidden;
  }
  .nt-title { padding: 10px 12px 6px; font-size: 15px; font-weight: 660; }
  .nt-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 0 12px 8px; }
  .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--h-muted, #64748b); text-transform: capitalize; }
  .sw { width: 11px; height: 11px; border-radius: 2px; border: 1px solid; display: inline-block; }
  .nt-scroll { overflow: auto; padding: 0 8px 10px; max-height: 78vh; }
  .nt-svg { display: block; }
  .nt-hier { stroke-width: 1.25; opacity: 0.9; }
  .nt-edge { stroke-width: 1.5; opacity: 0.9; }
  .nt-edge-lbl { font-size: 9px; font-weight: 600; paint-order: stroke; stroke: var(--h-surface, #fff); stroke-width: 2.5px; }
  .nt-lbl { font-size: 11px; font-weight: 600; }
  .nt-lbl-mid { dominant-baseline: middle; }
  .nt-tech { font-size: 9px; opacity: 0.75; }
  .nt-empty { padding: 16px; color: var(--h-muted, #94a3b8); font-style: italic; }
</style>
