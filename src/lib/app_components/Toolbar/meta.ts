// app_components/Toolbar/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Toolbar.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'toolbar',
    name: 'Toolbar',
    description: 'A horizontal row that holds children (buttons). props.align: start|center|end|between.',
    useWhen:
      'A horizontal action bar of buttons/icon-buttons — use as a top toolbar; use row for generic ' +
      'side-by-side layout, vtoolbar for a vertical rail.',
    example: { id: 'bar', kind: 'toolbar', props: { align: 'between' }, children: [] },
    group: 'layout',
    tags: ['toolbar', 'row', 'buttons', 'actions', 'bar', 'header', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'align', type: 'select', label: 'Align', options: ['start', 'center', 'end', 'between'], default: 'start' }],
  },
  {
    kind: 'row',
    name: 'Row',
    description: 'A horizontal row — children laid out left-to-right (columns).',
    useWhen:
      'A horizontal row laying children left-to-right — use for side-by-side layout (pair with col ' +
      'for vertical; use toolbar for an action bar).',
    example: { id: 'cols', kind: 'row', props: { align: 'start' }, children: [] },
    group: 'layout',
    tags: ['row', 'horizontal', 'flex', 'columns', 'html', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'align', type: 'select', label: 'Align', options: ['start', 'center', 'end', 'between'], default: 'start' }],
  },
];
