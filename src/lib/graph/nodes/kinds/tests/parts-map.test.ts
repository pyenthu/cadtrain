/**
 * parts-map.test.ts — Phase 3 of docs/plans/complex-params-list-of-parts.md.
 *
 * Locks the `parts_map` PRODUCER: it emits `Array.from(<rows>, (s, i) => <src>({…}))`
 * mapping a `list<record>` param to N part instances (the geometry-valued sibling
 * of the list<point> builder), wraps by `op`, is spread as a LIST PRODUCER by a
 * parent Stack, validates its rows + arg-map slots, and — the payoff — an
 * end-to-end emit EXECUTES to N solids (a stubbed template proves the map arity
 * without WASM).
 */
import { describe, it, expect } from 'vitest';
import { PartsMapKind } from '../parts-map';
import type { EmitCtx } from '../../node-kind';
import type { Graph, PartsMapNode, ArgValue } from '$lib/graph/composition/composition-graph-types';
import { emitGraph } from '$lib/graph/composition/composition-emit';

const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ex = (e: string): ArgValue => ({ kind: 'expr', expr: e });

// A ctx that renders args object-style through emitCall (matching emitCallExpr's
// `src({ k: v, … })`), so the descriptor's emit is exercised end-to-end.
const ctx = (): EmitCtx => ({
  ref: (id) => id.toUpperCase(),
  emitValue: (v) =>
    v.kind === 'expr' ? v.expr : v.kind === 'param' ? `p.${v.param}${(v as any).field ? '.' + (v as any).field : ''}` : String((v as any).value),
  emitCall: (src, args) => {
    const keys = Object.keys(args ?? {});
    if (keys.length === 0) return `${src}({})`;
    return `${src}({ ${keys.map((k) => `${k}: ${ctx().emitValue(args[k]!)}`).join(', ')} })`;
  },
  varNames: new Map(), listProducers: new Set(), nodes: {},
});

const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);

const pm = (extra: Partial<PartsMapNode> = {}): PartsMapNode =>
  ({
    id: 'pm',
    type: 'parts_map',
    src: 'g_casing',
    list: par('strings'),
    argMap: { od: ex('s.od'), wall: ex('s.wall'), length: ex('s.length') },
    ...extra,
  } as PartsMapNode);

describe('PartsMapKind — emit', () => {
  it('op:list (default) → the bare Array.from over the list param with record-field args', () => {
    expect(PartsMapKind.emitExpr(pm(), ctx())).toBe(
      'Array.from(p.strings, (s, i) => g_casing({ od: s.od, wall: s.wall, length: s.length }))',
    );
  });

  it('op:stack → stack(array); op:place → place(array)', () => {
    expect(PartsMapKind.emitExpr(pm({ op: 'stack' }), ctx())).toBe(
      'stack(Array.from(p.strings, (s, i) => g_casing({ od: s.od, wall: s.wall, length: s.length })))',
    );
    expect(PartsMapKind.emitExpr(pm({ op: 'place' }), ctx())).toBe(
      'place(Array.from(p.strings, (s, i) => g_casing({ od: s.od, wall: s.wall, length: s.length })))',
    );
  });

  it('honours a custom loopVar (index stays i)', () => {
    const n = pm({ loopVar: 'row', argMap: { od: ex('row.od') } });
    expect(PartsMapKind.emitExpr(n, ctx())).toBe('Array.from(p.strings, (row, i) => g_casing({ od: row.od }))');
  });

  it('falls back to `s` for a non-identifier loopVar', () => {
    const n = pm({ loopVar: '9 bad', argMap: { od: ex('s.od') } });
    expect(PartsMapKind.emitExpr(n, ctx())).toBe('Array.from(p.strings, (s, i) => g_casing({ od: s.od }))');
  });

  it('an empty argMap emits `src({})`', () => {
    expect(PartsMapKind.emitExpr(pm({ argMap: {} }), ctx())).toBe('Array.from(p.strings, (s, i) => g_casing({}))');
  });

  it('accepts an expr list source (not only a param)', () => {
    const n = pm({ list: ex('e.rows'), argMap: { od: ex('s.od') } });
    expect(PartsMapKind.emitExpr(n, ctx())).toBe('Array.from(e.rows, (s, i) => g_casing({ od: s.od }))');
  });
});

