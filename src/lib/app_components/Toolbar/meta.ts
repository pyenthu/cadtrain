// app_components/Toolbar/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Toolbar.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'toolbar',
    name: 'Toolbar',
    description: 'A horizontal row that holds children (buttons). props.align: start|center|end|between.',
    group: 'layout',
    tags: ['toolbar', 'row', 'buttons', 'actions', 'bar', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'align', type: 'select', label: 'Align', options: ['start', 'center', 'end', 'between'], default: 'start' }],
  },
  {
    kind: 'row',
    name: 'Row',
    description: 'A horizontal row — children laid out left-to-right (columns).',
    group: 'layout',
    tags: ['row', 'horizontal', 'flex', 'columns', 'html', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'align', type: 'select', label: 'Align', options: ['start', 'center', 'end', 'between'], default: 'start' }],
  },
];
