/**
 * param-kind.test.ts — Phase 1 of docs/plans/complex-params-list-of-parts.md.
 *
 * Locks the `ParamSchema` discriminated union (number | record | list) + its
 * narrowing helpers, the hydrate default-fill, and the OPTIONAL `field?` on a
 * `param` ArgValue (`p.spec.od`). The load-bearing invariant: a NUMBER param
 * (no `kind`) stays byte-identical — that is what keeps golden-emit green.
 */
import { describe, expect, it } from 'vitest';
import {
  hasKind,
  isNumberParam,
  isRecordParam,
  isListParam,
  isPublicParam,
  publicParamNames,
  hydrateParams,
  hydrateGraph,
  newGraph,
  addCall,
  addParam,
  setParamSchema,
  type ParamSchema,
  type NumberParam,
  type RecordParam,
  type ListParam,
} from '../composition-graph';
import { emitGraph } from '../composition-emit';
import { PT_LIST_GEOMETRY, portType, canWire } from '../port-types';

const numberP: NumberParam = { default: 9.625, min: 0, max: 20, step: 0.1 };
const recordP: RecordParam = { kind: 'record', typeId: 'Casing', default: { od: 9.625, wall: 0.545 } };
const listP: ListParam = {
  kind: 'list',
  of: { record: 'Casing' },
  default: [ { od: 9.625, wall: 0.545 }, { od: 7.0, wall: 0.408 } ],
};

describe('ParamSchema union — the narrowing helpers', () => {
  it('treats an absent kind as number (legacy files unchanged)', () => {
    expect(hasKind(numberP)).toBe('number');
    expect(hasKind({ default: 5 })).toBe('number');   // bare legacy shape
    expect(isNumberParam(numberP)).toBe(true);
    expect(isRecordParam(numberP)).toBe(false);
    expect(isListParam(numberP)).toBe(false);
  });

  it('narrows a record param', () => {
    expect(hasKind(recordP)).toBe('record');
    expect(isRecordParam(recordP)).toBe(true);
    expect(isNumberParam(recordP)).toBe(false);
    if (isRecordParam(recordP)) expect(recordP.typeId).toBe('Casing');
  });

  it('narrows a list param and reads its element type', () => {
    expect(hasKind(listP)).toBe('list');
    expect(isListParam(listP)).toBe(true);
    if (isListParam(listP)) {
      expect((listP.of as { record: string }).record).toBe('Casing');
      expect(listP.default.length).toBe(2);
    }
  });

  it('supports a scalar list (the degenerate case)', () => {
    const p: ListParam = { kind: 'list', of: { scalar: true }, default: [1, 2, 3] };
    expect(isListParam(p)).toBe(true);
    expect(hasKind(p)).toBe('list');
  });
});

describe('hydrateParams — default-fill', () => {
  it('passes a number param through with the SAME object identity', () => {
    const raw = { od: numberP };
    const out = hydrateParams(raw);
    expect(out).toBe(raw);                 // identity preserved — no churn
    expect(out.od).toBe(numberP);
  });

  it('back-fills a record param that lost its default with {}', () => {
    const raw = { spec: { kind: 'record', typeId: 'Casing' } as unknown as ParamSchema };
    const out = hydrateParams(raw);
    expect(out.spec).not.toBe(raw.spec);   // mutated copy
    expect((out.spec as RecordParam).default).toEqual({});
    expect((out.spec as RecordParam).typeId).toBe('Casing');
  });

  it('back-fills a list param that lost its default with []', () => {
    const raw = { rows: { kind: 'list', of: { record: 'Casing' } } as unknown as ParamSchema };
    const out = hydrateParams(raw);
    expect((out.rows as ListParam).default).toEqual([]);
  });

  it('leaves a record/list param that HAS a default untouched', () => {
    const raw = { spec: recordP, rows: listP };
    const out = hydrateParams(raw);
    expect(out).toBe(raw);                 // nothing filled → identity preserved
  });

  it('undefined → {}', () => {
    expect(hydrateParams(undefined)).toEqual({});
  });
});

describe('emit — the field? branch on a param ArgValue', () => {
  it('emits p.<name> for a plain param arg (byte-identical)', () => {
    let g = newGraph();
    g = addParam(g, 'od', numberP);
    const { graph } = addCall(g, 'g_casing', { od: { kind: 'param', param: 'od' } });
    const body = emitGraph(graph, { id: 'w_x' }).body;
    expect(body).toContain('g_casing({ od: p.od })');
    expect(body).not.toContain('p.od.');
  });

  it('emits p.<name>.<field> for a record field access', () => {
    let g = newGraph();
    g = addParam(g, 'spec', recordP);
    const { graph } = addCall(g, 'g_casing', {
      od: { kind: 'param', param: 'spec', field: 'od' },
      wall: { kind: 'param', param: 'spec', field: 'wall' },
    });
    const body = emitGraph(graph, { id: 'w_x' }).body;
    expect(body).toContain('od: p.spec.od');
    expect(body).toContain('wall: p.spec.wall');
  });
});

