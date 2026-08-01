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

// The DICTIONARY layer (the small-model fix): every component's card must carry a useWhen +
// a concrete example, AND the prompt-token retrieval must surface the RIGHT card for its synonyms
// — so a local model (Qwen2.5-1.5B) reaches for gantt/nodetree/wellschematic, not generic text/list.
describe('component dictionary (useWhen + example + synonym retrieval, end-to-end)', () => {
  it('EVERY catalog meta carries a useWhen + an example whose kind matches (except pure atoms)', () => {
    // Every component we expect the model to reach for should be self-describing.
    for (const m of COMPONENT_CATALOG) {
      expect(m.useWhen, `${m.kind} missing useWhen`).toBeTruthy();
      expect(m.example, `${m.kind} missing example`).toBeTruthy();
      expect((m.example as { kind?: string }).kind, `${m.kind} example.kind mismatch`).toBe(m.kind);
      expect((m.example as { id?: string }).id, `${m.kind} example missing id`).toBeTruthy();
    }
  });

  it('componentCard renders description + useWhen + the concrete example', () => {
    const card = componentCard(getComponentMeta('gantt')!);
    expect(card).toContain('gantt (display)');
    expect(card).toContain('timeline of bars'); // the useWhen sentence is inlined after the description
    expect(card).toContain('e.g. {'); // the example is serialized
    expect(card).toContain('"rowsVar":"tasks"');
  });

  // prompt → the card that MUST surface, proving synonym tags drive retrieval + the card is enriched.
  const cases: Array<{ prompt: string; kind: string; useWhenFrag: string; exampleFrag: string }> = [
    { prompt: 'add a gantt timeline reading tasks', kind: 'gantt', useWhenFrag: 'timeline of bars', exampleFrag: '"kind":"gantt"' },
    { prompt: 'draw an architecture graph of the system', kind: 'nodetree', useWhenFrag: 'nodes+edges graph', exampleFrag: '"kind":"nodetree"' },
    { prompt: 'show a well schematic of the casing', kind: 'wellschematic', useWhenFrag: 'well cross-section', exampleFrag: '"kind":"wellschematic"' },
    { prompt: 'render a table of results', kind: 'grid', useWhenFrag: 'read-only table', exampleFrag: '"kind":"grid"' },
    { prompt: 'a roadmap of the project schedule', kind: 'gantt', useWhenFrag: 'timeline of bars', exampleFrag: '"kind":"gantt"' },
    { prompt: 'an org chart of the team', kind: 'nodetree', useWhenFrag: 'nodes+edges graph', exampleFrag: '"kind":"nodetree"' },
    { prompt: 'a downhole completion diagram', kind: 'wellschematic', useWhenFrag: 'well cross-section', exampleFrag: '"kind":"wellschematic"' },
  ];
  for (const c of cases) {
    it(`"${c.prompt}" → renderComponentKnowledge surfaces the ${c.kind} card with useWhen + example`, () => {
      const rel = relevantKinds(c.prompt, []);
      expect(rel.has(c.kind), `${c.kind} not retrieved for "${c.prompt}"`).toBe(true);
      const k = renderComponentKnowledge(c.prompt, []);
      expect(k).toContain(`${c.kind} (`);
      expect(k).toContain(c.useWhenFrag);
      expect(k).toContain(c.exampleFrag);
    });
  }
});
