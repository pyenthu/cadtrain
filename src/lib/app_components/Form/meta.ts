// app_components/Form/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Form.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
// This bundle backs TWO kinds: 'form' and 'table' (both rendered by Form.svelte).
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'form',
    name: 'Form',
    description: "A document's params as editable fields + tables (list<record> controls).",
    dataMode: 'server',
    group: 'data',
    tags: ['form', 'params', 'fields', 'edit', 'inputs'],
    wiresTo: ['data', 'mutate'],
  },
  {
    kind: 'table',
    name: 'Table',
    description: 'Tabular rows of a list<record> param with columns; add/edit rows.',
    dataMode: 'server',
    group: 'data',
    tags: ['table', 'grid', 'rows', 'columns', 'spreadsheet', 'records'],
    wiresTo: ['data', 'mutate'],
  },
];
