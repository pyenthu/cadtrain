/**
 * M.1 — emit + bake a GRAPH with a `sketch` node (not just inline source).
 * Run: bun scripts/spike_sketch_node.ts
 */
import { emitGraph } from '../src/lib/cad/composition-emit';
import type { Graph } from '../src/lib/cad/composition-graph';

const graph: Graph = {
  nodes: {
    n_root: { id: 'n_root', type: 'list', children: ['n_sk', 'n_call'] } as any,
    n_sk: {
      id: 'n_sk', type: 'sketch',
      ops: [
        { op: 'line', r: { kind: 'expr', expr: 'p.bore / 2' }, z: { kind: 'literal', value: 0 } },
        { op: 'line', r: { kind: 'expr', expr: 'p.bore / 2' }, z: { kind: 'param', param: 'len' } },
        { op: 'line', r: { kind: 'expr', expr: 'p.od / 2' }, z: { kind: 'param', param: 'len' } },
        { op: 'chamfer', dist: { kind: 'param', param: 'chamfer' } },
        { op: 'line', r: { kind: 'expr', expr: 'p.od / 2' }, z: { kind: 'literal', value: 0 } },
      ],
      segments: { kind: 'literal', value: 96 },
    } as any,
    n_call: {
      id: 'n_call', type: 'call', src: 'r_revolve', alias: 'A',
      args: {
        profile: { kind: 'expr', expr: '__POLY__n_sk' },
        segments: { kind: 'literal', value: 96 },
      },
    } as any,
  },
  root: 'n_root',
  params: { od: { default: 3 }, bore: { default: 1 }, len: { default: 2 }, chamfer: { default: 0.4 } } as any,
  imports: ['r_revolve'],
  layout: {}, edges: [],
} as any;

const out = emitGraph(graph, { id: 'sk_node_collar' });
console.log('=== emitted source ===');
console.log(out.source);
console.log('\nvalidationErrors:', (out as any).validationErrors ?? '(none)');

// Bake it.
try {
  const res = await fetch('http://localhost:3333/api/primitives/preview', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Volume-Local': '1' },
    body: JSON.stringify({ id: 'sk_node_collar', name: 'sk_node_collar', source: out.source, params: [3, 1, 2, 0.4], mode: 'sandbox' }),
  });
  console.log('\n[BAKE sketch-node graph]:', res.ok
    ? 'PASS — keys ' + Object.keys((await res.json()).full || {}).join(',')
    : 'FAIL ' + res.status + ' ' + (await res.text()).slice(0, 220));
} catch (e: any) { console.log('\n[BAKE]: SKIP — dev server down (' + (e?.message ?? e) + ')'); }
