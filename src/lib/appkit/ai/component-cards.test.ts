// #37 — the builder's component knowledge is GENERATED from the catalog metas (SSOT), not
// hand-written. These prove a card carries the exact prop knowledge the old hardcoded rules did.
import { describe, it, expect } from 'vitest';
import { componentCard, componentIndex, relevantKinds, renderComponentKnowledge, collectKinds } from './component-cards';
import { COMPONENT_CATALOG, getComponentMeta } from '../catalog/components';

describe('component-cards (#37 — knowledge from meta SSOT)', () => {
  it('componentCard renders props straight from the meta (text → color, the red-text knowledge)', () => {
    const card = componentCard(getComponentMeta('text')!);
    expect(card).toContain('text (display)');
    expect(card).toContain('color:color');
    expect(card).toContain('size:select(');
  });

  it('heading card carries level; a child-holder is marked HOLDS children', () => {
    expect(componentCard(getComponentMeta('heading')!)).toContain('level:select(1|2|3)');
    const holder = COMPONENT_CATALOG.find((m) => m.acceptsChildren)!;
    expect(componentCard(holder)).toContain('HOLDS children');
  });

  it('index lists every kind grouped', () => {
    const idx = componentIndex();
    expect(idx).toContain('display:');
    expect(idx).toContain('text');
  });

  it('relevantKinds picks core + app kinds + prompt-mentioned kinds', () => {
    const rel = relevantKinds('make the vtoolbar pink', ['tabs']);
    expect(rel.has('text')).toBe(true); // core
    expect(rel.has('tabs')).toBe(true); // already in the app
    expect(rel.has('vtoolbar')).toBe(true); // named in the prompt
  });

  it('renderComponentKnowledge = the index + full cards for the relevant kinds only', () => {
    const k = renderComponentKnowledge('turn the text red', []);
    expect(k).toContain('Component kinds —');
    expect(k).toContain('color:color'); // text is core → expanded
  });

  it('collectKinds walks nested children', () => {
    expect(collectKinds([{ kind: 'card', children: [{ kind: 'text' }] }])).toEqual(['card', 'text']);
  });
});
