import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'popover',
    name: 'Popover',
    description: 'A BEHAVIOR component: attaches to its PARENT — opens on parent CLICK (floating), holds content + event triggers. Nest it inside the element it belongs to.',
    group: 'layout',
    tags: ['popover', 'popup', 'flyout', 'overlay', 'menu', 'attach', 'behavior'],
    acceptsChildren: true,
    props: [{ name: 'title', type: 'string', label: 'Title' }],
  },
];
