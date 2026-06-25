/**
 * c4.ts — data + layout for the C4-model diagram view on /design.
 *
 * The C4 model (https://c4model.com) describes software with four nested
 * levels, each zooming further in:
 *   1. Context   — the software system as ONE box + the people / external
 *                  systems it talks to.
 *   2. Container  — zoom into the system → its deployable / runnable containers
 *                  (apps, APIs, datastores) + the externals.
 *   3. Component  — zoom into ONE container → the components inside it.
 *   4. Code       — (skipped; too fine for this view.)
 *
 * Notation: every box carries a bold NAME, a `[type: technology]` line and a
 * short description; people + external systems are styled muted/grey; the focus
 * system/container is accented; relationships are DIRECTED, LABELLED arrows.
 *
 * Container + Component levels REUSE the existing architecture.ts dataset
 * (`ARCH_TREE_NODES` hierarchy + `ARCH_EDGES`). The Context-level externals are
 * new and defined here — the architecture graph only models the system's
 * internals, so the people / 3rd-party systems live only in this file.
 */

import { ARCH_TREE_NODES, ARCH_EDGES } from './architecture';

export type C4Level = 'context' | 'container' | 'component';

export type C4Variant =
  | 'person' // a human actor (muted)
  | 'external' // a 3rd-party system (muted)
  | 'system' // THE software system in focus (accented)
  | 'container' // a runnable/deployable container
  | 'store' // a datastore container (cylinder-ish styling)
  | 'component'; // a component inside a container

