// parseVerbCalls robustness (RAG/grounding improvement for SMALL models). A strict `[ {…} ]`
// array is still the happy path (unchanged), but Phi/WebLLM-class models routinely emit a lone
// `{"verb":…}` or several newline-separated objects; these must still dispatch instead of parsing
// to zero verbs (a silent empty build). The existing strict-array cases live in build-cli.test.ts
// and MUST keep passing — the regression guards below re-assert them.
import { describe, it, expect } from 'vitest';
import { parseVerbCalls, emitInstruction } from './prompt';

describe('parseVerbCalls — strict array happy path (regression guards, unchanged)', () => {
  it('parses a fenced array', () => {
    expect(
      parseVerbCalls('```json\n[{"verb":"definePanel","args":{"panel":{"id":"t","kind":"text"}}}]\n```'),
    ).toEqual([{ verb: 'definePanel', args: { panel: { id: 't', kind: 'text' } } }]);
  });
  it('parses a prose-wrapped array', () => {
    expect(parseVerbCalls('Sure! Here you go:\n[{"verb":"x","args":{}}]\nDone.')).toEqual([{ verb: 'x', args: {} }]);
  });
  it('returns [] for non-JSON and a broken array', () => {
    expect(parseVerbCalls('no json here')).toEqual([]);
    expect(parseVerbCalls('[not, valid json')).toEqual([]);
  });
});

describe('parseVerbCalls — bare-object fallback (helps small models)', () => {
  it('recovers a lone object emitted WITHOUT the array wrapper', () => {
    expect(parseVerbCalls('{"verb":"definePanel","args":{"panel":{"id":"t","kind":"text"}}}')).toEqual([
      { verb: 'definePanel', args: { panel: { id: 't', kind: 'text' } } },
    ]);
  });
  it('recovers several newline-separated (NDJSON) objects, in order', () => {
    const raw = '{"verb":"setAppMeta","args":{"title":"X"}}\n{"verb":"definePanel","args":{"panel":{"id":"a","kind":"text"}}}';
    expect(parseVerbCalls(raw)).toEqual([
      { verb: 'setAppMeta', args: { title: 'X' } },
      { verb: 'definePanel', args: { panel: { id: 'a', kind: 'text' } } },
    ]);
  });
  it('keeps nested braces intact (brace-depth scan, not a greedy regex)', () => {
    const raw = 'Here:\n{"verb":"patchApp","args":{"op":"set","path":"theme","value":{"mode":"light","accent":"#000"}}}';
    expect(parseVerbCalls(raw)).toEqual([
      { verb: 'patchApp', args: { op: 'set', path: 'theme', value: { mode: 'light', accent: '#000' } } },
    ]);
  });
  it('is not fooled by braces inside strings', () => {
    expect(parseVerbCalls('{"verb":"setPanelProp","args":{"value":"a } b { c"}}')).toEqual([
      { verb: 'setPanelProp', args: { value: 'a } b { c' } },
    ]);
  });
  it('drops an object with no string verb', () => {
    expect(parseVerbCalls('{"foo":1}')).toEqual([]);
  });
  it('defaults missing args to {}', () => {
    expect(parseVerbCalls('{"verb":"listPanelKinds"}')).toEqual([{ verb: 'listPanelKinds', args: {} }]);
  });
});

describe('emitInstruction demands a strict JSON array', () => {
  it('states the array-only output contract', () => {
    const s = emitInstruction();
    expect(s).toMatch(/JSON array/i);
    expect(s).toContain('"verb"');
  });
});
