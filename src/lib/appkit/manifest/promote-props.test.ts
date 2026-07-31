import { describe, it, expect } from 'vitest';
import type { AppManifest, Panel } from './types';
import { promoteComponentProps, promoteTree, isStoreRef, storeRefPath, setVarByPath } from './promote-props';

const app = (over: Partial<AppManifest> = {}): AppManifest => ({ app: 'x', panels: [], ...over });

describe('promoteComponentProps', () => {
  it('seeds vars.<id> from meta defaults + infers structures.<id> + binds props to $vars refs', () => {
    const a = app();
    const p: Panel = { id: 'h1', kind: 'heading' }; // heading meta: text (default "Heading"), level (default "2")
    promoteComponentProps(a, p);
    expect(a.vars?.h1).toEqual({ text: 'Heading', level: '2' });
    expect(a.structures?.h1).toEqual([
      { name: 'text', type: 'string' },
      { name: 'level', type: 'string' }, // 'select' → string
    ]);
    expect(p.props).toEqual({ text: '$vars.h1.text', level: '$vars.h1.level' });
  });

  it('a supplied literal prop becomes the seed value (not the meta default)', () => {
    const a = app();
    const p: Panel = { id: 'h2', kind: 'heading', props: { text: 'Roadmap' } };
    promoteComponentProps(a, p);
    expect(a.vars?.h2).toMatchObject({ text: 'Roadmap' });
    expect(p.props!.text).toBe('$vars.h2.text');
  });

  it('respects an explicit cross-component $vars binding (never clobbers it)', () => {
    const a = app({ vars: { shared: { title: 'X' } } });
    const p: Panel = { id: 'h3', kind: 'heading', props: { text: '$vars.shared.title' } };
    promoteComponentProps(a, p);
    expect(p.props!.text).toBe('$vars.shared.title'); // left as-is
    // its own store still carries the OTHER prop (level)
    expect(a.vars?.h3).toHaveProperty('level');
    expect(a.vars?.h3).not.toHaveProperty('text');
  });

  it('is idempotent + preserves an edited store value across re-promotion', () => {
    const a = app();
    const p: Panel = { id: 'h4', kind: 'heading' };
    promoteComponentProps(a, p);
    (a.vars!.h4 as Record<string, unknown>).text = 'Edited';
    promoteComponentProps(a, p); // re-run
    expect((a.vars!.h4 as Record<string, unknown>).text).toBe('Edited'); // not reset to default
    expect(p.props!.text).toBe('$vars.h4.text');
  });

  it('no-op for an unknown kind (no meta → no props)', () => {
    const a = app();
    const p: Panel = { id: 'd1', kind: 'no_such_kind_xyz' };
    promoteComponentProps(a, p);
    expect(a.vars?.d1).toBeUndefined();
    expect(a.structures?.d1).toBeUndefined();
  });

  it('opt-out with app.autoPromoteProps === false', () => {
    const a = app({ autoPromoteProps: false } as Partial<AppManifest>);
    const p: Panel = { id: 'h5', kind: 'heading', props: { text: 'lit' } };
    promoteComponentProps(a, p);
    expect(a.vars?.h5).toBeUndefined();
    expect(p.props!.text).toBe('lit'); // untouched
  });

  it('promoteTree recurses into children', () => {
    const a = app();
    const root: Panel = { id: 'card', kind: 'container', children: [{ id: 'ct', kind: 'text' }] };
    promoteTree(a, root);
    expect(a.vars?.ct).toBeDefined(); // child text promoted
  });
});

describe('store-ref helpers', () => {
  it('isStoreRef / storeRefPath', () => {
    expect(isStoreRef('$vars.h1.text')).toBe(true);
    expect(isStoreRef('literal')).toBe(false);
    expect(storeRefPath('$vars.h1.text')).toBe('h1.text');
    expect(storeRefPath('nope')).toBeNull();
  });

  it('setVarByPath writes a nested var, creating objects', () => {
    const a = app();
    setVarByPath(a, 'h1.text', 'Hello');
    expect(a.vars).toEqual({ h1: { text: 'Hello' } });
    setVarByPath(a, 'h1.level', 3);
    expect(a.vars!.h1).toEqual({ text: 'Hello', level: 3 });
  });
});
