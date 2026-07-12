/**
 * graph-to-tf.test.ts — unit tests for the composition-graph → TrueForm recipe
 * translator (TODO #46, v0). Small hand-built graphs; pure, no WASM.
 */
import { describe, it, expect } from 'vitest';
import type { Graph } from '$lib/graph/composition-graph-types';
import { graphToTf, tfRecipeText, type TfInstr, type ResolveComposite } from '../graph-to-tf';

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

  it('r_weld_extrude of a polygon → a weld_extrude instr with concrete section + morph args (g_star shape)', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        // A tiny centred square section (stand-in for g_star/g_cube's polygon).
        n_poly: {
          id: 'n_poly', type: 'polygon',
          points: [
            { kind: 'point', r: { kind: 'literal', value: -1 }, z: { kind: 'literal', value: -1 } },
            { kind: 'point', r: { kind: 'literal', value: 1 }, z: { kind: 'literal', value: -1 } },
            { kind: 'point', r: { kind: 'literal', value: 1 }, z: { kind: 'literal', value: 1 } },
            { kind: 'point', r: { kind: 'literal', value: -1 }, z: { kind: 'literal', value: 1 } },
          ],
        },
        n_call: {
          id: 'n_call', type: 'call', src: 'r_weld_extrude', alias: 'A',
          args: {
            profile: { kind: 'expr', expr: '__POLY__n_poly' },
            length: { kind: 'param', param: 'length' },
            divs: { kind: 'literal', value: 12 },
            twist: { kind: 'literal', value: 30 },
            taper: { kind: 'literal', value: 0.25 },
            segments: { kind: 'literal', value: 32 },
          },
        },
      },
      'n_root',
      { length: { default: 4 } },
    );
    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1); // polygon consumed via __POLY__, only the extrude is output
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'weld_extrude' }>;
    expect(inst.op).toBe('weld_extrude');
    expect(inst.length).toBe(4);
    expect(inst.twist).toBe(30);
    expect(inst.divs).toBe(12);
    expect(inst.segments).toBe(32);
    // taper 0.25 → scaleTop = 1 - 0.25 = 0.75 (both axes).
    expect(inst.scaleTop).toEqual([0.75, 0.75]);
    expect(inst.profile).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    expect(recipe.notes.some((n) => n.includes('UNSUPPORTED'))).toBe(false);
  });

  it('r_weld_extrude with no wired profile → falls back to the engine default ngon (still weld_extrude)', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        n_call: { id: 'n_call', type: 'call', src: 'r_weld_extrude', alias: 'B', args: { length: { kind: 'literal', value: 4 } } },
      },
      'n_root',
    );
    const recipe = graphToTf(g);
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'weld_extrude' }>;
    expect(inst.op).toBe('weld_extrude');
    expect(inst.profile.length).toBe(6); // default ngon hex
    expect(inst.length).toBe(4);
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

  it('editing the section def pts FORMULA refreshes the recipe (circle vs ellipse) — TF stale-section bug', () => {
    // BUG (fixed): on the TF tab, editing a sweep part's SECTION function-expr
    // did NOT refresh the bake. The r_sweep arm derived the section from the
    // wired circle expr's `rad` BINDING only, ignoring the def's actual `pts`
    // FORMULA — so a formula edit that kept `rad` (circle→ellipse) produced a
    // byte-identical recipe. The fix EVALUATES the wired def's real output with
    // the live params. Two graphs, identical except the def's `pts` formula.
    const mkSweep = (): Graph => mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_sweep'] },
        n_circle: {
          id: 'n_circle', type: 'expr', defId: 'd_circle',
          bindings: { rad: { kind: 'param', param: 'rad' }, num_pts: { kind: 'param', param: 'num_arcs' } },
        },
        n_sec: {
          id: 'n_sec', type: 'spline',
          // STALE cached literal control points (radius 1.5) — NOT a fallback the
          // fix relies on; the recipe must come from the live formula, not these.
          points: [[1.5, 0, 0], [0, 1.5, 0], [-1.5, 0, 0]],
          pointsExpr: { kind: 'expr', expr: '_x_n_circle_pts' },
          samples: { kind: 'literal', value: 32 }, closed: true,
        },
        n_path: {
          id: 'n_path', type: 'spline',
          points: [[0, 0, 0], [0, 0, 2], [0, 0, 4], [0, 0, 6]],
          samples: { kind: 'literal', value: 16 }, closed: false,
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
    // `pts` = a circle of radius `rad` (the sweep_tube_demo def).
    const circleFormula = 'poly = []\nfor i = 0 to num_pts\n  poly.append([rad*cos(tau * i / num_pts), rad*sin(tau * i / num_pts), 0])\nreturn poly';
    // Same `rad`, but the x-amplitude is DOUBLED → a non-circular ellipse.
    const ellipseFormula = 'poly = []\nfor i = 0 to num_pts\n  poly.append([2*rad*cos(tau * i / num_pts), rad*sin(tau * i / num_pts), 0])\nreturn poly';
    const mkDef = (formula: string) => ({
      id: 'd_circle', name: 'circle',
      params: [{ name: 'rad', default: 2 }, { name: 'num_pts', default: 12 }],
      consts: [], vars: [],
      outputs: [{ name: 'pts', formula, shape: 'list', elem: 'point' }],
    });

    const gCircle = mkSweep(); (gCircle as any).exprDefs = [mkDef(circleFormula)];
    const gEllipse = mkSweep(); (gEllipse as any).exprDefs = [mkDef(ellipseFormula)];

    const rc = graphToTf(gCircle);
    const re = graphToTf(gEllipse);

    // Circle → the circular fast path, radius = the LIVE `rad` (0.6), NOT the
    // stale 1.5 literal (proves the evaluated formula drives the recipe).
    const ic = rc.instrs[0] as Extract<TfInstr, { op: 'sweep' }>;
    expect(ic.op).toBe('sweep');
    expect(ic.radius).toBeCloseTo(0.6, 6);

    // Ellipse → non-circular → sweep_section carrying the LIVE ellipse loop
    // (x-amplitude 1.2 = 2·rad). On `main` this was still `op:'sweep'` r=0.6.
    const ie = re.instrs[0] as Extract<TfInstr, { op: 'sweep_section' }>;
    expect(ie.op).toBe('sweep_section');
    const maxAbsX = Math.max(...ie.section.map((p) => Math.abs(p[0])));
    expect(maxAbsX).toBeCloseTo(1.2, 4);

    // The bug's signature: on `main` both recipes were IDENTICAL (formula ignored).
    // The fix makes the FORMULA edit change the recipe.
    expect(JSON.stringify(rc.instrs)).not.toBe(JSON.stringify(re.instrs));
  });

  it('r_sweep of a NON-circular literal section → a sweep_section instr (not UNSUPPORTED), #50', () => {
    // A section spline with LITERAL, non-circular points (a rounded rectangle-ish
    // loop) that sectionRadiusOf rejects — now lowers to the arbitrary-section
    // sweep (tfSweepSection) instead of the old UNSUPPORTED mesh-import fallback.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_sweep'] },
        n_sec: {
          id: 'n_sec', type: 'spline',
          // A rectangle WITH edge midpoints — the midpoints sit at r=0.5 vs the
          // corners at r≈1.118, so sectionRadiusOf reads it as NON-circular.
          points: [[-1, -0.5, 0], [0, -0.5, 0], [1, -0.5, 0], [1, 0.5, 0], [0, 0.5, 0], [-1, 0.5, 0]],
          samples: { kind: 'literal', value: 6 }, closed: true,
        },
        n_path: {
          id: 'n_path', type: 'spline',
          points: [[0, 0, 0], [0, 0, 2], [0.5, 0, 4], [0.5, 0, 6]],
          samples: { kind: 'literal', value: 8 }, closed: false,
        },
        n_sweep: {
          id: 'n_sweep', type: 'call', src: 'r_sweep', alias: 'body',
          args: {
            path: { kind: 'expr', expr: '_x_n_path_path' },
            section: { kind: 'expr', expr: '_x_n_sec_path' },
            caps: { kind: 'literal', value: true },
            smooth: { kind: 'literal', value: 'taubin' }, // exercises the #51 hook plumbing
          },
        },
      },
      'n_root',
      {},
    );

    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'sweep_section' }>;
    expect(inst.op).toBe('sweep_section');
    expect(inst.section).toEqual([[-1, -0.5], [0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5], [-1, 0.5]]); // 2D loop (x,y)
    expect(inst.path).toHaveLength(8);      // resampled to `samples`
    expect(inst.capped).toBe(true);
    expect(inst.closedSection).toBe(true);
    expect(inst.smooth).toBe('taubin');     // smoothing request threaded through
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

  it('a parts_map (op:list) lowers a list<record> param to a union of N synthetic-Call instances', () => {
    // #38 Phase 3 — a `list<record>` param of 2 rows mapped over r_cuboid, each row
    // feeding s.size into w/h/d. Native lowering must resolve the rows from the
    // param default, evaluate `s.size` per row, and union the 2 boxes.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_pm'] },
        n_pm: {
          id: 'n_pm', type: 'parts_map', src: 'r_cuboid', list: { kind: 'param', param: 'blocks' },
          argMap: { w: { kind: 'expr', expr: 's.size' }, h: { kind: 'expr', expr: 's.size' }, d: { kind: 'expr', expr: 's.size' } },
          op: 'list',
        },
      },
      'n_root',
      { blocks: { kind: 'list', of: { record: 'Block' }, default: [{ size: 2 }, { size: 3 }] } },
    );
    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    const top = recipe.instrs[0] as Extract<TfInstr, { op: 'union' }>;
    expect(top.op).toBe('union');
    expect(top.children).toEqual([
      { op: 'box', w: 2, h: 2, d: 2 },
      { op: 'box', w: 3, h: 3, d: 3 },
    ]);
    expect(recipe.notes.every((n) => !n.includes('UNSUPPORTED'))).toBe(true);
  });

  it('a parts_map (op:stack) unions its instances mated; a blank src / unresolvable rows → UNSUPPORTED', () => {
    const g = (op: string, list: any) => mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_pm'] },
        n_pm: { id: 'n_pm', type: 'parts_map', src: 'r_cuboid', list, argMap: { w: { kind: 'expr', expr: 's.size' }, h: { kind: 'literal', value: 1 }, d: { kind: 'literal', value: 1 } }, op },
      },
      'n_root',
      { blocks: { kind: 'list', of: { record: 'Block' }, default: [{ size: 4 }] } },
    );
    const stacked = graphToTf(g('stack', { kind: 'param', param: 'blocks' })).instrs[0] as Extract<TfInstr, { op: 'union' }>;
    expect(stacked.op).toBe('union');
    expect(stacked.mated).toBe(true);
    expect(stacked.children).toEqual([{ op: 'box', w: 4, h: 1, d: 1 }]);
    // A param with no resolvable array default → UNSUPPORTED (native-only blanks).
    expect(graphToTf(g('list', { kind: 'param', param: 'missing' })).instrs[0].op).toBe('UNSUPPORTED');
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

  it('per-part MATL preset flows to recipe.partAppearance[i].material (steel), absent for none', () => {
    // bw_open_hole-shaped: a SINGLE output Call carrying a per-part material
    // override. The recipe must carry `material:'steel'` on partAppearance[0] so
    // the TF per-part-mesh render can apply materialPreset(steel). A part with no
    // material (or 'none') must leave partAppearance[i].material ABSENT.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_a', 'n_b'] },
        n_a: { id: 'n_a', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 4 } } },
        n_b: { id: 'n_b', type: 'call', src: 'r_cuboid', alias: 'B', args: { w: { kind: 'literal', value: 2 }, h: { kind: 'literal', value: 2 }, d: { kind: 'literal', value: 2 } } },
      },
      'n_root',
    );
    // A = steel (per-part override); B = none (explicit 'none' ⇒ dropped).
    (g as any).partAppearance = { n_a: { material: 'steel' }, n_b: { material: 'none' } };

    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(2);
    expect(recipe.partAppearance).toBeDefined();
    expect(recipe.partAppearance![0]).toEqual({ material: 'steel' });
    // B's 'none' ⇒ no appearance fields ⇒ the whole entry stays undefined.
    expect(recipe.partAppearance![1]).toBeUndefined();
  });

  it('a multi-root list is SEPARATE by default (no recipe.compose); a `compose` root flag sets recipe.compose', () => {
    // Priority-2 seam: the executor keeps the unconsumed roots SEPARATE unless the
    // recipe carries `compose:true`, which is sourced from a `compose` flag on the
    // ROOT container/list node. The lowering just threads the flag; the executor
    // acts on it (proven in execute.test.ts). Default (no flag) ⇒ compose absent.
    const nodes = {
      n_root: { id: 'n_root', type: 'list', children: ['n_a', 'n_b'] },
      n_a: { id: 'n_a', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 4 } } },
      n_b: { id: 'n_b', type: 'call', src: 'r_cuboid', alias: 'B', args: { w: { kind: 'literal', value: 2 }, h: { kind: 'literal', value: 2 }, d: { kind: 'literal', value: 2 } } },
    } as const;
    // Default — separate: no compose on the recipe.
    const plain = graphToTf(mkGraph({ ...nodes }, 'n_root'));
    expect(plain.instrs).toHaveLength(2);
    expect(plain.compose).toBeUndefined();
    // Opt-in — the root list node carries `compose:true`.
    const composed = graphToTf(mkGraph({ ...nodes, n_root: { ...nodes.n_root, compose: true } }, 'n_root'));
    expect(composed.instrs).toHaveLength(2);
    expect(composed.compose).toBe(true);
  });

  it('a lone steel output part still emits partAppearance[0].material (single-output case)', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_a'] },
        n_a: { id: 'n_a', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 4 } } },
      },
      'n_root',
    );
    (g as any).partAppearance = { n_a: { material: 'steel' } };
    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    expect(recipe.partAppearance![0]).toEqual({ material: 'steel' });
  });

  it('a WARP output inherits the wrapped part\'s material (warp/mv/rot wrapper walk)', () => {
    // w1_oh_warp-shaped: the material is bound to the wrapped Call (n_a), but the
    // graph OUTPUT is the `warp` node. TF read appearance only off Call outputs →
    // the warped part fell back to default red while the 3D bake showed steel.
    // The wrapper-walk must descend warp.child → n_a and surface its material.
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_warp'] },
        n_warp: { id: 'n_warp', type: 'warp', child: 'n_a', path: { kind: 'literal', value: 0 } },
        n_a: { id: 'n_a', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 4 }, h: { kind: 'literal', value: 4 }, d: { kind: 'literal', value: 4 } } },
      },
      'n_root',
    );
    (g as any).partAppearance = { n_a: { material: 'steel' } };
    const recipe = graphToTf(g);
    expect(recipe.partAppearance).toBeDefined();
    expect(recipe.partAppearance![0]).toEqual({ material: 'steel' });
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

  it('a cutaway modifier → a cutaway instr (not UNSUPPORTED), child consumed', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_cut'] },
        n_shaft: {
          id: 'n_shaft', type: 'call', src: 'r_revolve', alias: 'shaft',
          args: { profile: { kind: 'literal', value: 0 }, segments: { kind: 'literal', value: 32 } },
        },
        n_poly: {
          id: 'n_poly', type: 'polygon',
          points: [
            { r: { kind: 'literal', value: 1 }, z: { kind: 'literal', value: 0 } },
            { r: { kind: 'literal', value: 1 }, z: { kind: 'literal', value: 4 } },
            { r: { kind: 'literal', value: 0.5 }, z: { kind: 'literal', value: 4 } },
            { r: { kind: 'literal', value: 0.5 }, z: { kind: 'literal', value: 0 } },
          ],
        },
        n_cut: {
          id: 'n_cut', type: 'cutaway', child: 'n_shaft',
          az: { kind: 'literal', value: 90 }, offset: { kind: 'literal', value: 0 },
        },
      },
      'n_root',
    );
    (g.nodes.n_shaft as any).args.profile = { kind: 'ref', ref: 'n_poly' };
    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1);
    expect(recipe.instrs[0].op).toBe('cutaway');
    expect((recipe.instrs[0] as any).az).toBe(90);
    expect(recipe.notes.every((n) => !n.includes('UNSUPPORTED'))).toBe(true);
    expect(tfRecipeText(recipe)).toContain('sectionCut(az=90');
  });
});
