import { describe, it, expect } from 'vitest';
import { primIdFromFile, profileIdFromFile } from '../primitive-paths';
import { composeProfileModule, splitProfileModule, profileExt, buildProfileFromSource } from '../profile-fn';

describe('primitive-paths file-name parsing', () => {
  it('parses new-scheme primitive file names', () => {
    expect(primIdFromFile('r_ball.prim.ts')).toEqual({ id: 'r_ball', kind: 'prim' });
    expect(primIdFromFile('dp_pin.asm.ts')).toEqual({ id: 'dp_pin', kind: 'asm' });
    expect(primIdFromFile('source.ts')).toBeNull();
    expect(primIdFromFile('r_ball/source.ts')).toBeNull();
    expect(primIdFromFile('notes.md')).toBeNull();
  });

  it('parses new-scheme profile file names', () => {
    expect(profileIdFromFile('barrel.prvl.ts')).toEqual({ id: 'barrel', ext: 'prvl' });
    expect(profileIdFromFile('slot.prex.ts')).toEqual({ id: 'slot', ext: 'prex' });
    expect(profileIdFromFile('barrel.prim.ts')).toBeNull();
    expect(profileIdFromFile('profile.json')).toBeNull();
  });

  it('maps axis set → mid-extension', () => {
    expect(profileExt('revolve')).toBe('prvl');
    expect(profileExt('cartesian')).toBe('prex');
    expect(profileExt('weird')).toBe('prvl'); // default revolve
  });
});

describe('profile module compose/split round-trip', () => {
  const meta = {
    id: 'drill_pipe_pin',
    label: 'Drill-pipe Pin (male)',
    description: 'revolve half-section (r, z)',
    set: 'revolve' as const,
    tags: ['drill pipe', 'pin'],
    params: {
      bore: { label: 'bore ID', min: 0.5, max: 16, step: 0.1, default: 2.75, unit: 'in' },
      wall: { label: 'pipe wall t', min: 0.1, max: 4, step: 0.05, default: 0.5, unit: 'in' },
    },
  };
  const buildSource = `export function build(p) {
  const ri = p.bore / 2;
  const ro = ri + p.wall;
  return pen().mv(ri, 0).line(ro, 0).line(ro, 4).line(ri, 4).pts();
}`;

  it('composes a module whose mid-ext matches the axis', () => {
    const mod = composeProfileModule(meta, buildSource);
    expect(mod).toContain('export const meta =');
    expect(mod).toContain('export function build(p)');
    expect(mod).toContain('drill_pipe_pin.prvl.ts'); // header carries the kind
  });

  it('round-trips meta + build through compose → split', () => {
    const mod = composeProfileModule(meta, buildSource);
    const { meta: back, buildSource: bs } = splitProfileModule(mod);
    expect(back.id).toBe('drill_pipe_pin');
    expect(back.set).toBe('revolve');
    expect(back.params.bore.default).toBe(2.75);
    expect(bs).toContain('export function build(p)');
    expect(bs).not.toContain('export const meta'); // meta stripped from build source
  });

  it('the composed module still resolves to points (build runs with meta present)', () => {
    const mod = composeProfileModule(meta, buildSource);
    const pts = buildProfileFromSource(mod, { bore: 2.75, wall: 0.5 });
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(pts[0]).toHaveLength(2);
  });
});
