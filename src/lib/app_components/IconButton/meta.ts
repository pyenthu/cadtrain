import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'iconbutton',
    name: 'Icon Button',
    description: 'A button with an ICON + text (fires on.click). Pick the icon from a searchable set (its editor); a server icon library is the follow-up.',
    useWhen:
      'An icon (optionally + label) button firing a verb on click — use in toolbars/rails where a ' +
      'compact glyph is clearer than a text button.',
    example: { id: 'add', kind: 'iconbutton', props: { icon: 'plus', label: 'Add', variant: 'ghost' }, on: { click: { verb: 'addRow', args: {} } } },
    group: 'input',
    tags: ['icon', 'button', 'action', 'glyph', 'click', 'toolbar', 'search'],
    props: [
      { name: 'icon', type: 'string', label: 'Icon (name)' },
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'variant', type: 'select', label: 'Variant', options: ['solid', 'ghost'], default: 'solid' },
    ],
    wiresTo: ['data', 'mutate'],
  },
];
