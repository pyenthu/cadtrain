// app_components/Cad3d/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Cad3d.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'cad3d',
    name: '3D CAD Viewer',
    description:
      'An interactive 3D viewer that embeds a baked CAD part/assembly — orbit/zoom a real Manifold ' +
      'mesh (red outer skin / grey bore), with an optional cutaway. A CLIENT island (dataMode:client): ' +
      'it renders an SSR placeholder then mounts the WebGL canvas onMount, fetching the BAKED MESH from ' +
      'the server (computeMode:server) so the engine + the part source never ship to the browser.',
    useWhen:
      'An interactive 3D view of a baked CAD part/assembly — use to show/inspect geometry in an app ' +
      '(orbit, zoom, cutaway); bake3d shows only stats (verts/tris), not the model.',
    example: {
      id: 'viewer',
      kind: 'cad3d',
      props: { partId: 'g_shaft', cutaway: false, height: 360, autoRotate: true },
    },
    dataMode: 'client',
    computeMode: 'server',
    group: '3d',
    tags: ['3d', 'cad', 'part', 'geometry', 'viewer', 'manifold', 'model', 'render'],
    wiresTo: ['data'],
    props: [
      { name: 'partId', type: 'string', label: 'Part id' },
      { name: 'params', type: 'string', label: 'Params (ref or JSON)' },
      { name: 'cutaway', type: 'boolean', label: 'Cutaway', default: false },
      { name: 'height', type: 'number', label: 'Height (px)', default: 360 },
      { name: 'background', type: 'color', label: 'Background' },
      { name: 'autoRotate', type: 'boolean', label: 'Auto-rotate', default: false },
      {
        name: 'engine',
        type: 'select',
        label: 'Engine',
        options: ['manifold', 'trueform', 'brep'],
        default: 'manifold',
      },
    ],
  },
];
