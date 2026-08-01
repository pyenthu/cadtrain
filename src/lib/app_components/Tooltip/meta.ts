import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'tooltip',
    name: 'Tooltip',
    description: 'A BEHAVIOR component: attaches to its PARENT — shows on HOVER (floating). Short content via props.text or nested children. Nest it inside the element it hints.',
    useWhen:
      'A hover hint attached to its PARENT — nest inside the element it explains; use for a short ' +
      'help hint, NOT persistent or clickable content (use popover for that).',
    example: { id: 'hint', kind: 'tooltip', props: { text: 'Save changes' } },
    group: 'display',
    tags: ['tooltip', 'hint', 'hover', 'help', 'title', 'attach', 'behavior'],
    acceptsChildren: true,
    props: [{ name: 'text', type: 'string', label: 'Text' }],
  },
];
