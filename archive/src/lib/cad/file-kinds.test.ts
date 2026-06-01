import { describe, it, expect } from 'vitest';
import { kindOf, editorFor, apiFor, axisFor, isProfileKind, labelFor, type FileKind } from './file-kinds';

describe('file-kinds taxonomy', () => {
  it('reads the mid-extension when present', () => {
    expect(kindOf('primitives/profiles/drill_pipe_box.prvl.ts')).toBe('prvl');
    expect(kindOf('primitives/profiles/slot.prex.ts')).toBe('prex');
    expect(kindOf('primitives/basic/r_cylinder.prim.ts')).toBe('prim');
    expect(kindOf('primitives/completions/drill_pipe/dp_pin.asm.ts')).toBe('asm');
    expect(kindOf('FOO.PRVL.TS')).toBe('prvl'); // case-insensitive
  });

  it('bridges the legacy folder layout (pre-migration)', () => {
    expect(kindOf('primitives/profiles/casing_coupling/source.ts')).toBe('prvl'); // under profiles/ → profile
    expect(kindOf('primitives/basic/r_cube/source.ts')).toBe('prim');             // else → primitive leaf
    expect(kindOf('primitives/completions/drill_pipe/dp_pin_test/source.ts')).toBe('prim');
  });

  it('returns null for non-entity paths', () => {
    expect(kindOf('primitives/profiles/casing_coupling/profile.json')).toBeNull();
    expect(kindOf('archive/figures/gallery.json')).toBeNull();
    expect(kindOf('readme.md')).toBeNull();
  });

  it('routes each kind to the right editor + API + axis', () => {
    const cases: [FileKind, string, string, string | null][] = [
      ['prvl', 'profile', 'resolve', 'revolve'],
      ['prex', 'profile', 'resolve', 'cartesian'],
      ['prim', 'primitive', 'bake', null],
      ['asm', 'primitive', 'bake', null],
    ];
    for (const [k, ed, api, axis] of cases) {
      expect(editorFor(k)).toBe(ed);
      expect(apiFor(k)).toBe(api);
      expect(axisFor(k)).toBe(axis);
    }
  });

  it('isProfileKind + labels', () => {
    expect(isProfileKind('prvl')).toBe(true);
    expect(isProfileKind('prex')).toBe(true);
    expect(isProfileKind('prim')).toBe(false);
    expect(isProfileKind('asm')).toBe(false);
    expect(labelFor('asm')).toBe('assembly');
  });
});
