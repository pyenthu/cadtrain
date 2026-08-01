// app_components/Text/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Text.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'text',
    name: 'Text',
    description: 'A text label. Props text/size/weight/align/color; text can be a $vars/$params ref.',
    useWhen:
      'An inline text label/paragraph, optionally bound to a $vars/$params value — use for body copy, ' +
      'a caption, or a live stat readout; use heading for a section title.',
    example: { id: 'caption', kind: 'text', props: { text: 'Hello', size: 'sm', muted: true } },
    group: 'display',
    tags: ['text', 'label', 'paragraph', 'caption', 'stat', 'body', 'copy'],
    props: [
      { name: 'text', type: 'string', label: 'Text', default: 'Text' },
      { name: 'size', type: 'select', label: 'Size', options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'], default: 'md' },
      { name: 'weight', type: 'select', label: 'Weight', options: ['400', '600', '700'], default: '400' },
      { name: 'align', type: 'select', label: 'Align', options: ['left', 'center', 'right'], default: 'left' },
      { name: 'color', type: 'color', label: 'Color' },
      { name: 'muted', type: 'boolean', label: 'Muted' },
    ],
  },
];
