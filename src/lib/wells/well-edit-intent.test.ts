/**
 * well-edit-intent.test.ts — pins the PURE editor-intent glue
 * (`well-edit-intent.ts`): the inspector-edit routing (`kindToArrayKey`) and the
 * tool-rail add resolver (`addElementIntent` / `applyAddElement`).
 *
 * The load-bearing guard: every completion category's canonical `tool_comp`
 * resolves in the REAL registry to that same category — so a rail Add never
 * produces a mis-categorised (or generic-fallback) completion. Also drives a
 * real `WellEditCore` so an add is proven undoable + lands in the right array.
 * Headless.
 */
import { describe, it, expect } from 'vitest';
import {
  kindToArrayKey,
  addElementIntent,
  applyAddElement,
  applyAddElementDetailed,
  addElementToDoc,
} from './well-edit-intent';
import { ADD_ITEMS, COMPLETION_ITEMS } from './well-tool-rail';
import { resolveComponent } from './registry';
import { inspectorElementsFromWson } from './well-inspector';
import { WellEditCore } from './well-edit-core';
import type { Wson } from './wson';

const emptyWell = (): Wson => ({ meta: { wellName: 'W' } });

describe('kindToArrayKey', () => {
  it('routes each inspector kind to its WSON array', () => {
    expect(kindToArrayKey('openhole')).toBe('oh');
    expect(kindToArrayKey('casing')).toBe('ch');
    expect(kindToArrayKey('cement')).toBe('cementing');
    expect(kindToArrayKey('completion')).toBe('completions');
    expect(kindToArrayKey('perf')).toBe('perforations');
  });
});

describe('addElementIntent — structural + perforation', () => {
  it('open hole → oh[] with a bit size', () => {
    const i = addElementIntent('openhole');
    expect(i).toMatchObject({ key: 'oh', kind: 'openhole' });
    expect(i.value).toMatchObject({ bitSize: 8.5 });
  });

  it('cement → cementing[]', () => {
    expect(addElementIntent('cement')).toMatchObject({ key: 'cementing', kind: 'cement' });
  });

  it('casing → ch[] typed casing', () => {
    const i = addElementIntent('casing');
    expect(i).toMatchObject({ key: 'ch', kind: 'casing' });
    expect(i.value).toMatchObject({ type: 'casing', od: 9.625 });
  });

  it('tubing → a ch[] string typed tubing (structural, not a completion)', () => {
    const i = addElementIntent('tubing');
    expect(i).toMatchObject({ key: 'ch', kind: 'casing' });
    expect(i.value).toMatchObject({ type: 'tubing' });
  });

  it('perforation → perforations[]', () => {
    const i = addElementIntent('perforation');
    expect(i).toMatchObject({ key: 'perforations', kind: 'perf' });
    expect(i.value).toMatchObject({ top: 0, bot: 10 });
  });

  it('throws on an unknown element type (no silent fallback)', () => {
    // @ts-expect-error — intentionally invalid type
    expect(() => addElementIntent('gremlin')).toThrow(/unknown element type/);
  });
});

describe('addElementIntent — completion categories resolve to the right registry category', () => {
  it('every completion category maps to a tool_comp that resolves to that same category', () => {
    for (const item of COMPLETION_ITEMS) {
      const intent = addElementIntent(item.type);
      expect(intent.key).toBe('completions');
      expect(intent.kind).toBe('completion');
      const toolComp = String((intent.value as { tool_comp: string }).tool_comp);
      const resolved = resolveComponent({ tool_comp: toolComp }, 1);
      expect(resolved.category, `${item.type} → ${toolComp}`).toBe(item.type);
      // …and it is an EXACT registry hit, not the generic tube fallback.
      expect(resolved.matched, `${item.type} → ${toolComp}`).toBe(true);
    }
  });
});

describe('addElementIntent — full tool-rail coverage', () => {
  it('resolves an intent for every ADD_ITEMS button without throwing', () => {
    for (const item of ADD_ITEMS) {
      const intent = addElementIntent(item.type);
      expect(intent.type).toBe(item.type);
      expect(intent.value).toBeTypeOf('object');
      expect(['oh', 'ch', 'cementing', 'completions', 'perforations']).toContain(intent.key);
    }
  });
});

describe('applyAddElement — routes through an undoable WellEditCore', () => {
  it('appends a casing string to ch[] and is undoable', () => {
    const core = new WellEditCore(emptyWell());
    const idx = applyAddElement(core, 'casing');
    expect(idx).toBe(0);
    expect(core.doc.ch).toHaveLength(1);
    expect(core.doc.ch![0]).toMatchObject({ type: 'casing' });
    expect(core.canUndo).toBe(true);
    core.undo();
    expect(core.doc.ch ?? []).toHaveLength(0);
  });

  it('appends a completion resolving to its category', () => {
    const core = new WellEditCore(emptyWell());
    applyAddElement(core, 'packer');
    expect(core.doc.completions).toHaveLength(1);
    const c = core.doc.completions![0];
    expect(resolveComponent(c, 1).category).toBe('packer');
  });

  it('a perforation lands in perforations[]', () => {
    const core = new WellEditCore(emptyWell());
    applyAddElement(core, 'perforation');
    expect(core.doc.perforations).toHaveLength(1);
  });

  it('the deep-cloned value does not alias the intent table across adds', () => {
    const core = new WellEditCore(emptyWell());
    applyAddElement(core, 'casing');
    applyAddElement(core, 'casing');
    (core.doc.ch![0] as { od: number }).od = 99;
    expect(core.doc.ch![1].od).toBe(9.625); // second row untouched
  });

  it('applyAddElementDetailed returns the intent + index for post-add selection', () => {
    const core = new WellEditCore(emptyWell());
    const { intent, index } = applyAddElementDetailed(core, 'nipple');
    expect(index).toBe(0);
    expect(intent.kind).toBe('completion');
    // The added element is selectable via the inspector back-map coordinates.
    const els = inspectorElementsFromWson(core.doc);
    const sel = els.find((e) => e.kind === intent.kind && e.index === index);
    expect(sel).toBeTruthy();
  });
});

describe('addElementToDoc — doc-first add (no controller)', () => {
  it('mutates the doc in place, creating the array, and returns the new index', () => {
    const doc = emptyWell();
    const ref = doc;
    const i = addElementToDoc(doc, 'cement');
    expect(i).toBe(0);
    expect(doc.cementing).toHaveLength(1);
    expect(doc).toBe(ref); // identity preserved (in-place)
  });
});
