// app_components/MenuButton/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with MenuButton.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'menu',
    name: 'Menu Button',
    description: 'A button that opens a dropdown menu; its children are the menu items.',
    useWhen:
      'A button that opens a dropdown of its children as menu items — use for a compact set of ' +
      'related actions under one trigger (use toolbar to show buttons inline).',
    example: { id: 'actions', kind: 'menu', props: { label: 'Actions' }, children: [] },
    group: 'input',
    tags: ['menu', 'dropdown', 'button', 'actions', 'nav', 'select'],
    acceptsChildren: true,
    props: [
      { name: 'label', type: 'string', label: 'Label', default: 'Menu' },
      { name: 'variant', type: 'select', label: 'Variant', options: ['solid', 'ghost'], default: 'solid' },
    ],
  },
];
