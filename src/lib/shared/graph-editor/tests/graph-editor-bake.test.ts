import { describe, it, expect } from 'vitest';
import { extractGraphFromSource, extractDrawingMdFromSource, callDrift } from '../graph-editor-bake';

// Pure parsing + drift logic carved out of GraphEditorPane (modularize Phase B).
// The stateful loaders (loadExpectedParamsFor/isCallDrifted/refreshCallArgs)
// are integration-tested in-browser; these pin the pure cores.

describe('extractGraphFromSource', () => {
  it('returns undefined for empty / no-graph-block source', () => {
    expect(extractGraphFromSource('')).toBeUndefined();
    expect(extractGraphFromSource('export const meta = { id: "x" };')).toBeUndefined();
  });

  it('extracts a balanced graph literal from a meta block', () => {
    const src = `export const meta = {
      id: 'g_demo',
      graph: { root: 'n1', nodes: { n1: { type: 'call', src: 'r_cuboid' } }, layout: {} },
      uses: ['r_cuboid'],
    };`;
    const g = extractGraphFromSource(src);
    expect(g).toBeTruthy();
    expect(g.root).toBe('n1');
    expect(g.nodes.n1.src).toBe('r_cuboid');
  });

  it('handles nested braces inside the graph block', () => {
    const src = `meta = { graph: { nodes: { a: { args: { r: { kind: 'literal', value: 1 } } } } } };`;
    const g = extractGraphFromSource(src);
    expect(g.nodes.a.args.r.value).toBe(1);
  });

  it('returns undefined (not a throw) on malformed graph literal', () => {
    expect(extractGraphFromSource('graph: { nodes: { a: }')).toBeUndefined();
  });
});

describe('extractDrawingMdFromSource', () => {
  it('returns empty string when absent', () => {
    expect(extractDrawingMdFromSource('')).toBe('');
    expect(extractDrawingMdFromSource('meta = { id: "x" }')).toBe('');
  });

  it('unescapes newlines and quotes', () => {
    const src = `meta = { drawingMd: 'line one\\nit\\'s line two', id: 'x' };`;
    expect(extractDrawingMdFromSource(src)).toBe("line one\nit's line two");
  });
});

describe('callDrift', () => {
  const call = (keys: string[]) => ({
    type: 'call',
    args: Object.fromEntries(keys.map((k) => [k, { kind: 'literal', value: 0 }])),
  });

  it('is false when expected keys are unknown (not yet fetched)', () => {
    expect(callDrift(call(['od', 'wall']), undefined)).toBe(false);
  });

  it('is false when args keys match expected (order-independent)', () => {
    expect(callDrift(call(['od', 'wall']), ['wall', 'od'])).toBe(false);
  });

  it('is true when a key was added to the primitive', () => {
    expect(callDrift(call(['od']), ['od', 'wall'])).toBe(true);
  });

  it('is true when a key was removed from the primitive', () => {
    expect(callDrift(call(['od', 'wall']), ['od'])).toBe(true);
  });

  it('is true on a same-length key rename', () => {
    expect(callDrift(call(['od', 'wall']), ['od', 'thickness'])).toBe(true);
  });

  it('is false for non-call nodes', () => {
    expect(callDrift({ type: 'mv' }, ['x'])).toBe(false);
    expect(callDrift(null, ['x'])).toBe(false);
  });
});
