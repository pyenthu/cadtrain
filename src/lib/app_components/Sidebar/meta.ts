// app_components/Sidebar/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Sidebar.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'sidebar',
    name: 'Sidebar',
    description: 'A collapsible side panel that holds nested children (left/right).',
    useWhen:
      'A collapsible side panel holding children — use for secondary navigation or a filters/details ' +
      'pane beside the main content (use vtoolbar for a thin icon rail).',
    example: { id: 'side', kind: 'sidebar', props: { side: 'left', title: 'Navigation', width: 220 }, children: [] },
    group: 'layout',
    tags: ['sidebar', 'panel', 'side', 'dock', 'drawer', 'collapsible', 'nav', 'nest'],
    acceptsChildren: true,
    props: [
      { name: 'side', type: 'select', label: 'Side', options: ['left', 'right'], default: 'left' },
      { name: 'title', type: 'string', label: 'Title' },
      { name: 'width', type: 'number', label: 'Width (px)', default: 220 },
      { name: 'collapsible', type: 'boolean', label: 'Collapsible', default: true },
    ],
  },
];