describe('PartsMapKind — validate', () => {
  it('clean when the list param + arg params exist', () => {
    expect(PartsMapKind.validate(pm(), graph({ pm: {} }, { strings: {} }))).toEqual([]);
  });

  it('flags a deleted list param + a blank src', () => {
    const errs = PartsMapKind.validate(pm({ src: '', list: par('gone'), argMap: {} }), graph({}, {}));
    expect(errs).toContainEqual({ nodeId: 'pm', slot: 'src', badRef: '', kind: 'missing-node' });
    expect(errs).toContainEqual({ nodeId: 'pm', slot: 'list', badRef: 'gone', kind: 'missing-param' });
  });

  it('flags a deleted param referenced by an argMap value', () => {
    const n = pm({ argMap: { od: par('vanished') } });
    const errs = PartsMapKind.validate(n, graph({ pm: {} }, { strings: {} }));
    expect(errs).toContainEqual({ nodeId: 'pm', slot: 'argMap.od', badRef: 'vanished', kind: 'missing-param' });
  });
});

describe('PartsMapKind — sockets / size / inputRefs', () => {
  it('inputRefs is empty — a parts_map consumes params/exprs, not graph nodes', () => {
    expect(PartsMapKind.inputRefs(pm())).toEqual([]);
  });
  it('sockets expose the list input + one per mapped arg', () => {
    expect(PartsMapKind.sockets(pm())).toEqual({ inputs: ['list', 'od', 'wall', 'length'], output: true });
  });
  it('size grows 24px per mapped arg above the 110 floor', () => {
    // 3 args → max(110, 64 + 4*24) = 160
    expect(PartsMapKind.size(pm(), { width: 220, root: 'r' })).toEqual({ w: 220, h: 160 });
    // 0 args → max(110, 64 + 1*24) = 110
    expect(PartsMapKind.size(pm({ argMap: {} }), { width: 220, root: 'r' })).toEqual({ w: 220, h: 110 });
  });
});

describe('PartsMapKind — list-producer spreading through a Stack', () => {
  // A parts_map (op:list) child of a Stack is `...`-spread into stack([...]) so its
  // N instances mate as siblings, exactly like a Repeat with op:list.
  it('emitGraph spreads the producer under a Stack', () => {
    const g = graph(
      {
        r: { id: 'r', type: 'list', children: ['stk'] },
        stk: { id: 'stk', type: 'stack', children: ['pm'] },
        pm: pm({ op: 'list', argMap: { od: ex('s.od') } }),
      },
      { strings: { kind: 'list', of: { record: 'Casing' }, default: [{ od: 9.6 }, { od: 7 }] } },
    );
    const body = emitGraph(g, { id: 't_stack' }).body;
    expect(body).toContain('const _parts_1 = Array.from(p.strings, (s, i) => g_casing({ od: s.od }));');
    // Stack spreads the list producer with `...`.
    expect(body).toContain('stack([..._parts_1])');
  });
});

describe('parts_map — emitGraph → EXECUTES to N solids (bake proof, no WASM)', () => {
  // The example fixture shape: a list<record> param of 3 rows + one parts_map over
  // g_cube (op:list) → the root returns a bare array. Emit the body, then EXECUTE
  // it with a STUBBED template so we prove the map produces exactly N instances.
  const demoGraph = (): Graph =>
    graph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_pm'] },
        n_pm: {
          id: 'n_pm',
          type: 'parts_map',
          src: 'g_cube',
          list: par('blocks'),
          argMap: { size: ex('s.size') },
          op: 'list',
        },
      },
      {
        blocks: {
          kind: 'list',
          of: { record: 'Block' },
          default: [{ size: 2 }, { size: 3 }, { size: 4 }],
        },
      },
    );

  it('emits the Array.from body + returns it + lists g_cube in meta.uses', () => {
    const g = { ...demoGraph(), root: 'n_root' } as Graph;
    const out = emitGraph(g, { id: 'pm_demo' });
    expect(out.body).toContain('const _parts_1 = Array.from(p.blocks, (s, i) => g_cube({ size: s.size }));');
    expect(out.body).toContain('return _parts_1;');
    expect(out.meta.uses).toContain('g_cube');
  });

  it('the emitted body executes to an array of 3 stubbed solids', () => {
    const g = { ...demoGraph(), root: 'n_root' } as Graph;
    const body = emitGraph(g, { id: 'pm_demo' }).body;
    // Stub the template + the params object; evaluate the function body directly.
    const g_cube = (a: { size: number }) => ({ solid: true, size: a.size });
    const p = { blocks: [{ size: 2 }, { size: 3 }, { size: 4 }] };
    // eslint-disable-next-line no-new-func
    const fn = new Function('p', 'g_cube', body);
    const result = fn(p, g_cube);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result.map((r: any) => r.size)).toEqual([2, 3, 4]);
    expect(result.every((r: any) => r.solid)).toBe(true);
  });
});
