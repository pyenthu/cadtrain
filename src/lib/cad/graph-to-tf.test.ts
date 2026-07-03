/**
 * graph-to-tf.test.ts — unit tests for the composition-graph → TrueForm recipe
 * translator (TODO #46, v0). Small hand-built graphs; pure, no WASM.
 */
import { describe, it, expect } from 'vitest';
import type { Graph } from './composition-graph-types';
import { graphToTf, tfRecipeText, type TfInstr } from './graph-to-tf';

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
