// Headless integration test for the design.app wiring — inline (location-independent, so it
// survives design.app.json being relocated to the samples dir). Proves: the manifest validates,
// its kinds are real PanelKinds, the nodetree kind is registered, seeded node/edge vars bridge via
// readVar, the SSR preload walk leaves the (static) nodetree for the component to read directly,
// and the seeded data lays out through the pure layout math (depths, resolvable edges, canvas
// size). The full shipped file is verified end-to-end by curl against the SSR route.
import { describe, it, expect } from 'vitest';
import { validateManifest } from '$lib/appkit/manifest/validate';
import { dispatch } from '$lib/appkit/verbs/dispatch';
import { PANEL_KINDS } from '$lib/appkit/verbs/gui';
import { getComponentMeta } from '$lib/appkit/catalog/components';
import { resolvePreloaded } from '$lib/server/app-render';
import type { AppEngine } from '$lib/appkit/verbs/registry';
import { normalizeNodes, normalizeEdges, layoutTree, layoutEdges, computeDepths } from './node-tree-layout';

// A representative slice of design.app: seeded architecture nodes/edges + C4 context vars, a
// heading, and a tabs panel whose two children are nodetrees bound (via readVar) to the vars.
const design = {
  app: 'design-test',
  title: 'CAD Train — Architecture',
  docType: 'design',
  structures: {
    archNode: [{ name: 'id' }, { name: 'label' }, { name: 'parentId' }, { name: 'kind' }],
    archEdge: [{ name: 'source' }, { name: 'target' }, { name: 'kind' }, { name: 'label' }],
  },
  vars: {
    nodes: [
      { id: 'sys-cadtrain', label: 'CAD Train', kind: 'system', tech: 'Software System' },
      { id: 'c-webapp', label: 'Web App', parentId: 'sys-cadtrain', kind: 'container', tech: 'SvelteKit' },
      { id: 'c-api', label: 'API layer', parentId: 'sys-cadtrain', kind: 'container', tech: 'adapter-node' },
      { id: 'c-kernel', label: 'CAD kernel', parentId: 'sys-cadtrain', kind: 'container', tech: 'ManifoldCAD WASM' },
      { id: 'c-volume', label: 'Volume store', parentId: 'sys-cadtrain', kind: 'container', tech: '$APP_DATA_DIR' },
      { id: 'r-primitives', label: '/primitives', parentId: 'c-webapp', kind: 'route', href: '/primitives' },
      { id: 'r-fem', label: '/fem', parentId: 'c-webapp', kind: 'route', archived: true },
      { id: 'a-prim-data', label: '/api/primitives (data)', parentId: 'c-api', kind: 'api' },
      { id: 'l-comp-graph', label: 'composition-graph', parentId: 'c-kernel', kind: 'lib' },
      { id: 'l-manifold', label: 'Manifold WASM', parentId: 'c-kernel', kind: 'lib' },
      { id: 's-primitives-vol', label: 'primitives/ (parts)', parentId: 'c-volume', kind: 'store' },
    ],
    edges: [
      { source: 'c-webapp', target: 'c-api', kind: 'summary', label: 'calls /api/*' },
      { source: 'r-primitives', target: 'a-prim-data', kind: 'calls' },
      { source: 'a-prim-data', target: 's-primitives-vol', kind: 'writes', label: 'save/delete' },
      { source: 'l-comp-graph', target: 'l-manifold', kind: 'flow', label: 'bake' },
    ],
    c4nodes: [
      { id: 'user', label: 'CAD Author', kind: 'person', tech: 'Web browser' },
      { id: 'sys', label: 'CAD Train', parentId: 'user', kind: 'system' },
      { id: 'anthropic', label: 'Anthropic API', parentId: 'sys', kind: 'external' },
      { id: 'railway', label: 'Railway + Volume', parentId: 'sys', kind: 'external' },
    ],
    c4edges: [
      { source: 'user', target: 'sys', kind: 'calls', label: 'Authors parts' },
      { source: 'sys', target: 'anthropic', kind: 'calls', label: 'AI generate' },
    ],
  },
  panels: [
    { id: 'title', kind: 'heading', props: { level: 1, text: 'CAD Train — Architecture' } },
    { id: 'subtitle', kind: 'text', props: { text: 'Architecture tree + C4 context.', muted: true } },
    {
      id: 'views',
      kind: 'tabs',
      props: { labels: ['Tree', 'C4'] },
      children: [
        { id: 'tree', kind: 'nodetree', title: 'Tree', source: { verb: 'readVar', args: { name: 'nodes' } }, props: { nodesVar: 'nodes', edgesVar: 'edges' } },
        { id: 'c4', kind: 'nodetree', title: 'C4', source: { verb: 'readVar', args: { name: 'c4nodes' } }, props: { nodesVar: 'c4nodes', edgesVar: 'c4edges' } },
      ],
    },
  ],
};