describe('emit — STACK_REF_PARAM guard is number-only', () => {
  it('does NOT stamp _stackRef when a param named stack_ref is a record', () => {
    let g = newGraph();
    // A (contrived) record param that happens to be named stack_ref must not
    // crash / mis-fire the numeric stamp path.
    g = addParam(g, 'stack_ref', { kind: 'record', typeId: 'X', default: {} } as ParamSchema);
    const { graph } = addCall(g, 'g_casing', {});
    const body = emitGraph(graph, { id: 'w_x' }).body;
    expect(body).not.toContain('_stackRef');
  });
});

describe('public/private param flag — the interface subset', () => {
  it('absent `public` ⇒ PUBLIC (the byte-identical backward-compat default)', () => {
    // The golden invariant: every existing param (no `public` key) is public.
    expect(isPublicParam(numberP)).toBe(true);
    expect(isPublicParam({ default: 5 })).toBe(true);
    expect(isPublicParam(recordP)).toBe(true);
    expect(isPublicParam(listP)).toBe(true);
  });

  it('`public: true` is public; only `public: false` is private', () => {
    expect(isPublicParam({ default: 5, public: true })).toBe(true);
    expect(isPublicParam({ default: 5, public: false })).toBe(false);
  });

  it('a nullish schema is not public (dropped)', () => {
    expect(isPublicParam(null)).toBe(false);
    expect(isPublicParam(undefined)).toBe(false);
  });

  it('publicParamNames filters to the public subset, preserving order', () => {
    const params = {
      od:        { default: 9.625 },                    // absent ⇒ public
      length:    { default: 40, public: true },         // explicit public
      wall:      { default: 0.5, public: false },        // private
      collar_od: { default: 11, public: false },         // private
      depth:     { default: 100 },                       // absent ⇒ public
    };
    expect(publicParamNames(params)).toEqual(['od', 'length', 'depth']);
  });

  it('an all-default (no flags) params record is fully public', () => {
    const params = { od: { default: 1 }, wall: { default: 2 }, length: { default: 3 } };
    expect(publicParamNames(params)).toEqual(['od', 'wall', 'length']);
  });

  it('undefined / empty → []', () => {
    expect(publicParamNames(undefined)).toEqual([]);
    expect(publicParamNames({})).toEqual([]);
  });
});

describe('public flag — serialize + hydrate round-trip', () => {
  function partWithPrivateWall() {
    let g = newGraph();
    g = addParam(g, 'od', { default: 9.625 });
    g = addParam(g, 'wall', { default: 0.5 });
    g = setParamSchema(g, 'wall', { default: 0.5, public: false });
    return g;
  }

  it('emit serializes `public: false` into the meta.params text', () => {
    const { source } = emitGraph(partWithPrivateWall(), { id: 'w_x' });
    expect(source).toContain('public: false');
  });

  it('emit keeps the param object round-trippable (meta.params.wall.public)', () => {
    const { meta } = emitGraph(partWithPrivateWall(), { id: 'w_x' });
    expect((meta.params as any).wall.public).toBe(false);
    expect((meta.params as any).od.public).toBeUndefined();  // untouched param stays clean
  });

  it('hydrateParams passes the public flag through verbatim', () => {
    const raw = { od: { default: 1 }, wall: { default: 0.5, public: false } } as any;
    const out = hydrateParams(raw);
    expect((out.wall as any).public).toBe(false);
    expect((out.od as any).public).toBeUndefined();
  });

  it('full serialise → hydrateGraph round-trip preserves public:false', () => {
    const { meta } = emitGraph(partWithPrivateWall(), { id: 'w_x' });
    const g2 = hydrateGraph(meta.graph);
    expect((g2.params.wall as any).public).toBe(false);
    expect((g2.params.od as any).public).toBeUndefined();
  });

  it('a part with NO private params emits byte-identically (no `public` key)', () => {
    let g = newGraph();
    g = addParam(g, 'od', { default: 9.625 });
    const { source } = emitGraph(g, { id: 'w_x' });
    expect(source).not.toContain('public');
  });
});

describe('port-types — PT_LIST_GEOMETRY registered (Phase 1)', () => {
  it('is registered as list<geometry>', () => {
    expect(PT_LIST_GEOMETRY.id).toBe('list<geometry>');
    expect(PT_LIST_GEOMETRY.card).toBe('list');
    expect(PT_LIST_GEOMETRY.elem).toBe('geometry');
    expect(portType('list<geometry>')).toBe(PT_LIST_GEOMETRY);
  });

  it('a single geometry broadcasts into a list<geometry> slot', () => {
    expect(canWire('geometry', 'list<geometry>')).toBe(true);
  });
});
