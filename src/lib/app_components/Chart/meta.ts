// app_components/Chart/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Chart.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'chart',
    name: 'Chart',
    description:
      'A data chart drawn as SSR-safe inline SVG — bar / line / area / pie / donut. Reads rows ' +
      'from an app variable (props.rowsVar → vars[name], a list<record>) or an inline props.rows ' +
      'array, plots props.xField (category/label) against props.yField (numeric value); fields are ' +
      'inferred from the first row when omitted. Nice y-axis ticks, faint gridlines, and an ' +
      'optional legend are computed in plain JS, so the whole chart is in the first paint (no ' +
      'client fetch, no canvas). Single-series in v1.',
    useWhen:
      'A data chart from a list of records — bar/line/area/pie/donut; use for trends, breakdowns, ' +
      'or comparisons, NOT tabular data (grid/datatable) or a timeline (gantt).',
    example: {
      id: 'chart',
      kind: 'chart',
      props: { type: 'bar', title: 'Revenue by region', rowsVar: 'sales', xField: 'region', yField: 'revenue' },
    },
    // static: no `source` — reads the seeded variable directly, available in the SSR first paint.
    dataMode: 'static',
    group: 'display',
    tags: ['chart', 'bar', 'line', 'area', 'pie', 'donut', 'graph', 'plot', 'viz', 'dashboard'],
    props: [
      { name: 'type', type: 'select', label: 'Chart type', options: ['bar', 'line', 'area', 'pie', 'donut'], default: 'bar' },
      { name: 'rowsVar', type: 'string', label: 'Rows variable', default: 'rows' },
      { name: 'xField', type: 'string', label: 'Category/label field' },
      { name: 'yField', type: 'string', label: 'Value field (numeric)' },
      { name: 'title', type: 'string', label: 'Title' },
      { name: 'color', type: 'color', label: 'Color', default: '#3b82f6' },
      { name: 'height', type: 'number', label: 'Height px', default: 240 },
      { name: 'showAxis', type: 'boolean', label: 'Show axis', default: true },
      { name: 'showLegend', type: 'boolean', label: 'Show legend', default: false },
      { name: 'valueLabels', type: 'boolean', label: 'Value labels', default: false },
    ],
  },
];
