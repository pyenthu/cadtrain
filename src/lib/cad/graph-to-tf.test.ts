/**
 * graph-to-tf.test.ts — unit tests for the composition-graph → TrueForm recipe
 * translator (TODO #46, v0). Small hand-built graphs; pure, no WASM.
 */
import { describe, it, expect } from 'vitest';
import type { Graph } from './composition-graph-types';
import { graphToTf, tfRecipeText, type TfInstr, type ResolveComposite } from './graph-to-tf';

/** Minimal graph scaffold — only the fields the translator reads. */
function mkGraph(nodes: Record<string, any>, root: string, params: Record<string, any> = {}): Graph {
  return {
    nodes,
    root,
    params,
    edges: [],
    imports: [],
    layout: {},
  } as unknown as Graph;
}

describe('graphToTf', () => {
  it('revolve of a polygon → a revolve instr with concrete [r,z] points', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        n_poly: {
          id: 'n_poly',
          type: 'polygon',
          points: [
            { kind: 'point', r: { kind: 'expr', expr: 'p.id / 2' }, z: { kind: 'literal', value: 0 } },
            { kind: 'point', r: { kind: 'param', param: 'od_half' }, z: { kind: 'literal', value: 0 } },
            { kind: 'point', r: { kind: 'param', param: 'od_half' }, z: { kind: 'param', param: 'length' } },
          ],
        },
        n_call: {
          id: 'n_call',
          type: 'call',
          src: 'r_revolve',
          alias: 'A',
          args: {
            profile: { kind: 'expr', expr: '__POLY__n_poly' },
            segments: { kind: 'param', param: 'segments' },
          },
        },
      },
      'n_root',
      { id: { default: 2 }, od_half: { default: 3 }, length: { default: 5 }, segments: { default: 32 } },
    );

    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1); // polygon is consumed via __POLY__, only the revolve is output
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'revolve' }>;
    expect(inst.op).toBe('revolve');
    expect(inst.segments).toBe(32);
    expect(inst.profile).toEqual([
      [1, 0],   // p.id/2 = 1
      [3, 0],   // od_half = 3
      [3, 5],   // od_half, length
    ]);
  });

  it('a subtract Method → booleanDifference(obj, arg)', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_diff'] },
        n_outer: { id: 'n_outer', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 4 } } },
        n_inner: { id: 'n_inner', type: 'call', src: 'r_cuboid', alias: 'B', args: { w: { kind: 'literal', value: 2 }, h: { kind: 'literal', value: 2 }, d: { kind: 'literal', value: 6 } } },
        n_diff: { id: 'n_diff', type: 'method', op: 'subtract', obj: 'n_outer', arg: 'n_inner' },
      },
      'n_root',
    );

    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'booleanDifference' }>;
    expect(inst.op).toBe('booleanDifference');
    expect(inst.obj).toEqual({ op: 'box', w: 4, h: 4, d: 4 });
    expect(inst.arg).toEqual({ op: 'box', w: 2, h: 2, d: 6 });
  });

  it('sketch rel-mode ops build a running polyline; fillet is noted + skipped', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        n_sk: {
          id: 'n_sk',
          type: 'sketch',
          ops: [
            { op: 'line', r: { kind: 'literal', value: 3 }, z: { kind: 'literal', value: 0 } },
            { op: 'fillet', radius: { kind: 'literal', value: 0.5 } },
            { op: 'line', r: { kind: 'literal', value: 0 }, z: { kind: 'literal', value: 4 }, mode: 'rel' },
          ],
          segments: { kind: 'literal', value: 64 },
        },
        n_call: { id: 'n_call', type: 'call', src: 'r_revolve', alias: 'A', args: { profile: { kind: 'expr', expr: '__POLY__n_sk' }, segments: { kind: 'literal', value: 64 } } },
      },
      'n_root',
    );
    const recipe = graphToTf(g);
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'revolve' }>;
    expect(inst.profile).toEqual([[3, 0], [3, 4]]); // rel z=+4 off the cursor (3,0)
    expect(recipe.notes.some((n) => n.includes('fillet'))).toBe(true);
  });

  it('an unmapped engine (r_weld_extrude) → UNSUPPORTED', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        n_call: { id: 'n_call', type: 'call', src: 'r_weld_extrude', alias: 'B', args: { length: { kind: 'literal', value: 4 } } },
      },
      'n_root',
    );
    const recipe = graphToTf(g);
    expect(recipe.instrs[0].op).toBe('UNSUPPORTED');
    expect(recipe.notes.length).toBeGreaterThan(0);
  });

  it('r_sweep of a wired spline path + circle-expr section → a sweep instr with a concrete resampled path + radius', () => {
    // Mirrors the sweep_tube_demo graph: a 5-pt path spline + a section spline
    // wired to a `d_circle` expr whose `rad` binding is the part param.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_sweep'] },
        n_circle: {
          id: 'n_circle', type: 'expr', defId: 'd_circle',
          bindings: { rad: { kind: 'param', param: 'rad' }, num_pts: { kind: 'param', param: 'num_arcs' } },
        },
        n_sec: {
          id: 'n_sec', type: 'spline',
          points: [[1.5, 0, 0], [0, 1.5, 0], [-1.5, 0, 0]],
          pointsExpr: { kind: 'expr', expr: '_x_n_circle_pts' },
          samples: { kind: 'literal', value: 32 }, closed: true,
        },
        n_path: {
          id: 'n_path', type: 'spline',
          points: [[-0.021, -0.186, 0.646], [0, 0, 1.522], [0, 0, 2.498], [0.063, -0.011, 4.456], [0, 0, 7.531]],
          samples: { kind: 'literal', value: 32 }, closed: false,
        },
        n_sweep: {
          id: 'n_sweep', type: 'call', src: 'r_sweep', alias: 'body',
          args: {
            path: { kind: 'expr', expr: '_x_n_path_path' },
            section: { kind: 'expr', expr: '_x_n_sec_path' },
            closedPath: { kind: 'literal', value: false },
            caps: { kind: 'literal', value: true },
          },
        },
      },
      'n_root',
      { rad: { default: 0.6 }, num_arcs: { default: 12 } },
    );

    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'sweep' }>;
    expect(inst.op).toBe('sweep');
    expect(inst.radius).toBeCloseTo(0.6, 6);       // from the d_circle `rad` binding = param rad
    expect(inst.radialSegments).toBe(32);          // section spline samples
    expect(inst.capped).toBe(true);                // caps arg (open path)
    expect(inst.path).toHaveLength(32);            // resampled to `samples`
    // First/last resampled points pass through the control endpoints (clamped CR).
    expect(inst.path[0][2]).toBeCloseTo(0.646, 3);
    expect(inst.path[31][2]).toBeCloseTo(7.531, 3);
  });

  it('recurses into a COMPOSITE Call, mapping args → the sub-part scope + splicing its instrs', () => {
    // Sub-part B: a box whose width IS its `rad` param (default 9).
    const subB: Graph = mkGraph(
      {
        n_r: { id: 'n_r', type: 'list', children: ['n_box'] },
        n_box: {
          id: 'n_box', type: 'call', src: 'r_cuboid', alias: 'X',
          args: { w: { kind: 'param', param: 'rad' }, h: { kind: 'literal', value: 1 }, d: { kind: 'literal', value: 1 } },
        },
      },
      'n_r',
      { rad: { default: 9 } },
    );
    const resolve: ResolveComposite = (id) => (id === 'partB' ? { graph: subB, params: {} } : null);

    // Parent A: subtract two `partB` calls with different `rad` — the s_tube_demo shape.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_a', 'n_b', 'n_diff'] },
        n_a: { id: 'n_a', type: 'call', src: 'partB', alias: 'A', args: { rad: { kind: 'literal', value: 0.6 } } },
        n_b: { id: 'n_b', type: 'call', src: 'partB', alias: 'B', args: { rad: { kind: 'literal', value: 0.5 } } },
        n_diff: { id: 'n_diff', type: 'method', op: 'subtract', obj: 'n_a', arg: 'n_b' },
      },
      'n_root',
    );

    const recipe = graphToTf(g, {}, resolve);
    expect(recipe.instrs).toHaveLength(1); // A + B consumed by the subtract
    const diff = recipe.instrs[0] as Extract<TfInstr, { op: 'booleanDifference' }>;
    expect(diff.op).toBe('booleanDifference');
    // Each composite spliced to its single box instr; the Call arg OVERRODE the default 9.
    expect(diff.obj).toEqual({ op: 'box', w: 0.6, h: 1, d: 1 });
    expect(diff.arg).toEqual({ op: 'box', w: 0.5, h: 1, d: 1 });
    expect(recipe.notes.every((n) => !n.includes('UNSUPPORTED'))).toBe(true);
  });

  it('a composite Call with no resolver → UNSUPPORTED (unchanged v0 behaviour)', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_c'] },
        n_c: { id: 'n_c', type: 'call', src: 'some_part', alias: 'A', args: {} },
      },
      'n_root',
    );
    expect(graphToTf(g).instrs[0].op).toBe('UNSUPPORTED');            // no resolver
    expect(graphToTf(g, {}, () => null).instrs[0].op).toBe('UNSUPPORTED'); // resolver returns null
  });

  it('guards a composite CYCLE (self-referential part) → UNSUPPORTED, no infinite recursion', () => {
    const selfG: Graph = mkGraph(
      {
        n_r: { id: 'n_r', type: 'list', children: ['n_self'] },
        n_self: { id: 'n_self', type: 'call', src: 'loopy', alias: 'A', args: {} },
      },
      'n_r',
    );
    const resolve: ResolveComposite = (id) => (id === 'loopy' ? { graph: selfG, params: {} } : null);
    const recipe = graphToTf(selfG, {}, resolve);
    // The inner self-call hits the cycle guard → its splice is UNSUPPORTED.
    expect(JSON.stringify(recipe.instrs)).toContain('UNSUPPORTED');
    expect(recipe.notes.some((n) => n.includes('CYCLE'))).toBe(true);
  });

  it('a STACK node with childCounts lowers the counted child to a stack-mode repeat (g_dp_stand)', () => {
    // g_dp_stand-shaped: a `stack` with ONE child repeated n=3 (childCounts). This
    // must lower to a mated union whose single child is { op:'repeat', mode:'stack' }
    // — so the executor stacks the N copies END-TO-END, not piled at the origin.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_stack'] },
        n_joint: { id: 'n_joint', type: 'call', src: 'r_cuboid', alias: 'J', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 20 } } },
        n_stack: {
          id: 'n_stack',
          type: 'stack',
          children: ['n_joint'],
          childCounts: { n_joint: { kind: 'param', param: 'n' } },
          childRefs: { n_joint: -2.75 },
        },
      },
      'n_root',
      { n: { default: 3 } },
    );

    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    const top = recipe.instrs[0] as Extract<TfInstr, { op: 'union' }>;
    expect(top.op).toBe('union');
    expect(top.mated).toBe(true);
    expect(top.children).toHaveLength(1);
    const rep = top.children[0] as Extract<TfInstr, { op: 'repeat' }>;
    expect(rep.op).toBe('repeat');
    expect(rep.count).toBe(3);
    expect(rep.mode).toBe('stack');
    expect(rep.child).toEqual({ op: 'box', w: 4, h: 4, d: 20 });
  });

  it('a count of 1 (or an absent childCounts entry) lowers the child directly — no repeat wrapper', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_stack'] },
        n_a: { id: 'n_a', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 1 }, h: { kind: 'literal', value: 1 }, d: { kind: 'literal', value: 1 } } },
        n_b: { id: 'n_b', type: 'call', src: 'r_cuboid', alias: 'B', args: { w: { kind: 'literal', value: 2 }, h: { kind: 'literal', value: 2 }, d: { kind: 'literal', value: 2 } } },
        n_stack: { id: 'n_stack', type: 'stack', children: ['n_a', 'n_b'], childCounts: { n_a: { kind: 'literal', value: 1 } } },
      },
      'n_root',
    );
    const top = graphToTf(g).instrs[0] as Extract<TfInstr, { op: 'union' }>;
    expect(top.children).toEqual([
      { op: 'box', w: 1, h: 1, d: 1 },
      { op: 'box', w: 2, h: 2, d: 2 },
    ]);
  });

  it('tfRecipeText renders a readable plan without throwing', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_diff'] },
        n_a: { id: 'n_a', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 4 } } },
        n_b: { id: 'n_b', type: 'call', src: 'r_cuboid', alias: 'B', args: { w: { kind: 'literal', value: 2 }, h: { kind: 'literal', value: 2 }, d: { kind: 'literal', value: 6 } } },
        n_diff: { id: 'n_diff', type: 'method', op: 'subtract', obj: 'n_a', arg: 'n_b' },
      },
      'n_root',
    );
    const text = tfRecipeText(graphToTf(g), 'demo');
    expect(text).toContain('demo →');
    expect(text).toContain('booleanDifference');
    expect(text).toContain('boxMesh');
  });
});
