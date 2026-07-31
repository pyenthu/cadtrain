// Proves the CLI build path headless: emit-verbs text → parse → dispatch → trace.
// The subprocess runner is faked, so no `claude` binary is invoked.
import { describe, it, expect } from 'vitest';
import { buildAppViaCli, parseVerbCalls } from './build-cli';

describe('build-cli (provider "cli" — emit-verbs then dispatch)', () => {
  it('parseVerbCalls extracts the JSON array from fenced / prose-wrapped output', () => {
    expect(
      parseVerbCalls('```json\n[{"verb":"definePanel","args":{"panel":{"id":"t","kind":"text"}}}]\n```'),
    ).toEqual([{ verb: 'definePanel', args: { panel: { id: 't', kind: 'text' } } }]);
    expect(parseVerbCalls('Sure! Here you go:\n[{"verb":"x","args":{}}]\nDone.')).toEqual([{ verb: 'x', args: {} }]);
    expect(parseVerbCalls('no json here')).toEqual([]);
    expect(parseVerbCalls('[not, valid json')).toEqual([]);
  });

  it('dispatches the emitted verbs against the live app + records an ok trace', async () => {
    const app: any = { app: 'x', title: 'X', panels: [] };
    const runner = async () =>
      JSON.stringify([
        { verb: 'definePanel', args: { panel: { id: 'greeting', kind: 'text' } } },
        { verb: 'setComponentProp', args: { panelId: 'greeting', name: 'color', value: 'red' } },
      ]);
    const out = await buildAppViaCli({ prompt: 'add a red text', app }, runner);
    expect(out.app.panels).toHaveLength(1);
    // Props auto-promote to the runes store: the prop binds to $vars.<id>.<key> and the value
    // lives in the store, so setComponentProp writes THROUGH to it (the "turn text red" call).
    expect(out.app.panels[0].props.color).toBe('$vars.greeting.color');
    expect(out.app.vars.greeting.color).toBe('red');
    expect(out.trace.every((t) => t.ok)).toBe(true);
    expect(out.steps).toBe(2);
  });

  it('records a failed trace entry for an unknown verb (no throw, app untouched)', async () => {
    const app: any = { app: 'x', panels: [] };
    const runner = async () => JSON.stringify([{ verb: 'notARealVerb', args: {} }]);
    const out = await buildAppViaCli({ prompt: 'x', app }, runner);
    expect(out.trace[0].ok).toBe(false);
    expect(out.trace[0].error).toMatch(/gui verb/);
    expect(out.app.panels).toHaveLength(0);
  });
});
