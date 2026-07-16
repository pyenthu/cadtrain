import { describe, it, expect } from 'vitest';
import {
  resolveEmbedConfig,
  isTabVisible,
  parseEmbedFromSearch,
  ALL_TABS,
  ALL_ENGINES,
  type RightPaneTab,
} from './embed-config';

describe('resolveEmbedConfig — defaults reproduce the full current UI', () => {
  it('no argument = every surface ON', () => {
    const cfg = resolveEmbedConfig();
    // All nine right-pane tabs, in canonical order.
    expect(cfg.tabs).toEqual([...ALL_TABS]);
    expect(cfg.engines).toEqual([...ALL_ENGINES]);
    expect(cfg.sidebar).toBe(true);
    expect(cfg.toolbar).toBe(true);
    expect(cfg.rightPane).toBe(true);
    expect(cfg.graphCanvas).toBe(true);
    expect(cfg.popover).toBe(false);
    // Every tab is visible under the default config.
    for (const t of ALL_TABS) expect(isTabVisible(cfg, t)).toBe(true);
  });

  it('empty object / null behave like no argument', () => {
    const full = resolveEmbedConfig();
    expect(resolveEmbedConfig({})).toEqual(full);
    expect(resolveEmbedConfig(null)).toEqual(full);
    expect(resolveEmbedConfig(undefined)).toEqual(full);
  });

  it('the default tab list matches RightPane order exactly', () => {
    expect([...ALL_TABS]).toEqual([
      'bake', 'tf', 'source', 'md', 'svg', 'glb', 'brep', 'brepsvg', 'mfserver',
    ]);
  });
});

describe('each flag off hides exactly that surface', () => {
  it('sidebar:false hides only the sidebar', () => {
    const cfg = resolveEmbedConfig({ sidebar: false });
    expect(cfg.sidebar).toBe(false);
    expect(cfg.toolbar).toBe(true);
    expect(cfg.rightPane).toBe(true);
    expect(cfg.popover).toBe(false);
    expect(cfg.tabs).toEqual([...ALL_TABS]);
  });

  it('toolbar:false hides only the canvas toolbar', () => {
    const cfg = resolveEmbedConfig({ toolbar: false });
    expect(cfg.toolbar).toBe(false);
    expect(cfg.sidebar).toBe(true);
    expect(cfg.rightPane).toBe(true);
    expect(cfg.tabs).toEqual([...ALL_TABS]);
  });

  it('rightPane:false hides only the right pane', () => {
    const cfg = resolveEmbedConfig({ rightPane: false });
    expect(cfg.rightPane).toBe(false);
    expect(cfg.sidebar).toBe(true);
    expect(cfg.toolbar).toBe(true);
    expect(cfg.graphCanvas).toBe(true);
  });

  it('graphCanvas:false hides only the node canvas (right pane fills)', () => {
    const cfg = resolveEmbedConfig({ graphCanvas: false });
    expect(cfg.graphCanvas).toBe(false);
    expect(cfg.rightPane).toBe(true);
    expect(cfg.sidebar).toBe(true);
    expect(cfg.toolbar).toBe(true);
    expect(cfg.tabs).toEqual([...ALL_TABS]);
  });

  it('popover:true enables popover mode only', () => {
    const cfg = resolveEmbedConfig({ popover: true });
    expect(cfg.popover).toBe(true);
    expect(cfg.sidebar).toBe(true);
    expect(cfg.toolbar).toBe(true);
    expect(cfg.rightPane).toBe(true);
  });
});

describe('tabs restriction', () => {
  it('a subset of tabs restricts to exactly that subset, in canonical order', () => {
    const cfg = resolveEmbedConfig({ tabs: ['svg', 'bake'] });
    // Canonical order is bake before svg regardless of input order.
    expect(cfg.tabs).toEqual(['bake', 'svg']);
    expect(isTabVisible(cfg, 'bake')).toBe(true);
    expect(isTabVisible(cfg, 'svg')).toBe(true);
    expect(isTabVisible(cfg, 'source')).toBe(false);
    expect(isTabVisible(cfg, 'md')).toBe(false);
  });

  it('tabs:[] hides every tab', () => {
    const cfg = resolveEmbedConfig({ tabs: [] });
    expect(cfg.tabs).toEqual([]);
    for (const t of ALL_TABS) expect(isTabVisible(cfg, t)).toBe(false);
  });

  it('a single tab keeps just that tab', () => {
    const cfg = resolveEmbedConfig({ tabs: ['source'] });
    expect(cfg.tabs).toEqual(['source']);
  });

  it('duplicate tab ids are de-duplicated', () => {
    const cfg = resolveEmbedConfig({ tabs: ['bake', 'bake', 'svg'] });
    expect(cfg.tabs).toEqual(['bake', 'svg']);
  });
});

