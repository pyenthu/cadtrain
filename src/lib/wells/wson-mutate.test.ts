/**
 * wson-mutate.test.ts — pins the edit-the-diagram mutation layer.
 *
 * Invariants: a patch mutates the target completion in place (and no sibling),
 * blank/NaN numbers never clobber, delete splices the right row and shifts the
 * rest, and out-of-range indices are no-ops.
 */
import { describe, it, expect } from 'vitest';
import { applyCompletionPatch, removeCompletion } from './wson-mutate';

function doc() {
  return {
    meta: { wellName: 'W', td: 1000 },
    completions: [
      { description: 'Tubing Hanger', tool_comp: 'tbgHanger', od: 8.681, top: 0, bot: 0.5 },
      { description: 'Baker Packer', tool_comp: 'PACKERS.X', od: 8.681, top: 1028, bot: 1028.5 },
      { description: 'Mule Shoe', tool_comp: 'MISC.MULE_SHOE', od: 2.875, length: 0.2 },
    ],
  };
}

describe('applyCompletionPatch', () => {
  it('mutates the target completion in place and reflects the patch', () => {
    const d = doc();
    const ret = applyCompletionPatch(d, 1, { od: 9.5, top: 1000, bot: 1002, description: 'Renamed Packer' });
    expect(ret).toBe(d); // same ref (mutated in place, no new identity)
    expect(d.completions[1]).toMatchObject({ od: 9.5, top: 1000, bot: 1002, description: 'Renamed Packer' });
  });

  it('leaves siblings untouched', () => {
    const d = doc();
    applyCompletionPatch(d, 1, { od: 9.5 });
    expect(d.completions[0].od).toBe(8.681);
    expect(d.completions[2].description).toBe('Mule Shoe');
  });

  it('promotes a length-relative completion to absolute extents', () => {
    const d = doc();
    applyCompletionPatch(d, 2, { top: 1029.8, bot: 1030 });
    expect(d.completions[2]).toMatchObject({ top: 1029.8, bot: 1030, length: 0.2 });
  });

  it('never clobbers a value with NaN/undefined', () => {
    const d = doc();
    applyCompletionPatch(d, 0, { od: NaN, top: undefined });
    expect(d.completions[0].od).toBe(8.681);
    expect(d.completions[0].top).toBe(0);
  });

  it('is a no-op for an out-of-range index', () => {
    const d = doc();
    const before = JSON.stringify(d);
    applyCompletionPatch(d, 9, { od: 1 });
    applyCompletionPatch(d, -1, { od: 1 });
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('removeCompletion', () => {
  it('splices the target row and shifts the rest', () => {
    const d = doc();
    removeCompletion(d, 0);
    expect(d.completions).toHaveLength(2);
    expect(d.completions[0].description).toBe('Baker Packer');
  });

  it('is a no-op for an out-of-range index', () => {
    const d = doc();
    removeCompletion(d, 9);
    expect(d.completions).toHaveLength(3);
  });
});
