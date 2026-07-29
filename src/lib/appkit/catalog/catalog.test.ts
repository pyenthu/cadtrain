import { describe, it, expect } from 'vitest';
import { buildCatalog, searchCatalog } from './catalog';
import { COMPONENT_CATALOG } from './components';
import { PANEL_KINDS } from '../verbs/gui';

describe('component catalog', () => {
  it('every catalog kind is a real PanelKind', () => {
    for (const c of COMPONENT_CATALOG) {
      expect(PANEL_KINDS as readonly string[]).toContain(c.kind);
    }
  });

  it('buildCatalog projects components + wireable verbs', () => {
    const all = buildCatalog();
    expect(all.some((e) => e.type === 'component' && e.key === 'table')).toBe(true);
    expect(all.some((e) => e.type === 'verb' && e.key === 'http')).toBe(true);
    // gui verbs (definePanel…) are the builder's tools — NOT wireable entries.
    expect(all.some((e) => e.key === 'definePanel')).toBe(false);
  });
});

describe('searchCatalog', () => {
  it('empty query returns all, components first', () => {
    const r = searchCatalog('');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].type).toBe('component');
  });

  it('ranks name/tag hits over description', () => {
    const r = searchCatalog('table');
    expect(r[0].key).toBe('table');
  });

  it('finds by tag synonym', () => {
    const r = searchCatalog('spreadsheet');
    expect(r.some((e) => e.key === 'table')).toBe(true);
  });

  it('type filter narrows to verbs', () => {
    const r = searchCatalog('bake', { type: 'verb' });
    expect(r.every((e) => e.type === 'verb')).toBe(true);
    expect(r.some((e) => e.key === 'bake')).toBe(true);
  });

  it('AND semantics — every term must match', () => {
    expect(searchCatalog('table zzzznope')).toHaveLength(0);
  });
});
