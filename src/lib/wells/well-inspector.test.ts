/**
 * well-inspector.test.ts — pins the PURE prop→form logic behind
 * `WellInspectorDock.svelte`. Invariants: the field list per kind, the
 * blank/NaN-drops-no-patch rule (mirrors `applyCompletionPatch`), the virtual
 * `wall`→`id` translation, and that a WSON doc normalises to inspector elements
 * carrying the right source indices + editable fields.
 */
import { describe, it, expect } from 'vitest';
import {
  inspectorFields,
  fieldGroups,
  buildPatch,
  wallOf,
  elementId,
  inspectorElementsFromWson,
  type WellInspectorElement,
} from './well-inspector';
import type { Wson } from './wson';

function casing(over: Partial<WellInspectorElement> = {}): WellInspectorElement {
  return {
    kind: 'casing', index: 2, elKey: elementId('casing', 2),
    label: 'production 9.625"', color: '#334155',
    od: 9.625, id: 8.535, top: 0, bot: 1500, grade: 'L80', weight: 47, type: 'production',
    ...over,
  };
}

describe('inspectorFields', () => {
  it('emits casing fields with a String select + od/id/wall', () => {
    const f = inspectorFields(casing());
    const keys = f.map((x) => x.key);
    expect(keys).toEqual(['type', 'od', 'id', 'wall', 'top', 'bot', 'grade', 'weight']);
    const sel = f.find((x) => x.key === 'type')!;
    expect(sel.type).toBe('select');
    expect(sel.options).toContain('production');
    // wall is derived, not a stored field.
    expect(f.find((x) => x.key === 'wall')!.value).toBeCloseTo((9.625 - 8.535) / 2, 6);
  });

  it('open hole shows bit size + depth only', () => {
    const f = inspectorFields({ kind: 'openhole', index: 0, elKey: 'openhole:0', label: 'OH 8.5"', color: '#6b4f3a', bitSize: 8.5, top: 1500, bot: 2000 });
    expect(f.map((x) => x.key)).toEqual(['bitSize', 'top', 'bot']);
  });

  it('perf shows a colour field', () => {
    const f = inspectorFields({ kind: 'perf', index: 1, elKey: 'perf:1', label: 'perf A', color: '#e53e3e', top: 1800, bot: 1810 });
    expect(f.find((x) => x.key === 'color')!.type).toBe('color');
    expect(f.map((x) => x.key)).toEqual(['label', 'top', 'bot', 'color']);
  });

  it('groups fields in canonical order, dropping empties', () => {
    const groups = fieldGroups(inspectorFields(casing()));
    expect(groups.map((g) => g.group)).toEqual(['Dimensions', 'Depth', 'Classification']);
  });
});

describe('buildPatch', () => {
  it('emits a routable numeric patch carrying kind + index', () => {
    const p = buildPatch(casing(), 'od', '10.75');
    expect(p).toEqual({ kind: 'casing', index: 2, od: 10.75 });
  });

  it('drops blank / NaN numbers (never clobbers)', () => {
    expect(buildPatch(casing(), 'od', '')).toBeNull();
    expect(buildPatch(casing(), 'top', 'abc')).toBeNull();
  });

  it('translates the virtual wall field to an id patch (id = od − 2·wall)', () => {
    const p = buildPatch(casing({ od: 9.625 }), 'wall', '0.5');
    expect(p).toEqual({ kind: 'casing', index: 2, id: 9.625 - 1 });
  });

  it('clamps a too-thick wall to id ≥ 0', () => {
    const p = buildPatch(casing({ od: 5 }), 'wall', '10');
    expect(p).toEqual({ kind: 'casing', index: 2, id: 0 });
  });

  it('passes string fields through as-is', () => {
    expect(buildPatch(casing(), 'grade', 'P110')).toEqual({ kind: 'casing', index: 2, grade: 'P110' });
    expect(buildPatch(casing(), 'type', 'liner')).toEqual({ kind: 'casing', index: 2, type: 'liner' });
  });
});

describe('wallOf', () => {
  it('derives (od−id)/2 for a hollow tubular', () => {
    expect(wallOf(casing())).toBeCloseTo((9.625 - 8.535) / 2, 6);
  });
  it('is undefined when id is missing or ≥ od', () => {
    expect(wallOf(casing({ id: undefined }))).toBeUndefined();
    expect(wallOf(casing({ od: 5, id: 6 }))).toBeUndefined();
  });
});

describe('inspectorElementsFromWson', () => {
  const wson: Wson = {
    meta: { wellName: 'W-42' },
    oh: [{ bitSize: 8.5, top: 1500, bot: 2000 }],
    ch: [{ od: 9.625, id: 8.535, top: 0, bot: 1500, type: 'production', grade: 'L80' }],
    cementing: [{ od: 12, top: 0, bot: 800 }],
    completions: [
      { description: 'Baker Packer', tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', od: 7, top: 1400, bot: 1401 },
      { description: 'Mule Shoe', tool_comp: 'MISC.MULE_SHOE', od: 2.875, length: 0.3 },
    ],
    perforations: [{ top: 1800, bot: 1810, label: 'zone A', color: '#ff0000' }],
  };

  it('normalises every collection with correct kind + source index', () => {
    const els = inspectorElementsFromWson(wson);
    const byKind = els.map((e) => `${e.kind}:${e.index}`);
    expect(byKind).toEqual([
      'openhole:0', 'cement:0', 'casing:0', 'completion:0', 'completion:1', 'perf:0',
    ]);
  });

  it('carries editable fields through', () => {
    const els = inspectorElementsFromWson(wson);
    const csg = els.find((e) => e.kind === 'casing')!;
    expect(csg).toMatchObject({ od: 9.625, id: 8.535, grade: 'L80', type: 'production' });
    const perf = els.find((e) => e.kind === 'perf')!;
    expect(perf).toMatchObject({ label: 'zone A', color: '#ff0000' });
    // A length-relative completion still resolves absolute extents for display.
    const shoe = els.find((e) => e.label === 'Mule Shoe')!;
    expect(shoe.length).toBe(0.3);
  });

  it('returns [] for a null/empty doc', () => {
    expect(inspectorElementsFromWson(null)).toEqual([]);
    expect(inspectorElementsFromWson({ meta: { wellName: 'x' } })).toEqual([]);
  });
});
