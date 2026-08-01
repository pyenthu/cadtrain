// app_components/Container/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Container.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'container',
    name: 'Container',
    description: 'A transparent wrapper that holds nested children (layout/grouping).',
    useWhen:
      'A transparent, borderless wrapper for grouping children — use for pure layout grouping when ' +
      'you do NOT want a visible box (use card for a bordered surface).',
    example: { id: 'group', kind: 'container', children: [] },
    group: 'layout',
    tags: ['container', 'group', 'stack', 'wrapper', 'layout', 'nest'],
    acceptsChildren: true,
  },
  {
    kind: 'card',
    name: 'Card',
    description: 'A bordered surface that holds nested children (a titled group).',
    useWhen:
      'A bordered, titled surface holding children — use to visually separate a group of content ' +
      'into a distinct box (use container for an invisible wrapper).',
    example: { id: 'summary', kind: 'card', title: 'Summary', children: [] },
    group: 'layout',
    tags: ['card', 'panel', 'box', 'surface', 'group', 'nest'],
    acceptsChildren: true,
  },
  {
    kind: 'div',
    name: 'Div',
    description: 'A generic block container (HTML-style) — holds children; the basic building block.',
    useWhen:
      'A generic HTML-style block that holds children — the neutral default building block when no ' +
      'more specific container fits.',
    example: { id: 'block', kind: 'div', children: [] },
    group: 'layout',
    tags: ['div', 'block', 'box', 'container', 'html', 'nest', 'group'],
    acceptsChildren: true,
  },
  {
    kind: 'col',
    name: 'Column',
    description: 'A vertical column — children stacked top-to-bottom.',
    useWhen:
      'A vertical column stacking children top-to-bottom — use for a vertical layout (pair with row ' +
      'for horizontal).',
    example: { id: 'column', kind: 'col', children: [] },
    group: 'layout',
    tags: ['col', 'column', 'vertical', 'stack', 'html', 'nest'],
    acceptsChildren: true,
  },
];
