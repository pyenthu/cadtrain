// app_components/Bake3d/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Bake3d.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'bake3d',
    name: '3D Bake',
    description: 'Bakes the active doc through the engine → geometry stats (verts/tris).',
    useWhen:
      'Bake the active CAD doc through the engine and show geometry stats — use to preview/verify a ' +
      "parametric part's mesh (verts/tris) inside the app.",
    example: { id: 'bake', kind: 'bake3d', source: { verb: 'bake', args: { id: '$active' } } },
    dataMode: 'server',
    group: '3d',
    tags: ['3d', 'bake', 'geometry', 'render', 'manifold', 'mesh', 'cad', 'part', 'model'],
    wiresTo: ['data'],
  },
];
