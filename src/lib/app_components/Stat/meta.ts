// app_components/Stat/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Stat.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'stat',
    name: 'Stat',
    description:
      'A KPI stat tile — a big headline number + label, with optional unit/delta/sparkline. ' +
      'value/delta can be a $vars/$params ref; sparklineVar names a vars array of numbers.',
    useWhen:
      'A single headline metric — big number + label + optional delta/sparkline; use for dashboard ' +
      'KPI tiles, NOT a paragraph (text) or a table.',
    example: {
      id: 'revenue',
      kind: 'stat',
      props: {
        label: 'Revenue',
        value: '$vars.revenue',
        format: 'currency',
        delta: '$vars.revenueDelta',
        deltaDir: 'auto',
        accent: '#0369a1',
        icon: '💰',
        sparklineVar: 'revenueTrend',
      },
    },
    group: 'display',
    tags: ['stat', 'kpi', 'metric', 'tile', 'number', 'delta', 'sparkline', 'dashboard'],
    dataMode: 'static',
    props: [
      { name: 'label', type: 'string', label: 'Label', default: 'Metric' },
      { name: 'value', type: 'string', label: 'Value', default: '0' },
      { name: 'unit', type: 'string', label: 'Unit' },
      {
        name: 'format',
        type: 'select',
        label: 'Format',
        options: ['number', 'currency', 'percent', 'compact', 'plain'],
        default: 'plain',
      },
      { name: 'delta', type: 'string', label: 'Delta' },
      {
        name: 'deltaDir',
        type: 'select',
        label: 'Delta direction',
        options: ['auto', 'up', 'down'],
        default: 'auto',
      },
      { name: 'accent', type: 'color', label: 'Accent' },
      { name: 'icon', type: 'string', label: 'Icon' },
      { name: 'sparklineVar', type: 'string', label: 'Sparkline var' },
    ],
  },
];
