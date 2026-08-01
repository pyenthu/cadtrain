// app_components/StatGrid/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with StatGrid.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'statgrid',
    name: 'Stat Grid',
    description: 'A responsive auto-flow grid of equal tiles (stats/charts/cards) — holds nested children.',
    useWhen:
      'A responsive grid of equal tiles — use to lay out several stat/chart/card tiles in a dashboard ' +
      'header; use row/col for simple flex, container for a plain wrapper.',
    example: {
      id: 'kpis',
      kind: 'statgrid',
      props: { minTileWidth: 200, gap: 12 },
      children: [
        { id: 'stat_a', kind: 'card', title: 'Total', children: [] },
        { id: 'stat_b', kind: 'card', title: 'Active', children: [] },
      ],
    },
    group: 'layout',
    dataMode: 'static',
    tags: ['statgrid', 'grid', 'tiles', 'dashboard', 'kpi', 'layout', 'cards'],
    acceptsChildren: true,
    props: [
      { name: 'minTileWidth', type: 'number', label: 'Min tile width (px)', default: 200 },
      { name: 'columns', type: 'number', label: 'Columns (fixed)' },
      { name: 'gap', type: 'number', label: 'Gap (px)', default: 12 },
    ],
  },
];
