// app_components/Container/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Container.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'container',
    name: 'Container',
    description: 'A transparent wrapper that holds nested children (layout/grouping).',
    group: 'layout',
    tags: ['container', 'group', 'stack', 'wrapper', 'layout', 'nest'],
    acceptsChildren: true,
  },
  {
    kind: 'card',
    name: 'Card',
    description: 'A bordered surface that holds nested children (a titled group).',
    group: 'layout',
    tags: ['card', 'panel', 'box', 'surface', 'group', 'nest'],
    acceptsChildren: true,
  },
  {
    kind: 'div',
    name: 'Div',
    description: 'A generic block container (HTML-style) — holds children; the basic building block.',
    group: 'layout',
    tags: ['div', 'block', 'box', 'container', 'html', 'nest', 'group'],
    acceptsChildren: true,
  },
  {
    kind: 'col',
    name: 'Column',
    description: 'A vertical column — children stacked top-to-bottom.',
    group: 'layout',
    tags: ['col', 'column', 'vertical', 'stack', 'html', 'nest'],
    acceptsChildren: true,
  },
];
