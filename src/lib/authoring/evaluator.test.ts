import { describe, it, expect } from 'vitest';
import {
  evaluateDesignSpace,
  applyBindings,
  type EvalContext,
  type KbData,
} from './evaluator';
import type { DesignSpace } from './schema';

const noKbs = new Map<string, KbData>();

describe('evaluateDesignSpace — free vars', () => {
  it('returns the input value when supplied', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'size', label: 'Size', spec: { kind: 'free', type: 'number', default: 2.875 } },
      ],
      bindings: {},
    };
    const ctx: EvalContext = { kbs: noKbs, free: { size: 3.5 } };
    const { values, errors } = evaluateDesignSpace(spec, ctx);
    expect(errors).toEqual([]);
    expect(values.size).toBe(3.5);
  });

  it('falls back to default when not supplied', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'size', label: 'Size', spec: { kind: 'free', type: 'number', default: 2.875 } },
      ],
      bindings: {},
    };
    const ctx: EvalContext = { kbs: noKbs, free: {} };
    const { values } = evaluateDesignSpace(spec, ctx);
    expect(values.size).toBe(2.875);
  });
});

describe('evaluateDesignSpace — ref', () => {
  it('mirrors another variable value', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'a', label: 'A', spec: { kind: 'free', type: 'number', default: 10 } },
        { id: 'b', label: 'B', spec: { kind: 'derived', source: 'ref', var: 'a' } },
      ],
      bindings: {},
    };
    const { values, errors } = evaluateDesignSpace(spec, { kbs: noKbs, free: { a: 5 } });
    expect(errors).toEqual([]);
    expect(values.b).toBe(5);
  });
});

describe('evaluateDesignSpace — kb-lookup', () => {
  const tubingKb: KbData = {
    rows: [
      { size_in: 2.875, grade: 'J-55', od_in: 2.875, drift_in: 2.347 },
      { size_in: 2.875, grade: 'L-80', od_in: 2.875, drift_in: 2.347 },
      { size_in: 3.5,   grade: 'J-55', od_in: 3.5,   drift_in: 2.992 },
    ],
  };
  const kbs = new Map([['tubing', tubingKb]]);

  it('resolves to the first matching row column', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'size',  label: 'Size',  spec: { kind: 'free', type: 'number', default: 2.875 } },
        { id: 'grade', label: 'Grade', spec: { kind: 'free', type: 'enum', default: 'J-55', options: ['J-55', 'L-80'] } },
        {
          id: 'od', label: 'OD',
          spec: { kind: 'derived', source: 'kb-lookup', kb: 'tubing', lookup: { size_in: 'size', grade: 'grade' }, column: 'od_in' },
        },
      ],
      bindings: {},
    };
    const { values, errors } = evaluateDesignSpace(spec, { kbs, free: { size: 3.5, grade: 'J-55' } });
    expect(errors).toEqual([]);
    expect(values.od).toBe(3.5);
  });

  it('uses fallback when no row matches', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'size', label: 'Size', spec: { kind: 'free', type: 'number', default: 99 } },
        {
          id: 'od', label: 'OD',
          spec: { kind: 'derived', source: 'kb-lookup', kb: 'tubing', lookup: { size_in: 'size' }, column: 'od_in', fallback: -1 },
        },
      ],
      bindings: {},
    };
    const { values, errors } = evaluateDesignSpace(spec, { kbs, free: {} });
    expect(errors).toEqual([]);
    expect(values.od).toBe(-1);
  });

  it('reports an error when no row matches and no fallback', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'size', label: 'Size', spec: { kind: 'free', type: 'number', default: 99 } },
        {
          id: 'od', label: 'OD',
          spec: { kind: 'derived', source: 'kb-lookup', kb: 'tubing', lookup: { size_in: 'size' }, column: 'od_in' },
        },
      ],
      bindings: {},
    };
    const { values, errors } = evaluateDesignSpace(spec, { kbs, free: {} });
    expect(values.od).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].var_id).toBe('od');
  });

  it('reports an error when the KB is not loaded', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'size', label: 'Size', spec: { kind: 'free', type: 'number', default: 2.875 } },
        {
          id: 'od', label: 'OD',
          spec: { kind: 'derived', source: 'kb-lookup', kb: 'missing-kb', lookup: { size_in: 'size' }, column: 'od_in' },
        },
      ],
      bindings: {},
    };
    const { errors } = evaluateDesignSpace(spec, { kbs: noKbs, free: { size: 2.875 } });
    expect(errors.some((e) => /not loaded/.test(e.message))).toBe(true);
  });
});

describe('evaluateDesignSpace — error handling', () => {
  it('detects cycles', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'a', label: 'A', spec: { kind: 'derived', source: 'ref', var: 'b' } },
        { id: 'b', label: 'B', spec: { kind: 'derived', source: 'ref', var: 'a' } },
      ],
      bindings: {},
    };
    const { errors } = evaluateDesignSpace(spec, { kbs: noKbs, free: {} });
    expect(errors.some((e) => /cycl/i.test(e.message))).toBe(true);
  });

  it('reports unknown variable refs', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'a', label: 'A', spec: { kind: 'derived', source: 'ref', var: 'missing' } },
      ],
      bindings: {},
    };
    const { errors } = evaluateDesignSpace(spec, { kbs: noKbs, free: {} });
    expect(errors.some((e) => /unknown/.test(e.message))).toBe(true);
  });

  it('stubs formula source for now', () => {
    const spec: DesignSpace = {
      variables: [
        { id: 'a', label: 'A', spec: { kind: 'free', type: 'number', default: 2 } },
        { id: 'b', label: 'B', spec: { kind: 'derived', source: 'formula', expr: 'a * 2' } },
      ],
      bindings: {},
    };
    const { values, errors } = evaluateDesignSpace(spec, { kbs: noKbs, free: { a: 5 } });
    expect(values.b).toBeNull();
    expect(errors.some((e) => /formula/.test(e.message))).toBe(true);
  });
});

describe('applyBindings', () => {
  it('substitutes bound params with resolved values', () => {
    const result = applyBindings(
      'p0',
      { tubing_od: 1, length: 2 },
      { 'p0.tubing_od': 'od_var', 'p0.length': 'len_var', 'p1.foo': 'other' },
      { od_var: 2.875, len_var: 30, other: 5 },
    );
    expect(result.tubing_od).toBe(2.875);
    expect(result.length).toBe(30);
  });

  it('passes through unbound params', () => {
    const result = applyBindings('p0', { a: 1, b: 2 }, {}, {});
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('ignores non-numeric resolved values', () => {
    const result = applyBindings(
      'p0',
      { x: 1 },
      { 'p0.x': 'string_var' },
      { string_var: 'L-80' },
    );
    expect(result.x).toBe(1);  // unchanged because resolved value isn't numeric
  });
});