export interface C4Box {
  id: string;
  name: string;
  /** C4 type tag, e.g. "Person", "Software System", "Container", "Component". */
  kind: string;
  /** technology / stack, shown as `[kind: tech]`. */
  tech?: string;
  desc: string;
  variant: C4Variant;
  accent?: string;
  href?: string; // route boxes are clickable
  // absolute layout within the diagram's coordinate space
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface C4Rel {
  from: string;
  to: string;
  label: string;
}

export interface C4Diagram {
  /** coordinate-space size (the SVG viewBox); scales responsively. */
  width: number;
  height: number;
  boxes: C4Box[];
  rels: C4Rel[];
}

// ──────────────────────────────────────────────────────────
// LEVEL 1 — SYSTEM CONTEXT
//
// CAD Train as one box + the people / external systems around it.
// Hand-laid on a 980-wide canvas.
// ──────────────────────────────────────────────────────────
export const C4_CONTEXT: C4Diagram = {
  width: 980,
  height: 640,
  boxes: [
    {
      id: 'user',
      name: 'CAD Author',
      kind: 'Person',
      tech: 'Web browser',
      desc: 'Engineer authoring downhole-tool parts — wires graphs, scrubs params, describes parts in plain language.',
      variant: 'person',
      x: 70,
      y: 60,
      w: 220,
      h: 130,
    },
    {
      id: 'sys',
      name: 'CAD Train',
      kind: 'Software System',
      tech: 'SvelteKit · ManifoldCAD · Threlte',
      desc: 'Parametric 3D CAD pipeline — a node-graph editor over a typed parts library, baked by a real CSG kernel.',
      variant: 'system',
      accent: '#cc2222',
      x: 380,
      y: 255,
      w: 250,
      h: 150,
    },
    {
      id: 'anthropic',
      name: 'Anthropic API',
      kind: 'External System',
      tech: 'Claude · @anthropic-ai/sdk',
      desc: 'Large-language-model backend for generative authoring + the ✨ graph-assist loop.',
      variant: 'external',
      x: 710,
      y: 70,
      w: 210,
      h: 130,
    },
    {
      id: 'fal',
      name: 'FAL · archived',
      kind: 'External System',
      tech: 'Hunyuan3D',
      desc: 'image→3D model service behind /forge — ARCHIVED 2026-06.',
      variant: 'external',
      x: 710,
      y: 430,
      w: 210,
      h: 130,
    },
    {
      id: 'railway',
      name: 'Railway + Volume',
      kind: 'External System',
      tech: 'Docker host · persistent volume',
      desc: 'Production host (adapter-node container) and the redeploy-surviving data volume at $APP_DATA_DIR.',
      variant: 'external',
      x: 360,
      y: 480,
      w: 290,
      h: 130,
    },
  ],
  rels: [
    { from: 'user', to: 'sys', label: 'Authors parts in [HTTPS]' },
    { from: 'sys', to: 'anthropic', label: 'Calls for AI generate [/refine · /rag]' },
    { from: 'sys', to: 'fal', label: 'Sends image → gets 3D [/forge]' },
    { from: 'sys', to: 'railway', label: 'Reads / writes parts [volume FS]' },
  ],
};

// ──────────────────────────────────────────────────────────
// LEVEL 2 — CONTAINERS
//
// Zoom into CAD Train → its 4 containers + the externals. Container box data
// (label / tech / accent / blurb) is REUSED from ARCH_TREE_NODES; the
// container→container relationships reuse the `summary` edges in ARCH_EDGES.
// ──────────────────────────────────────────────────────────
const CONTAINER_LAYOUT: Record<string, { x: number; y: number; w: number; h: number; variant: C4Variant }> = {
  'c-webapp': { x: 230, y: 250, w: 195, h: 150, variant: 'container' },
  'c-api': { x: 470, y: 250, w: 195, h: 150, variant: 'container' },
  'c-kernel': { x: 710, y: 250, w: 195, h: 150, variant: 'container' },
  'c-volume': { x: 710, y: 450, w: 195, h: 130, variant: 'store' },
};

export function buildContainerDiagram(): C4Diagram {
  const containers = ARCH_TREE_NODES.filter((n) => n.treeKind === 'container');
  const boxes: C4Box[] = [];

  // the person + externals around the system boundary
  boxes.push({
    id: 'user',
    name: 'CAD Author',
    kind: 'Person',
    tech: 'Web browser',
    desc: 'Authors parts via the editor UI.',
    variant: 'person',
    x: 20,
    y: 250,
    w: 175,
    h: 150,
  });
  boxes.push({
    id: 'anthropic',
    name: 'Anthropic API',
    kind: 'External System',
    tech: 'Claude',
    desc: 'AI generative authoring + graph-assist.',
    variant: 'external',
    x: 470,
    y: 50,
    w: 195,
    h: 130,
  });
  boxes.push({
    id: 'fal',
    name: 'FAL · archived',
    kind: 'External System',
    tech: 'Hunyuan3D',
    desc: 'Image → 3D model service (/forge archived 2026-06).',
    variant: 'external',
    x: 710,
    y: 50,
    w: 195,
    h: 130,
  });

  for (const c of containers) {
    const L = CONTAINER_LAYOUT[c.id];
    if (!L) continue;
    boxes.push({
      id: c.id,
      name: c.label,
      kind: L.variant === 'store' ? 'Datastore' : 'Container',
      tech: c.tech,
      desc: c.blurb ?? '',
      variant: L.variant,
      accent: c.accent,
      x: L.x,
      y: L.y,
      w: L.w,
      h: L.h,
    });
  }

  // container→container edges from the existing C4 summary relationships
  const summaryRels: C4Rel[] = ARCH_EDGES.filter((e) => e.data?.edgeKind === 'summary').map((e) => ({
    from: e.source,
    to: e.target,
    label: e.data?.label ?? '',
  }));

  const rels: C4Rel[] = [
    { from: 'user', to: 'c-webapp', label: 'Uses [browser]' },
    ...summaryRels,
    { from: 'c-api', to: 'c-volume', label: 'save / delete parts' },
    { from: 'c-api', to: 'anthropic', label: 'AI generate [SDK]' },
    { from: 'c-api', to: 'fal', label: 'image → 3D' },
  ];

  return { width: 980, height: 620, boxes, rels };
}

// ──────────────────────────────────────────────────────────
// LEVEL 3 — COMPONENTS
//
// Zoom into ONE container → its component children, auto-laid in a grid.
// Component boxes + intra-container edges come straight from architecture.ts.
// ──────────────────────────────────────────────────────────
export interface C4ContainerOption {
  id: string;
  label: string;
  tech?: string;
  accent?: string;
}

export const C4_CONTAINER_OPTIONS: C4ContainerOption[] = ARCH_TREE_NODES.filter(
  (n) => n.treeKind === 'container',
).map((n) => ({ id: n.id, label: n.label, tech: n.tech, accent: n.accent }));

function componentKind(treeKind: string): string {
  switch (treeKind) {
    case 'route':
      return 'Route';
    case 'api':
      return 'API endpoint';
    case 'store':
      return 'Datastore';
    default:
      return 'Component';
  }
}

export function buildComponentDiagram(containerId: string): C4Diagram {
  const container = ARCH_TREE_NODES.find((n) => n.id === containerId);
  const accent = container?.accent ?? '#cc2222';
  const children = ARCH_TREE_NODES.filter((n) => n.parentId === containerId);

  // grid layout
  const COLS = 4;
  const BW = 210;
  const BH = 122;
  const GX = 26;
  const GY = 26;
  const PAD = 24;
  const TOP = 24;

  const boxes: C4Box[] = children.map((n, i) => {
    const col = i % COLS;
    const r = Math.floor(i / COLS);
    return {
      id: n.id,
      name: n.label,
      kind: componentKind(n.treeKind),
      tech: undefined,
      desc: n.blurb ?? '',
      variant: (n.treeKind === 'store' ? 'store' : 'component') as C4Variant,
      accent,
      href: n.href,
      x: PAD + col * (BW + GX),
      y: TOP + r * (BH + GY),
      w: BW,
      h: BH,
    };
  });

  const ids = new Set(children.map((n) => n.id));
  const rels: C4Rel[] = ARCH_EDGES.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target).map(
    (e) => ({ from: e.source, to: e.target, label: e.data?.label ?? '' }),
  );

  const rows = Math.max(1, Math.ceil(children.length / COLS));
  const width = PAD * 2 + COLS * BW + (COLS - 1) * GX;
  const height = TOP + rows * BH + (rows - 1) * GY + PAD;

  return { width, height, boxes, rels };
}
