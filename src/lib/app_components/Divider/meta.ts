// app_components/Divider/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Divider.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'divider',
    name: 'Divider',
    description: 'A horizontal rule (<hr>), optionally with a centered label.',
    group: 'display',
    tags: ['divider', 'rule', 'hr', 'separator', 'line', 'html'],
    props: [{ name: 'label', type: 'string', label: 'Label (optional)' }],
  },
];
