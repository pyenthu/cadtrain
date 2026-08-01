// app_components/DataGrid/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with DataGrid.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'grid',
    name: 'Data Grid',
    description: 'A read-only data table from any source (http / data verb). Columns from props.columns or inferred.',
    useWhen:
      'A read-only table of rows from a variable or data verb — use for tabular data with columns ' +
      'when no inline editing is needed (use edittable to edit, or table for a doc list<record> param).',
    example: {
      id: 'tbl',
      kind: 'grid',
      source: { verb: 'readVar', args: { name: 'rows' } },
      props: { columns: 'name,od,top' },
    },
    dataMode: 'server',
    group: 'data',
    tags: ['grid', 'table', 'data', 'rows', 'columns', 'spreadsheet', 'results', 'json'],
    props: [{ name: 'columns', type: 'string', label: 'Columns (comma-sep)' }],
    wiresTo: ['data'],
  },
];
