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
    dataMode: 'server',
    group: 'data',
    tags: ['edit', 'table', 'rows', 'form', 'input', 'crud', 'spreadsheet', 'local'],
    props: [
      { name: 'columns', type: 'string', label: 'Columns (comma-sep)' },
      { name: 'addLabel', type: 'string', label: 'Add-row label', default: '+ Add row' },
      { name: 'slot', type: 'string', label: 'Data-file slot (persist target)' },
    ],
    wiresTo: ['data', 'mutate'],
  },
];
