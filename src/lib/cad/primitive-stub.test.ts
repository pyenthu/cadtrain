import { describe, it, expect } from 'vitest';
import {
  stubSource,
  buildPartStubFromBase,
  buildRevolveStubFromProfile,
  metaParamEntry,
  type StubParam,
} from './primitive-stub';
// The SAME validator /api/primitives/save runs — esbuild-transpiles the meta
// literal then evals it. A generated stub that throws here is exactly the 400
// ("source missing valid meta") the user hit. So "extractMetaFromSource doesn't
// throw + returns the params" is the precise regression assertion.
import { extractMetaFromSource } from '../server/primitives-meta';

/** Assert a generated source passes the save endpoint's meta validation and
 *  return the parsed params for further checks. */
function validate(source: string | null): Record<string, any> {
  expect(source, 'generator returned null').toBeTruthy();
  const meta = extractMetaFromSource(source as string);
  return meta.params ?? {};
}

// Representative param shapes a real base can expose. The POLYGON one (array
// default) is the shape that used to be emitted as `default: 0,0,1,0` (no
// brackets) → invalid object literal → save 400.
const NUMBER: StubParam = { label: 'length', min: 0.1, max: 40, step: 0.1, default: 4, unit: 'in' };
const POLYGON: StubParam = {
  label: 'profile (r,z)', type: 'polygon', yDown: true, hLabel: 'r →', vLabel: 'z ↓',
  default: [[0, 4], [1.6, 4], [1.6, 0], [0, 0]],
};
const ENUM: StubParam = { label: 'mode', type: 'enum', options: ['a', 'b', 'c'], default: 1 };
const BOOL: StubParam = { label: 'capped', type: 'boolean', default: 1 };
const TRICKY_LABEL: StubParam = { label: "O'Brien's bore, \"big\"", min: 0, max: 10, step: 1, default: 2 };

describe('primitive-stub generators produce save-valid source', () => {
  it('stubSource (default cylinder) is valid', () => {
    const params = validate(stubSource('foo_part'));
    expect(Object.keys(params)).toEqual(['od', 'length']);
  });

  it('buildPartStubFromBase with number params is valid', () => {
    const params = validate(buildPartStubFromBase('foo_part', 'r_cylinder', { length: NUMBER, segs: { default: 64 } }));
    expect(params.length.default).toBe(4);
    expect(params.length.unit).toBe('in');
  });

  it('REGRESSION: polygon param (array default) is valid + bracketed', () => {
    const src = buildPartStubFromBase('rev_part', 'r_revolve', { profile: POLYGON, segments: { default: 96 } });
    // The array default must be serialized WITH brackets, not `default: 0,4,1.6,…`.
    expect(src).toContain('default: [[0,4],[1.6,4]');
    expect(src).toContain(`type: 'polygon'`);
    const params = validate(src);
    expect(params.profile.type).toBe('polygon');
    expect(params.profile.default).toEqual(POLYGON.default);
    expect(params.profile.yDown).toBe(true);
    expect(params.segments.default).toBe(96);
  });

  it('enum + boolean params are valid', () => {
    const params = validate(buildPartStubFromBase('mix_part', 'r_cube', { mode: ENUM, capped: BOOL }));
    expect(params.mode.type).toBe('enum');
    expect(params.mode.options).toEqual(['a', 'b', 'c']);
    expect(params.capped.type).toBe('boolean');
  });

  it('labels with quotes do not break the literal', () => {
    const params = validate(buildPartStubFromBase('q_part', 'r_tube', { bore: TRICKY_LABEL }));
    expect(params.bore.label).toBe("O'Brien's bore, \"big\"");
  });

  it('buildRevolveStubFromProfile is valid + function-first (resolveProfile)', () => {
    const src = buildRevolveStubFromProfile('dp_x', 'drill_pipe_pin', {
      bore: { label: 'bore', min: 0.5, max: 16, step: 0.1, default: 2.75, unit: 'in' },
      wall: { label: 'wall', min: 0.1, max: 4, step: 0.05, default: 0.5, unit: 'in' },
    });
    expect(src).toContain(`resolveProfile({ kind: 'drill_pipe_pin'`);
    expect(src).toContain('r_revolve(profile, 96)');
    expect(src).not.toContain(`type: 'polygon'`); // function-first → no raw vertices
    const params = validate(src);
    expect(Object.keys(params)).toEqual(['bore', 'wall']);
  });

  it('empty params → null (caller falls back to stubSource)', () => {
    expect(buildPartStubFromBase('x', 'r_cylinder', {})).toBeNull();
    expect(buildRevolveStubFromProfile('x', 'cylinder', {})).toBeNull();
  });

  it('metaParamEntry never emits an unbracketed array', () => {
    const entry = metaParamEntry('p', POLYGON);
    // a bare comma list like `default: 0,4,` would be the bug
    expect(entry).not.toMatch(/default:\s*-?\d+\s*,\s*-?\d+\s*[,}]/);
    expect(entry).toContain('[[0,4]');
  });
});