describe('engines restriction gates the engine tabs', () => {
  it('a subset of engines removes the other engines and their tabs', () => {
    const cfg = resolveEmbedConfig({ engines: ['manifold'] });
    expect(cfg.engines).toEqual(['manifold']);
    // manifold owns bake + mfserver; trueform (tf) and both brep tabs are gone.
    expect(isTabVisible(cfg, 'bake')).toBe(true);
    expect(isTabVisible(cfg, 'mfserver')).toBe(true);
    expect(isTabVisible(cfg, 'tf')).toBe(false);
    expect(isTabVisible(cfg, 'brep')).toBe(false);
    expect(isTabVisible(cfg, 'brepsvg')).toBe(false);
    // Non-engine tabs are untouched.
    expect(isTabVisible(cfg, 'source')).toBe(true);
    expect(isTabVisible(cfg, 'svg')).toBe(true);
  });

  it('trueform-only keeps tf, drops bake/mfserver/brep', () => {
    const cfg = resolveEmbedConfig({ engines: ['trueform'] });
    expect(cfg.tabs).toEqual(['tf', 'source', 'md', 'svg', 'glb']);
  });

  it('brep engine owns BOTH brep tabs (mesh + brepsvg)', () => {
    const cfg = resolveEmbedConfig({ engines: ['brep'] });
    // brep owns brep + brepsvg; the manifold/trueform tabs are gone.
    expect(cfg.tabs).toEqual(['source', 'md', 'svg', 'glb', 'brep', 'brepsvg']);
    expect(isTabVisible(cfg, 'brep')).toBe(true);
    expect(isTabVisible(cfg, 'brepsvg')).toBe(true);
    expect(isTabVisible(cfg, 'bake')).toBe(false);
    expect(isTabVisible(cfg, 'tf')).toBe(false);
  });

  it('engines and tabs intersect (both must allow a tab)', () => {
    // Ask for the brep tab but disable the brep engine → brep hidden.
    const cfg = resolveEmbedConfig({ tabs: ['bake', 'brep'], engines: ['manifold'] });
    expect(cfg.tabs).toEqual(['bake']);
  });

  it('engines:[] leaves only the non-engine tabs', () => {
    const cfg = resolveEmbedConfig({ engines: [] });
    expect(cfg.engines).toEqual([]);
    expect(cfg.tabs).toEqual(['source', 'md', 'svg', 'glb']);
  });
});

describe('unknown keys / invalid members never crash', () => {
  it('unknown top-level keys are ignored', () => {
    const cfg = resolveEmbedConfig({ nope: true, whatever: 42 } as any);
    expect(cfg).toEqual(resolveEmbedConfig());
  });

  it('unknown tab ids are dropped, valid ones kept', () => {
    const cfg = resolveEmbedConfig({ tabs: ['bake', 'bogus', 'svg'] as any });
    expect(cfg.tabs).toEqual(['bake', 'svg']);
  });

  it('unknown engine ids are dropped', () => {
    const cfg = resolveEmbedConfig({ engines: ['manifold', 'ray-tracer'] as any });
    expect(cfg.engines).toEqual(['manifold']);
  });

  it('all-unknown tabs resolve to an empty tab list, not the full one', () => {
    const cfg = resolveEmbedConfig({ tabs: ['x', 'y'] as any });
    expect(cfg.tabs).toEqual([]);
  });
});

describe('parseEmbedFromSearch', () => {
  const parse = (qs: string) => parseEmbedFromSearch(new URLSearchParams(qs));

  it('returns undefined when no recognized key is present', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('id=foo&open=bar')).toBeUndefined();
  });

  it('parses boolean flags (0/1/true/false/on/off)', () => {
    expect(parse('sidebar=0')).toEqual({ sidebar: false });
    expect(parse('sidebar=1')).toEqual({ sidebar: true });
    expect(parse('toolbar=false')).toEqual({ toolbar: false });
    expect(parse('popover=on')).toEqual({ popover: true });
    expect(parse('rightpane=off')).toEqual({ rightPane: false });
    // camelCase alias for rightPane is also accepted.
    expect(parse('rightPane=0')).toEqual({ rightPane: false });
  });

  it('parses csv tabs + engines lists', () => {
    expect(parse('tabs=bake,source')).toEqual({ tabs: ['bake', 'source'] });
    expect(parse('engines=manifold,trueform')).toEqual({ engines: ['manifold', 'trueform'] });
  });

  it('round-trips through resolveEmbedConfig', () => {
    const partial = parse('sidebar=0&tabs=bake,svg&engines=manifold');
    const cfg = resolveEmbedConfig(partial);
    expect(cfg.sidebar).toBe(false);
    expect(cfg.tabs).toEqual(['bake', 'svg']);
    expect(cfg.engines).toEqual(['manifold']);
  });

  it('ignores unparseable boolean values', () => {
    // sidebar=maybe is not a recognized boolean → dropped; no other keys → undefined.
    expect(parse('sidebar=maybe')).toBeUndefined();
  });
});
