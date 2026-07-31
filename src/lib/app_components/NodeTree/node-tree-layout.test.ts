import { describe, it, expect } from 'vitest';
import {
  normalizeNodes,
  normalizeEdges,
  computeDepths,
  layoutTree,
  layoutEdges,
  linkPath,
  nodeColor,
  edgeColor,
  nodeLegend,
  truncate,
  NODE_COLORS,
  EDGE_COLORS,
} from './node-tree-layout';

describe('node-tree-layout — normalizeNodes', () => {
  it('coerces records + fills defaults (id→index, label→id, kind→lib)', () => {
    const ns = normalizeNodes([{ id: 'a', label: 'A', parentId: 'root', kind: 'route' }, { id: 'b' }]);
    expect(ns[0]).toMatchObject({ id: 'a', label: 'A', parentId: 'root', kind: 'route' });
    expect(ns[1]).toMatchObject({ id: 'b', label: 'b', kind: 'lib' });
    expect(ns[1].parentId).toBeUndefined();
  });

  it('drops non-objects; empty parentId becomes a root (undefined)', () => {
    const ns = normalizeNodes([null, 5, { id: 'x', parentId: '' }]);
    expect(ns).toHaveLength(1);
    expect(ns[0].id).toBe('x');
    expect(ns[0].parentId).toBeUndefined();
  });

  it('carries accent/tech/href + coerces planned/archived to booleans', () => {
    const ns = normalizeNodes([
      { id: 'c', kind: 'container', accent: '#3b82f6', tech: 'SvelteKit', href: '/x', planned: 1, archived: 0 },
    ]);
    expect(ns[0]).toMatchObject({ accent: '#3b82f6', tech: 'SvelteKit', href: '/x', planned: true, archived: false });
  });

  it('honors a custom field map', () => {
    const ns = normalizeNodes([{ key: 'k', name: 'N', up: 'p', k: 'api' }], { id: 'key', label: 'name', parentId: 'up', kind: 'k' });
    expect(ns[0]).toMatchObject({ id: 'k', label: 'N', parentId: 'p', kind: 'api' });
  });

  it('non-array input → empty', () => {
    expect(normalizeNodes(undefined)).toEqual([]);
    expect(normalizeNodes({} as unknown)).toEqual([]);
  });
});

describe('node-tree-layout — normalizeEdges', () => {
  it('keeps well-formed edges; drops those missing source/target', () => {
    const es = normalizeEdges([
      { source: 'a', target: 'b', kind: 'calls', label: 'x' },
      { source: 'a' },
      { target: 'b' },
      null,
    ]);
    expect(es).toEqual([{ source: 'a', target: 'b', kind: 'calls', label: 'x' }]);
  });

  it('kind/label are optional', () => {
    const es = normalizeEdges([{ source: 'a', target: 'b' }]);
    expect(es[0]).toEqual({ source: 'a', target: 'b', kind: undefined, label: undefined });
  });
});

describe('node-tree-layout — computeDepths', () => {
  const nodes = normalizeNodes([
    { id: 'sys', kind: 'system' },
    { id: 'c1', parentId: 'sys', kind: 'container' },
    { id: 'n1', parentId: 'c1', kind: 'route' },
    { id: 'orphan', parentId: 'ghost', kind: 'lib' }, // unknown parent → root
  ]);

  it('counts parentId hops to a root; unknown parent → 0', () => {
    const d = computeDepths(nodes);
    expect(d.get('sys')).toBe(0);
    expect(d.get('c1')).toBe(1);
    expect(d.get('n1')).toBe(2);
    expect(d.get('orphan')).toBe(0);
  });

  it('is cycle-safe (a back-edge terminates at 0)', () => {
    const cyc = normalizeNodes([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]);
    const d = computeDepths(cyc);
    expect(d.get('a')).toBeGreaterThanOrEqual(0);
    expect(d.get('b')).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(d.get('a') as number)).toBe(true);
  });
});

