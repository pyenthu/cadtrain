// app_components/Heading/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Heading.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'heading',
    name: 'Heading',
    description: 'An h1/h2/h3 title (props.level + text).',
    useWhen:
      'An h1/h2/h3 section title — use as the app or section heading (there is no default app title; ' +
      'add one with this); use text for body copy.',
    example: { id: 'title', kind: 'heading', props: { text: 'Dashboard', level: '1' } },
    group: 'display',
    tags: ['heading', 'title', 'h1', 'h2', 'h3', 'header', 'html'],
    props: [
      { name: 'text', type: 'string', label: 'Text', default: 'Heading' },
      { name: 'level', type: 'select', label: 'Level', options: ['1', '2', '3'], default: '2' },
    ],
  },
];
