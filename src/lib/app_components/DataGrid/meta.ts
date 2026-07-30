// app_components/DataGrid/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with DataGrid.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'grid',
    name: 'Data Grid',
    description: 'A read-only data table from any source (http / data verb). Columns from props.columns or inferred.',
    dataMode: 'server',
    group: 'data',
    tags: ['grid', 'table', 'data', 'rows', 'columns', 'results', 'json'],
    props: [{ name: 'columns', type: 'string', label: 'Columns (comma-sep)' }],
    wiresTo: ['data'],
  },
];
