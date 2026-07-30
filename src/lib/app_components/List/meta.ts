// app_components/List/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with List.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'list',
    name: 'List',
    description: 'A selectable list of documents/rows. Bind source to a data verb; click selects.',
    dataMode: 'server',
    group: 'data',
    tags: ['list', 'menu', 'select', 'docs', 'rows', 'items'],
    wiresTo: ['data'],
  },
];
