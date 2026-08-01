// Proves scoreApp measures STRUCTURAL reproduction of a golden .app: identity = 1.0, a degraded
// variant scores lower, missing panels are penalized — and (the load-bearing property) the score
// is INVARIANT under prop-promotion, so a faithfully-rebuilt-then-promoted app still matches its
// literal golden.
import { describe, it, expect } from 'vitest';
import {
  scoreApp,
  preorderKinds,
  nestingEdges,
  dataVarNames,
  dataStructureNames,
  seqSimilarity,
  f1Multiset,
  type AppLike,
} from './score-app';

// A representative golden: a heading + subtitle + a tabs panel holding two nested nodetrees, with
// seeded data vars + record structures + a theme + meta (mirrors design.app's shape).
const golden: AppLike = {
  app: 'design',
  title: 'CAD Train — Architecture',
  docType: 'design',
  theme: { mode: 'light', accent: '#475569' },
  structures: { archNode: [{ name: 'id' }], archEdge: [{ name: 'source' }] },
  vars: { nodes: [{ id: 'a' }], edges: [{ source: 'a' }], c4nodes: [], c4edges: [] },
  panels: [
    { id: 'title', kind: 'heading', props: { text: 'CAD Train — Architecture', level: 1 } },
    { id: 'subtitle', kind: 'text', props: { text: 'x', muted: true } },
    {
      id: 'views',
      kind: 'tabs',
      props: { labels: ['Tree', 'C4'] },
      children: [
        { id: 'tree', kind: 'nodetree', props: { nodesVar: 'nodes', edgesVar: 'edges' } },
        { id: 'c4', kind: 'nodetree', props: { nodesVar: 'c4nodes', edgesVar: 'c4edges' } },
      ],
    },
  ],
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('score-app facet extractors', () => {
  it('preorderKinds walks top-level then children depth-first', () => {
    expect(preorderKinds(golden)).toEqual(['heading', 'text', 'tabs', 'nodetree', 'nodetree']);
  });
  it('nestingEdges encodes parent→child (ROOT for top level)', () => {
    expect(nestingEdges(golden)).toEqual([
      'ROOT>heading',
      'ROOT>text',
      'ROOT>tabs',
      'tabs>nodetree',
      'tabs>nodetree',
    ]);
  });
  it('dataVarNames / dataStructureNames keep seeded data, drop panel-id (promoted) keys', () => {
    const promoted = clone(golden);
    // promotion adds vars/structures keyed by PANEL id — must be ignored by the data* extractors
    promoted.vars = { ...promoted.vars, title: { text: 'x', level: 1 }, subtitle: { text: 'x' } };
    promoted.structures = { ...promoted.structures, title: [{ name: 'text' }], views: [{ name: 'labels' }] };
    expect(dataVarNames(promoted).sort()).toEqual(['c4edges', 'c4nodes', 'edges', 'nodes']);
    expect(dataStructureNames(promoted).sort()).toEqual(['archEdge', 'archNode']);
  });
});

describe('similarity primitives', () => {
  it('seqSimilarity: identical = 1, both-empty = 1, order matters', () => {
    expect(seqSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(seqSimilarity([], [])).toBe(1);
    expect(seqSimilarity(['a', 'b'], ['b', 'a'])).toBeLessThan(1);
    expect(seqSimilarity(['a', 'b', 'c'], ['a', 'b'])).toBeCloseTo((2 * 2) / 5, 6);
  });
  it('f1Multiset: identical = 1, both-empty = 1, missing lowers, extra lowers', () => {
    expect(f1Multiset(['x', 'y'], ['x', 'y'])).toBe(1);
    expect(f1Multiset([], [])).toBe(1);
    expect(f1Multiset(['x'], ['x', 'y'])).toBeLessThan(1); // missing one
    expect(f1Multiset(['x', 'y', 'z'], ['x'])).toBeLessThan(1); // two extras
  });
});

describe('scoreApp', () => {
  it('golden vs itself = 1.0', () => {
    const r = scoreApp(clone(golden), golden);
    expect(r.score).toBe(1);
    for (const v of Object.values(r.breakdown)) expect(v).toBe(1);
  });

  it('is INVARIANT under prop-promotion (rebuilt-then-promoted app still scores 1.0)', () => {
    // Simulate what definePanel/promoteComponentProps does: rewrite literal props to $vars refs and
    // add panel-id-keyed vars + structures. Structure (kinds/nesting/theme/data-vars) is unchanged.
    const promoted = clone(golden);
    const promote = (p: any) => {
      if (p.props) {
        const store: Record<string, unknown> = {};
        for (const k of Object.keys(p.props)) {
          store[k] = p.props[k];
          p.props[k] = `$vars.${p.id}.${k}`;
        }
        (promoted.vars as any)[p.id] = store;
        (promoted.structures as any)[p.id] = Object.keys(store).map((n) => ({ name: n }));
      }
      for (const c of p.children ?? []) promote(c);
    };
    for (const p of promoted.panels!) promote(p);
    expect(scoreApp(promoted, golden).score).toBe(1);
  });

  it('a degraded variant scores lower (dropped panel + wrong accent)', () => {
    const degraded = clone(golden);
    degraded.panels = degraded.panels!.slice(0, 2); // drop the tabs subtree entirely
    degraded.theme = { mode: 'light', accent: '#ff0000' }; // wrong accent
    const r = scoreApp(degraded, golden);
    expect(r.score).toBeLessThan(1);
    expect(r.score).toBeGreaterThan(0);
    expect(r.breakdown.panelKinds).toBeLessThan(1); // fewer panels
    expect(r.breakdown.nesting).toBeLessThan(1); // lost tabs>nodetree edges
    expect(r.breakdown.theme).toBeLessThan(1); // accent mismatch
  });

  it('missing panels are penalized more than a single prop tweak', () => {
    const missingOne = clone(golden);
    missingOne.panels!.pop(); // remove the tabs (+ its 2 children)
    const missingHalf = scoreApp(missingOne, golden).score;
    expect(missingHalf).toBeLessThan(1);

    // reordering the two nested children keeps the same kinds but changes order → panelKinds still
    // 1 (both nodetree), but a re-KINDED swap lowers it
    const swapKind = clone(golden);
    (swapKind.panels![2] as any).children[0].kind = 'text';
    expect(scoreApp(swapKind, golden).breakdown.panelKinds).toBeLessThan(1);
  });

  it('an unrelated app scores low', () => {
    const other: AppLike = {
      app: 'x',
      title: 'Something else',
      docType: 'other',
      panels: [{ id: 'a', kind: 'bake3d' }, { id: 'b', kind: 'chat' }],
      vars: { unrelated: [] },
    };
    expect(scoreApp(other, golden).score).toBeLessThan(0.35);
  });
});
