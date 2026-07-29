import { describe, it, expect } from 'vitest';
import { resolveArgs } from './refs';
import { validateManifest } from './validate';

describe('appkit manifest refs (rung 2)', () => {
  it('resolves $active / $params / $item / $item.field', () => {
    const scope = { active: 'w1', params: { td: 3000 }, item: { id: 'w2', title: 'Well 2' } };
    expect(resolveArgs({ id: '$active' }, scope)).toEqual({ id: 'w1' });
    expect(resolveArgs({ p: '$params' }, scope)).toEqual({ p: { td: 3000 } });
    expect(resolveArgs({ row: '$item' }, scope)).toEqual({ row: { id: 'w2', title: 'Well 2' } });
    expect(resolveArgs({ id: '$item.id' }, scope)).toEqual({ id: 'w2' });
    expect(resolveArgs({ lit: 42, keep: '$nope' }, scope)).toEqual({ lit: 42, keep: '$nope' });
  });
  it('validates a manifest', () => {
    expect(validateManifest({ app: 'x', panels: [{ id: 'a', kind: 'list' }] }).ok).toBe(true);
    const bad = validateManifest({ panels: [{ kind: 'list' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/missing "app"|missing "id"/);
  });
});
