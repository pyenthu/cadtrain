// app_components/NodeTree/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with NodeTree.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'nodetree',
    name: 'Node Tree / Architecture Graph',
    description:
      'A nodes+edges architecture graph laid out LEFT→RIGHT by depth (x = depth·colWidth; siblings ' +
      'stack; parents centre over their subtree), drawn as pure SSR-safe SVG (no xyflow). Nodes are ' +
      'coloured by props.kind bucket (system·container·route·api·lib·store·person·external); ' +
      'planned/archived nodes dash + fade; edges are coloured by relationship kind ' +
      '(summary·calls·mounts·flow·reads·writes·nav) with optional labels; a subtle parent→child ' +
      'skeleton is drawn from the node hierarchy. Reads app VARIABLES (props.nodesVar → vars[name], ' +
      'a list<record> of {id,label,parentId?,kind,tech?,accent?,blurb?,href?,planned?,archived?}; ' +
      'props.edgesVar → a list<record> of {source,target,kind?,label?}) or inline props.nodes/' +
      'props.edges arrays. Server-renders (no client fetch). Ideal for C4 / dependency / site-map ' +
      'diagrams.',
    // static: no `source` — reads the seeded variables directly, available in the SSR first paint.
    dataMode: 'static',
    group: 'display',
    tags: ['tree', 'graph', 'architecture', 'c4', 'diagram', 'nodes', 'edges', 'hierarchy', 'flow', 'sitemap', 'svg', 'dependency'],
    props: [
      { name: 'title', type: 'string', label: 'Title' },
      { name: 'nodesVar', type: 'string', label: 'Nodes variable', default: 'nodes' },
      { name: 'edgesVar', type: 'string', label: 'Edges variable', default: 'edges' },
      { name: 'colWidth', type: 'number', label: 'Column width px', default: 210 },
      { name: 'rowGap', type: 'number', label: 'Row gap px', default: 46 },
      { name: 'nodeWidth', type: 'number', label: 'Node width px', default: 172 },
      { name: 'showHierarchy', type: 'boolean', label: 'Draw parent→child skeleton', default: true },
      { name: 'edgeLabels', type: 'boolean', label: 'Show edge labels', default: true },
    ],
  },
];
