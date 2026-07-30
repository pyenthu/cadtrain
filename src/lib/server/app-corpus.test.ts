import { describe, it, expect } from 'vitest';
import { rankBuilds, rankGolden, renderGrounding, compactApp, isCleanBuild, type BuildRecord, type GoldenPair } from './app-corpus';

const rec = (prompt: string, panels: Array<{ id: string; kind: string }>): BuildRecord => ({
  ts: 0, prompt, steps: panels.length, app: { app: 'x', panels },
});

describe('app-corpus hygiene gate (isCleanBuild — wrong/incomplete builds never teach)', () => {
  const mk = (over: Partial<BuildRecord>): BuildRecord => ({ ts: 0, prompt: 'p', steps: 1, app: { app: 'x', panels: [] }, ...over });
  it('keeps a build that did real, non-broken work', () => {
    expect(isCleanBuild(mk({ steps: 2, trace: [{ verb: 'definePanel', args: {}, ok: true }] }))).toBe(true);
  });
  it('keeps a legacy build (no trace) with steps > 0', () => {
    expect(isCleanBuild(mk({ steps: 3 }))).toBe(true);
  });
  it('drops a build that did nothing (steps 0 / unparseable emit)', () => {
    expect(isCleanBuild(mk({ steps: 0 }))).toBe(false);
  });
  it('drops a build whose every verb failed', () => {
    expect(isCleanBuild(mk({ steps: 1, trace: [{ verb: 'setComponentProp', args: {}, ok: false, error: 'no panel' }] }))).toBe(false);
  });
  it('keeps a recovered build (a failed verb but at least one success)', () => {
    expect(
      isCleanBuild(mk({ steps: 2, trace: [{ verb: 'a', args: {}, ok: false, error: 'x' }, { verb: 'b', args: {}, ok: true }] })),
    ).toBe(true);
  });
});

describe('app-corpus (rung 4a.2 learning loop)', () => {
  const corpus = [
    rec('build a wells app with a casings table', [{ id: 'list', kind: 'list' }, { id: 'params', kind: 'form' }]),
    rec('a hello world text panel', [{ id: 'greeting', kind: 'text' }]),
    rec('wells designer with 3d view', [{ id: 'view', kind: 'bake3d' }]),
  ];

  it('ranks past builds by prompt overlap', () => {
    const hits = rankBuilds('build a wells casings app', corpus, 2);
    expect(hits.length).toBe(2);
    expect(hits[0].prompt).toMatch(/wells/); // the closest wells build ranks first
    expect(rankBuilds('nothing in common zzz', corpus)).toHaveLength(0);
  });

  it('renders grounding as few-shot lines', () => {
    const g = renderGrounding(rankBuilds('wells app', corpus, 2));
    expect(g).toContain('Similar past builds');
    expect(g).toMatch(/kind.*list|kind.*bake3d/);
    expect(renderGrounding([])).toBe('');
  });

  const golden: GoldenPair[] = [
    { name: 'well-designer', md: '# Well designer\nA casings table + a 3D bake of the well.', app: { app: 'w', panels: [{ id: 't', kind: 'table' }, { id: 'v', kind: 'bake3d' }], files: [{ slot: 'well', type: '.wson' }] } },
    { name: 'hello', md: '# Hello\nA simple greeting.', app: { app: 'h', panels: [{ id: 'g', kind: 'text' }] } },
  ];

  it('ranks curated golden pairs by MD description', () => {
    const hits = rankGolden('a well casings designer', golden, 2);
    expect(hits[0].name).toBe('well-designer');
    expect(rankGolden('zzz none', golden)).toHaveLength(0);
  });

  it('compactApp keeps kinds/files/nesting, drops bulk', () => {
    const c = compactApp(golden[0].app) as any;
    expect(c.panels.map((p: any) => p.kind)).toEqual(['table', 'bake3d']);
    expect(c.files).toBeDefined();
  });

  it('grounding renders golden BEFORE builds', () => {
    const g = renderGrounding(rankBuilds('wells app', corpus, 1), rankGolden('well casings', golden, 1));
    expect(g).toContain('Curated examples');
    expect(g.indexOf('Curated examples')).toBeLessThan(g.indexOf('Similar past builds'));
  });
});
