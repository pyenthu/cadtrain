/**
 * well-tool-rail.test.ts — pins the PURE tool-rail descriptors (well-tool-rail.ts).
 *
 * The key guard: the rail's add-element buttons stay in sync with the registry.
 * If a new `WellCompCategory` lands in `registry.ts` without a matching rail
 * button, `COMPLETION_ITEMS` no longer covers `CATEGORY_COLOR`'s keys → this
 * test fails, flagging the drift. No DOM / WASM — headless.
 */
import { describe, it, expect } from 'vitest';
import { CATEGORY_COLOR } from '../registry';
import {
  ADD_ITEMS,
  STRUCTURAL_ITEMS,
  COMPLETION_ITEMS,
  PERFORATION_ITEM,
  TOOL_ITEMS,
  CAMERA_ITEMS,
  FILE_ITEMS,
  type WellElementType,
} from '../well-tool-rail';

describe('well-tool-rail descriptors', () => {
  it('covers every completion category except the structural tubing + generic fallback', () => {
    const railTypes = new Set(COMPLETION_ITEMS.map((i) => i.type));
    const expected = Object.keys(CATEGORY_COLOR).filter((c) => c !== 'tubing' && c !== 'generic');
    for (const cat of expected) {
      expect(railTypes.has(cat as never)).toBe(true);
    }
    // …and doesn't invent categories the registry doesn't know about.
    expect(railTypes.size).toBe(expected.length);
  });

  it('colours each completion item from the registry CATEGORY_COLOR (no drift)', () => {
    for (const item of COMPLETION_ITEMS) {
      expect(item.color).toBe(CATEGORY_COLOR[item.type as keyof typeof CATEGORY_COLOR]);
    }
  });

  it('has all four structural well-body kinds', () => {
    const kinds = STRUCTURAL_ITEMS.map((i) => i.type).sort();
    expect(kinds).toEqual(['casing', 'cement', 'openhole', 'tubing']);
  });

  it('exposes a unique add-element type per button', () => {
    const types = ADD_ITEMS.map((i) => i.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('ADD_ITEMS = structural + completions + perforation', () => {
    expect(ADD_ITEMS.length).toBe(
      STRUCTURAL_ITEMS.length + COMPLETION_ITEMS.length + 1,
    );
    expect(ADD_ITEMS.at(-1)).toBe(PERFORATION_ITEM);
    expect(PERFORATION_ITEM.type).toBe<WellElementType>('perforation');
  });

  it('every descriptor carries a non-empty icon + label + tip', () => {
    for (const item of [...ADD_ITEMS, ...TOOL_ITEMS, ...CAMERA_ITEMS, ...FILE_ITEMS]) {
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.tip.length).toBeGreaterThan(0);
    }
  });

  it('provides the pointer, camera-preset + file-action tool sets', () => {
    expect(TOOL_ITEMS.map((t) => t.id)).toEqual(['select', 'measure']);
    expect(CAMERA_ITEMS.map((c) => c.id)).toEqual(['iso', 'front', 'top']);
    expect(FILE_ITEMS.map((f) => f.id)).toContain('save');
  });
});
