import { describe, it, expect } from 'vitest';
import { rankBuilds, renderGrounding, type BuildRecord } from './app-corpus';

const rec = (prompt: string, panels: Array<{ id: string; kind: string }>): BuildRecord => ({
  ts: 0, prompt, steps: panels.length, app: { app: 'x', panels },
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
});
