// app_components/Bake3d/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Bake3d.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'bake3d',
    name: '3D Bake',
    description: 'Bakes the active doc through the engine → geometry stats (verts/tris).',
    dataMode: 'server',
    group: '3d',
    tags: ['3d', 'bake', 'geometry', 'render', 'manifold', 'mesh'],
    wiresTo: ['data'],
  },
];
