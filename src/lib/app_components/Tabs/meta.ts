// app_components/Tabs/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Tabs.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'tabs',
    name: 'Tabs',
    description: 'A tabbed container — each child is a tab (label from its title or props.labels).',
    group: 'layout',
    tags: ['tabs', 'tabbed', 'sections', 'pages', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'labels', type: 'string', label: 'Tab labels (comma-sep)' }],
  },
];
