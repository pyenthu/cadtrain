import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'tooltip',
    name: 'Tooltip',
    description: 'A BEHAVIOR component: attaches to its PARENT — shows on HOVER (floating). Short content via props.text or nested children. Nest it inside the element it hints.',
    group: 'display',
    tags: ['tooltip', 'hint', 'hover', 'help', 'attach', 'behavior'],
    acceptsChildren: true,
    props: [{ name: 'text', type: 'string', label: 'Text' }],
  },
];
