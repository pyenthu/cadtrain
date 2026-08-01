// app_components/Placeholder/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Placeholder.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'svg',
    name: 'SVG',
    description: 'A 2D SVG view of a doc (placeholder until wired).',
    useWhen:
      'A generic 2D SVG view of a doc — a placeholder surface until a richer 2D view is wired; ' +
      'prefer nodetree/gantt/wellschematic for those specific diagrams.',
    example: { id: 'view', kind: 'svg', source: { verb: 'loadDoc', args: { id: '$active' } } },
    dataMode: 'server',
    group: 'display',
    tags: ['svg', '2d', 'diagram', 'vector', 'placeholder'],
    wiresTo: ['data'],
  },
];
