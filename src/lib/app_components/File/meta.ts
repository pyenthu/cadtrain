// app_components/File/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with File.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'file',
    name: 'File',
    description: 'Open / Save / Save As a DATA file into a slot (§0.5). Components read it via loadData.',
    useWhen:
      'Open/Save/Save-As a DATA file into a named slot — use to let the user load external data ' +
      '(e.g. .wson/.json) that other components then read via loadData(slot).',
    example: { id: 'open', kind: 'file', props: { slot: 'data', label: 'Open', type: '.json' } },
    dataMode: 'client',
    group: 'data',
    tags: ['file', 'open', 'save', 'load', 'data', 'slot', 'import', 'export', 'picker', 'upload'],
    props: [
      { name: 'slot', type: 'string', label: 'Slot', default: 'data' },
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'type', type: 'string', label: 'File type hint (.wson,.json)' },
    ],
  },
];