describe('node-tree-layout — layoutTree', () => {
  // sys → [c1 → (n1, n2), c2 → (n3)]
  const nodes = normalizeNodes([
    { id: 'sys', label: 'Sys', kind: 'system' },
    { id: 'c1', label: 'C1', parentId: 'sys', kind: 'container' },
    { id: 'n1', label: 'N1', parentId: 'c1', kind: 'route' },
    { id: 'n2', label: 'N2', parentId: 'c1', kind: 'route' },
    { id: 'c2', label: 'C2', parentId: 'sys', kind: 'container' },
    { id: 'n3', label: 'N3', parentId: 'c2', kind: 'api' },
  ]);
  const opts = { colWidth: 200, nodeW: 160, nodeH: 40, rowGap: 50, marginX: 20, marginY: 30 };
  const L = layoutTree(nodes, opts);

  it('x = marginX + depth·colWidth', () => {
    expect(L.byId.sys.x).toBe(20); // depth 0
    expect(L.byId.c1.x).toBe(220); // depth 1
    expect(L.byId.n1.x).toBe(420); // depth 2
  });

  it('leaves stack at sequential rows; y = marginY + nodeH/2 + row·rowGap', () => {
    // leaf order (DFS): n1(0), n2(1), n3(2)
    expect(L.byId.n1.cy).toBe(30 + 20 + 0 * 50); // 50
    expect(L.byId.n2.cy).toBe(30 + 20 + 1 * 50); // 100
    expect(L.byId.n3.cy).toBe(30 + 20 + 2 * 50); // 150
  });

  it('a parent centres between its first and last child', () => {
    expect(L.byId.c1.cy).toBe((L.byId.n1.cy + L.byId.n2.cy) / 2); // 75
    expect(L.byId.c2.cy).toBe(L.byId.n3.cy); // single child → same row
    expect(L.byId.sys.cy).toBe((L.byId.c1.cy + L.byId.c2.cy) / 2);
  });

  it('canvas size covers all columns + leaf rows', () => {
    // maxDepth 2 → width = 20*2 + 2*200 + 160 = 600
    expect(L.width).toBe(600);
    // 3 leaves → height = 30*2 + 2*50 + 40 = 200
    expect(L.height).toBe(200);
  });

  it('emits a parent→child skeleton link for every non-root node', () => {
    expect(L.links).toHaveLength(5); // c1,c2,n1,n2,n3 each link to their parent
    for (const lk of L.links) {
      expect(lk.kind).toBe('hier');
      expect(lk.path.startsWith('M')).toBe(true);
    }
  });
});

describe('node-tree-layout — layoutEdges', () => {
  const nodes = normalizeNodes([
    { id: 'a', kind: 'route' },
    { id: 'b', parentId: 'a', kind: 'api' },
  ]);
  const L = layoutTree(nodes);
  it('resolves an edge between two present nodes → a path + midpoint', () => {
    const es = layoutEdges(normalizeEdges([{ source: 'a', target: 'b', kind: 'calls', label: 'hi' }]), L.byId);
    expect(es).toHaveLength(1);
    expect(es[0].kind).toBe('calls');
    expect(es[0].label).toBe('hi');
    expect(es[0].path.startsWith('M')).toBe(true);
    expect(typeof es[0].mid.x).toBe('number');
  });
  it('drops an edge whose endpoint is absent', () => {
    expect(layoutEdges(normalizeEdges([{ source: 'a', target: 'ghost' }]), L.byId)).toHaveLength(0);
  });
  it('defaults a missing edge kind to calls', () => {
    const es = layoutEdges(normalizeEdges([{ source: 'a', target: 'b' }]), L.byId);
    expect(es[0].kind).toBe('calls');
  });
});

describe('node-tree-layout — linkPath', () => {
  it('emits a cubic bezier M…C… string with rounded coords', () => {
    const s = linkPath(0, 0, 100, 50);
    expect(s).toMatch(/^M0,0 C\d/);
    expect(s).toContain('100,50');
  });
});

describe('node-tree-layout — palette + helpers', () => {
  it('nodeColor maps known kinds; unknown → lib', () => {
    expect(nodeColor('system')).toBe(NODE_COLORS.system);
    expect(nodeColor('store')).toBe(NODE_COLORS.store);
    expect(nodeColor('mystery')).toBe(NODE_COLORS.lib);
  });
  it('edgeColor maps known kinds; unknown → grey fallback', () => {
    expect(edgeColor('calls')).toBe(EDGE_COLORS.calls);
    expect(edgeColor('flow')).toBe(EDGE_COLORS.flow);
    expect(edgeColor('mystery')).toBe('#94a3b8');
  });
  it('nodeLegend lists distinct kinds in first-seen order with counts', () => {
    const ns = normalizeNodes([{ id: 1, kind: 'route' }, { id: 2, kind: 'api' }, { id: 3, kind: 'route' }]);
    const lg = nodeLegend(ns);
    expect(lg.map((l) => l.kind)).toEqual(['route', 'api']);
    expect(lg.find((l) => l.kind === 'route')?.count).toBe(2);
  });
  it('truncate clips with an ellipsis past the limit', () => {
    expect(truncate('short', 24)).toBe('short');
    expect(truncate('a'.repeat(30), 10)).toBe('aaaaaaaaa…');
    expect(truncate('a'.repeat(30), 10)).toHaveLength(10);
  });
});