const noEngine = { list: async () => [] } as unknown as AppEngine;

describe('design.app — manifest + wiring', () => {
  it('validates as a manifest', () => {
    expect(validateManifest(structuredClone(design)).ok).toBe(true);
  });

  it('every kind is a real PanelKind, incl. nodetree', () => {
    const kinds = new Set<string>();
    const walk = (ps: any[]) => ps?.forEach((p) => (kinds.add(p.kind), p.children && walk(p.children)));
    walk(design.panels);
    for (const k of kinds) expect(PANEL_KINDS as readonly string[]).toContain(k);
    expect(kinds.has('nodetree')).toBe(true);
    expect(kinds.has('tabs')).toBe(true);
  });

  it('nodetree is a registered, static-data component', () => {
    const meta = getComponentMeta('nodetree');
    expect(meta).toBeTruthy();
    expect(meta?.dataMode).toBe('static');
  });
});

describe('design.app — seed-data bridge', () => {
  it('readVar bridges the seeded node/edge + C4 variables', async () => {
    const app = design as any;
    expect((await dispatch('readVar', { name: 'nodes' }, { appStore: app }) as any[]).length).toBe(11);
    expect((await dispatch('readVar', { name: 'edges' }, { appStore: app }) as any[]).length).toBe(4);
    expect((await dispatch('readVar', { name: 'c4nodes' }, { appStore: app }) as any[]).length).toBe(4);
    expect((await dispatch('readVar', { name: 'c4edges' }, { appStore: app }) as any[]).length).toBe(2);
    expect(await dispatch('readVar', { name: 'missing' }, { appStore: app })).toEqual([]);
  });

  it('SSR preload leaves the static nodetree for the component to read directly', async () => {
    const pre = await resolvePreloaded(structuredClone(design) as any, noEngine);
    // nodetree is dataMode:'static' → NOT baked into preloaded[]; it reads app.vars in first paint.
    expect(pre.tree).toBeUndefined();
    expect(pre.c4).toBeUndefined();
  });
});

describe('design.app — seed data lays out through the pure math', () => {
  it('architecture tree: system=0, containers=1, components=2', () => {
    const nodes = normalizeNodes(design.vars.nodes);
    const d = computeDepths(nodes);
    expect(d.get('sys-cadtrain')).toBe(0);
    expect(d.get('c-webapp')).toBe(1);
    expect(d.get('r-primitives')).toBe(2);
    expect(d.get('l-manifold')).toBe(2);
  });

  it('every seeded architecture edge resolves to a drawable connector (no dropped endpoints)', () => {
    const L = layoutTree(normalizeNodes(design.vars.nodes));
    const es = layoutEdges(normalizeEdges(design.vars.edges), L.byId);
    expect(es).toHaveLength(design.vars.edges.length);
    expect(L.width).toBeGreaterThan(0);
    expect(L.height).toBeGreaterThan(0);
  });

  it('C4 context threads user → CAD Train → externals (depth 0·1·2)', () => {
    const nodes = normalizeNodes(design.vars.c4nodes);
    const d = computeDepths(nodes);
    expect(d.get('user')).toBe(0);
    expect(d.get('sys')).toBe(1);
    expect(d.get('anthropic')).toBe(2);
    const L = layoutTree(nodes);
    const es = layoutEdges(normalizeEdges(design.vars.c4edges), L.byId);
    expect(es).toHaveLength(2);
  });
});
