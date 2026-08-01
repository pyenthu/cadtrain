// app_components/EditableTable/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with EditableTable.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'edittable',
    name: 'Editable Table',
    description:
      'Rows editable in LOCAL client state (add/edit/delete instant, no round-trip); on.save persists to the server. Seeded from source (SSR).',
    useWhen:
      'A spreadsheet-like table the user can add/edit/delete rows in locally, persisting on save — ' +
      'use when tabular data must be EDITED in place; use grid for read-only display.',
    example: {
      id: 'editor',
      kind: 'edittable',
      source: { verb: 'loadData', args: { slot: 'data' } },
      props: { columns: 'name,od,top', slot: 'data' },
    },
    dataMode: 'server',
    group: 'data',
    tags: ['edit', 'editable', 'table', 'rows', 'form', 'input', 'crud', 'spreadsheet', 'grid', 'local'],
    props: [
      { name: 'columns', type: 'string', label: 'Columns (comma-sep)' },
      { name: 'addLabel', type: 'string', label: 'Add-row label', default: '+ Add row' },
      { name: 'slot', type: 'string', label: 'Data-file slot (persist target)' },
    ],
    wiresTo: ['data', 'mutate'],
  },
];
