// app_components/DataTable/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with DataTable.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
//
// DataTable is the read-only DataGrid (kind:'grid') LEVELLED UP: same data-in (a bound source
// resolved server-side into `preloaded`, or fetched client-side via run(source)), plus client
// sort / search / paging / totals as pure transforms over the resolved rows (no refetch).
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'datatable',
    name: 'Data Table',
    description:
      'A rich read-only data table from any source (http / data verb) — the data grid levelled ' +
      'up with client-side column SORT (click a header, three-state), a SEARCH box filtering all ' +
      'columns, optional client PAGING, and a numeric TOTALS footer. Columns from props.columns ' +
      '("od,id" or "od:OD,id:ID" key:Label pairs) or inferred from the first row. Rows resolve ' +
      'server-side into the first paint; sort/search/paging enhance on the client.',
    useWhen:
      'A read-only data table with sort/search/totals — use for analytics/listings from a source; ' +
      'use edittable to EDIT rows, grid for a plain table, chart to visualise.',
    example: {
      id: 'analytics',
      kind: 'datatable',
      source: { verb: 'readVar', args: { name: 'rows' } },
      props: {
        columns: 'name,region,qty:Quantity,total:Total',
        search: true,
        sortable: true,
        showTotals: true,
      },
    },
    dataMode: 'server',
    group: 'data',
    tags: ['datatable', 'table', 'grid', 'sortable', 'filter', 'search', 'spreadsheet', 'data', 'totals'],
    props: [
      { name: 'columns', type: 'string', label: 'Columns (comma-sep, key:Label)' },
      { name: 'search', type: 'boolean', label: 'Search box', default: true },
      { name: 'sortable', type: 'boolean', label: 'Sortable headers', default: true },
      { name: 'pageSize', type: 'number', label: 'Page size (0 = no paging)', default: 0 },
      { name: 'showTotals', type: 'boolean', label: 'Totals footer', default: false },
      { name: 'numberAlign', type: 'boolean', label: 'Right-align numbers', default: true },
      { name: 'zebra', type: 'boolean', label: 'Zebra rows', default: true },
    ],
    wiresTo: ['data'],
  },
];
