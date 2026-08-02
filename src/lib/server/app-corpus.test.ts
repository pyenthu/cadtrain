import { describe, it, expect } from 'vitest';
import { rankBuilds, rankGolden, renderGrounding, compactApp, isCleanBuild, rankPromotionCandidates, docTypeOf, decomposeToAtomicGoldens, type BuildRecord, type GoldenPair } from './app-corpus';
import { matchTemplate, applyTemplate } from './golden-templates';

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

describe('promotion candidates (the queue engine — human confirms, never auto)', () => {
  const mk = (over: Partial<BuildRecord>): BuildRecord => ({ ts: 0, prompt: 'p', steps: 1, app: { app: 'x', panels: [] }, ...over });
  it('drops broken builds, ranks clean+all-ok+focused higher, penalises golden-dups', () => {
    const builds = [
      mk({ ts: 1, prompt: 'add a casings table', steps: 2, trace: [{ verb: 'definePanel', args: {}, ok: true }] }),
      mk({ ts: 2, prompt: 'this one did nothing', steps: 0 }), // broken → not a candidate
      mk({ ts: 3, prompt: 'add a survey depth chart', steps: 20, trace: [{ verb: 'x', args: {}, ok: true }] }), // clean but runaway
    ];
    const golden: GoldenPair[] = [{ name: 'g', md: 'add a casings table', app: {} }];
    const ranked = rankPromotionCandidates(builds, golden);
    expect(ranked.find((c) => c.rec.prompt.includes('nothing'))).toBeUndefined();
    const casings = ranked.find((c) => c.rec.prompt.includes('casings'))!;
    const survey = ranked.find((c) => c.rec.prompt.includes('survey'))!;
    expect(casings.reasons).toContain('already covered by a golden');
    expect(survey.score).toBeGreaterThan(casings.score); // novel beats already-covered
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
    { name: 'well-designer', md: '# Well designer\nA casings table + a 3D bake of the well.', app: { app: 'w', docType: 'well', vars: { casings: [{ od: 9.625, id: 8.5, top: 0, bottom: 3000 }] }, panels: [{ id: 't', kind: 'table', props: { columns: 'od,id,top,bottom', search: true } }, { id: 'v', kind: 'bake3d' }], files: [{ slot: 'well', type: '.wson' }] } },
    { name: 'hello', md: '# Hello\nA simple greeting.', app: { app: 'h', panels: [{ id: 'g', kind: 'text' }] } },
  ];

  it('ranks curated golden pairs by MD description', () => {
    const hits = rankGolden('a well casings designer', golden, 2);
    expect(hits[0].name).toBe('well-designer');
    expect(rankGolden('zzz none', golden)).toHaveLength(0);
  });

  it('compactApp keeps kinds/files/nesting + props/vars/docType (semantics flow), drops bulk var rows', () => {
    const c = compactApp(golden[0].app) as any;
    expect(c.panels.map((p: any) => p.kind)).toEqual(['table', 'bake3d']);
    expect(c.files).toBeDefined();
    // meta + config now flow (they teach the model HOW to build, not just what exists):
    expect(c.docType).toBe('well');
    expect(c.panels[0].props).toMatchObject({ columns: 'od,id,top,bottom', search: true });
    // a var renders as a COMPACT SCHEMA (field names + count), NOT its rows:
    expect(c.vars.casings).toEqual({ fields: ['od', 'id', 'top', 'bottom'], count: 1 });
    expect(JSON.stringify(c)).not.toContain('9.625'); // the bulky row value is gone
  });

  // The #1 RAG-quality fix: a golden for "add a bar chart of tris per part" must ground with the
  // chart's CONFIG (type/rowsVar/xField/yField), the var SHAPE, and the structure fields — so a
  // 1.5B model can reconstruct the component, not just guess a `chart` kind exists.
  it('compactApp conveys chart config + source.args + var/structure SCHEMA (the semantic grounding fix)', () => {
    const app = {
      app: 'partsdash',
      title: 'CAD Parts — Dashboard',
      docType: 'dashboard',
      structures: {
        part: [
          { name: 'id', type: 'string' },
          { name: 'category', type: 'string' },
          { name: 'verts', type: 'number' },
          { name: 'tris', type: 'number' },
        ],
      },
      vars: {
        parts: [
          { id: 'g_cube', category: 'basic', verts: 24, tris: 12 },
          { id: 'g_shaft', category: 'basic', verts: 388, tris: 760 },
        ],
      },
      panels: [
        { id: 'trischart', kind: 'chart', props: { type: 'bar', rowsVar: 'parts', xField: 'id', yField: 'tris', title: 'Triangles per part' } },
        { id: 'partstable', kind: 'datatable', source: { verb: 'readVar', args: { name: 'parts' } }, props: { columns: 'id,category,verts,tris', search: true, showTotals: true } },
      ],
    };
    const c = compactApp(app) as any;
    const s = JSON.stringify(c);
    // 1. chart PROPS flow (type/rowsVar/xField/yField):
    expect(c.panels[0].props).toMatchObject({ type: 'bar', rowsVar: 'parts', xField: 'id', yField: 'tris' });
    // 2. source.args flow — the verb AND the var it reads:
    expect(c.panels[1].source).toEqual({ verb: 'readVar', args: { name: 'parts' } });
    // 3. app meta (docType/title) flow:
    expect(c.docType).toBe('dashboard');
    expect(c.title).toBe('CAD Parts — Dashboard');
    // 4. vars → compact schema (fields + count), NOT the rows:
    expect(c.vars.parts).toEqual({ fields: ['id', 'category', 'verts', 'tris'], count: 2 });
    expect(s).not.toContain('g_cube'); // the full var rows are never dumped
    expect(s).not.toContain('388');
    // 5. structures → field names:
    expect(c.structures.part).toEqual(['id', 'category', 'verts', 'tris']);
  });

  it('compactApp truncates a long string prop (token budget)', () => {
    const long = 'x'.repeat(200);
    const c = compactApp({ app: 't', panels: [{ id: 'p', kind: 'text', props: { text: long } }] }) as any;
    expect((c.panels[0].props.text as string).length).toBeLessThan(90);
    expect(c.panels[0].props.text).toContain('…');
  });

  it('grounding renders golden BEFORE builds', () => {
    const g = renderGrounding(rankBuilds('wells app', corpus, 1), rankGolden('well casings', golden, 1));
    expect(g).toContain('Curated examples');
    expect(g.indexOf('Curated examples')).toBeLessThan(g.indexOf('Similar past builds'));
  });
});

// Mirrors the REAL corpus contamination measured 2026-08-02: a `dashboard` build was retrieving
// (and the small local model copying) the `roadmap` app's gantt — via an UNTYPED `…gantt` atomic
// golden — plus the `well` schematic. The strict docType filter scopes retrieval to the app's own
// family, so those cross-app goldens (and untyped ones) drop out entirely.
describe('docType-scoped golden retrieval (#49 — kills cross-app contamination)', () => {
  const golden: GoldenPair[] = [
    { name: 'partsdash', md: '# Parts dashboard\nA bar chart of tris per part reading the parts variable.', app: { app: 'partsdash', docType: 'dashboard', panels: [{ id: 'c', kind: 'chart' }, { id: 't', kind: 'datatable' }] } },
    { name: 'plan', md: '# Roadmap\nSeed a tasks variable and a gantt timeline of the roadmap.', app: { app: 'plan', docType: 'roadmap', panels: [{ id: 'g', kind: 'gantt' }] } },
    { name: 'gantt-atomic', md: 'Seed a tasks variable with the roadmap as a list of task records with id label lane start end.', app: { app: 'x', panels: [{ id: 'greeting', kind: 'text' }, { id: 'gantt', kind: 'gantt' }] } }, // UNTYPED — the real contaminant
    { name: 'ewell', md: '# Well schematic\nA well schematic reading the casings variable.', app: { app: 'ewell', docType: 'well', panels: [{ id: 'w', kind: 'wellschematic' }] } },
  ];

  it('docTypeOf reads the top-level docType (undefined when untyped/null)', () => {
    expect(docTypeOf(golden[0].app)).toBe('dashboard');
    expect(docTypeOf(golden[2].app)).toBeUndefined();
    expect(docTypeOf(null)).toBeUndefined();
  });

  it('a dashboard build retrieves ONLY dashboard goldens (roadmap · well · untyped all excluded)', () => {
    const hits = rankGolden('Add a bar chart titled tris per part reading the parts variable', golden, 3, 'dashboard');
    expect(hits.map((g) => g.name)).toEqual(['partsdash']);
  });

  it('the gantt contaminant is gone from a dashboard prompt grounding (the acceptance test)', () => {
    const g = renderGrounding([], rankGolden('Add a bar chart reading the parts variable', golden, 3, 'dashboard'));
    expect(g).not.toMatch(/gantt/i);
    expect(g).toContain('chart');
  });

  it('without a docType the untyped gantt atomic is still retrievable (unchanged, backward-compatible)', () => {
    const hits = rankGolden('Seed a tasks variable with the roadmap task records id label lane', golden, 3);
    expect(hits.some((g) => g.name === 'gantt-atomic')).toBe(true);
  });
});

describe('parameterized / templated golden entries (#43 — one entry per family)', () => {
  // ONE templated golden stands in for N concrete "turn the background <colour>" pairs.
  const colorTemplate: GoldenPair = {
    name: 'bg-color',
    md: 'turn the background {{color}}',
    app: { app: 'bg', panels: [{ id: 'root', kind: 'stack' }], theme: { background: '{{color}}' } },
  };
  // A literal (non-templated) golden mixed in to prove backward-compatibility.
  const literal: GoldenPair = {
    name: 'hello',
    md: '# Hello\nA simple greeting text panel.',
    app: { app: 'h', panels: [{ id: 'g', kind: 'text' }] },
  };
  const pool = [colorTemplate, literal];

  it('one {{color}} golden retrieves for the WHOLE family (teal AND red)', () => {
    expect(rankGolden('turn the background teal', pool, 1)[0].name).toBe('bg-color');
    expect(rankGolden('make the background red', pool, 1)[0].name).toBe('bg-color');
    // and it never mis-fires on a disjoint prompt (no shared tokens with either golden)
    expect(rankGolden('survey depth chart zzz', pool)).toHaveLength(0);
  });

  it('non-templated goldens are UNAFFECTED (literal still retrieves by md overlap)', () => {
    expect(rankGolden('a simple greeting', pool, 1)[0].name).toBe('hello');
    // the whole existing suite above uses non-templated goldens and still passes → proof enough.
  });

  it('renderGrounding shows the template + a fill-note when no prompt / no exact match', () => {
    const g1 = renderGrounding([], rankGolden('turn the background teal', pool, 1)); // no prompt arg
    expect(g1).toContain('{{color}}');
    expect(g1).toContain('fill {{color}} from the user');

    // paraphrase → deterministic match fails → still shows the template (mechanism (a): LLM fills)
    const g2 = renderGrounding([], rankGolden('make the background red', pool, 1), 'make the background red');
    expect(g2).toContain('{{color}}');
    expect(g2).toContain('template — fill');
  });

  it('renderGrounding fills DETERMINISTICALLY when the prompt matches the template exactly', () => {
    const g = renderGrounding([], rankGolden('turn the background teal', pool, 1), 'turn the background teal');
    expect(g).toContain('turn the background teal'); // md filled
    expect(g).toContain('"background":"teal"'); // the target .app filled (compactApp keeps theme)
    expect(g).toContain('filled color=teal from the prompt');
    expect(g).not.toContain('{{color}}'); // no un-substituted placeholder remains
  });

  it('deterministic substitution produces the RIGHT target .app', () => {
    const m = matchTemplate('turn the background teal', colorTemplate)!;
    const target = applyTemplate(colorTemplate.app, m.values) as any;
    expect(target.theme.background).toBe('teal');
    expect(target.panels[0].kind).toBe('stack');
  });
});

// The flywheel promote shape (2026-08): a kept build → ATOMIC per-component golden pieces, each a
// docType-tagged slice keyed by a natural-language md — so a small model retrieves ONE piece per
// prompt instead of over-copying the whole app.
describe('decomposeToAtomicGoldens (#49 — the atomic promote transform)', () => {
  const app = {
    app: 'partsdash',
    title: 'CAD Parts — Dashboard',
    docType: 'dashboard',
    theme: { mode: 'light', accent: '#0d9488' },
    structures: { part: [{ name: 'id', type: 'string' }, { name: 'tris', type: 'number' }] },
    vars: { parts: [{ id: 'g_cube', tris: 12 }, { id: 'g_shaft', tris: 760 }] },
    panels: [
      { id: 'title', kind: 'heading', props: { text: 'CAD Parts — Dashboard', level: 1 } },
      { id: 'trischart', kind: 'chart', props: { type: 'bar', rowsVar: 'parts', xField: 'id', yField: 'tris', title: 'Triangles per part' } },
      { id: 'viewer', kind: 'cad3d', props: { partId: 'g_shaft' } },
    ],
  };

  it('slices into meta + theme + structure + var + one-per-panel, all docType-tagged', () => {
    const g = decomposeToAtomicGoldens(app);
    const byName = Object.fromEntries(g.map((x) => [x.name, x]));
    expect(Object.keys(byName).sort()).toEqual(
      ['partsdash-cad3d-viewer', 'partsdash-chart-trischart', 'partsdash-heading-title', 'partsdash-meta', 'partsdash-struct-part', 'partsdash-theme', 'partsdash-var-parts'].sort(),
    );
    // every slice carries docType so the docType filter keeps it for dashboard builds
    for (const x of g) expect((x.app as any).docType).toBe('dashboard');
    // each panel slice holds exactly ONE panel (atomic — no over-copy)
    expect((byName['partsdash-chart-trischart'].app as any).panels).toHaveLength(1);
    expect((byName['partsdash-chart-trischart'].app as any).panels[0].kind).toBe('chart');
  });

  it('keys each piece by a natural-language md a prompt can retrieve', () => {
    const g = decomposeToAtomicGoldens(app);
    const md = (n: string) => g.find((x) => x.name === n)!.md;
    expect(md('partsdash-chart-trischart')).toMatch(/bar chart.*reading the parts variable.*x = id, y = tris/);
    expect(md('partsdash-var-parts')).toMatch(/Seed a parts variable with records \(id, tris\)/);
    expect(md('partsdash-cad3d-viewer')).toMatch(/3D CAD viewer of the g_shaft part/);
    expect(md('partsdash-theme')).toMatch(/light theme with a #0d9488 accent/);
    expect(md('partsdash-meta')).toMatch(/dashboard app titled "CAD Parts — Dashboard", docType dashboard/);
  });

  it('var slice keeps the full target rows (grounding compacts them later, not here)', () => {
    const g = decomposeToAtomicGoldens(app);
    const varSlice = g.find((x) => x.name === 'partsdash-var-parts')!;
    expect((varSlice.app as any).vars.parts).toHaveLength(2); // the promote target is the real data
    // …but compactApp renders it as a schema, so the grounding stays small:
    expect(JSON.stringify(compactApp(varSlice.app))).not.toContain('g_cube');
  });
});
