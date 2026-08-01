// app_components/VerticalToolbar/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with VerticalToolbar.svelte (the render). `import type` keeps this pure (no
// runtime edge back into the catalog) so appkit can aggregate it. See
// src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'vtoolbar',
    name: 'Vertical Toolbar',
    description: 'A vertical rail of children (icons/buttons), docked left — like the studio rail.',
    useWhen:
      "A vertical icon rail docked to the side — use for an app's primary left tool/nav rail of " +
      'icon buttons (use toolbar for a horizontal bar, sidebar for a wider collapsible panel).',
    example: { id: 'rail', kind: 'vtoolbar', props: { align: 'start' }, children: [] },
    group: 'layout',
    tags: ['toolbar', 'vertical', 'rail', 'sidebar', 'nav', 'icons', 'buttons', 'nest'],
    acceptsChildren: true,
    props: [
      { name: 'align', type: 'select', label: 'Align', options: ['start', 'center', 'end', 'between'], default: 'start' },
    ],
  },
];
