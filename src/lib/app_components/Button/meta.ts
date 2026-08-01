// app_components/Button/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Button.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'button',
    name: 'Button',
    description: 'A button that fires on.click (a verb binding or a sequence). Props label/variant.',
    useWhen:
      'A labelled text button that fires a verb on click — use to trigger an action or mutation ' +
      '(save/bake/add-row); use iconbutton when a glyph is clearer, menu for a dropdown of actions.',
    example: { id: 'save', kind: 'button', props: { label: 'Save', variant: 'solid' }, on: { click: { verb: 'patchDoc', args: {} } } },
    group: 'input',
    tags: ['button', 'action', 'click', 'submit', 'trigger', 'cta'],
    props: [
      { name: 'label', type: 'string', label: 'Label', default: 'Button' },
      { name: 'variant', type: 'select', label: 'Variant', options: ['solid', 'ghost'], default: 'solid' },
    ],
    wiresTo: ['data', 'mutate'],
  },
];
