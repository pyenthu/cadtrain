/**
 * well-edit-core.test.ts — pins the /wells editing engine (#42b-B §B1).
 *
 * Invariants under test:
 *  - typed mutations (strings / completions / survey) + the generic element ops
 *    add / remove / update the right array, guard blanks, and leave siblings alone;
 *  - doc IDENTITY is stable across every edit + undo/redo (the no-remount contract);
 *  - undo/redo/undo SEQUENCES restore exact prior state, redo clears on a fresh
 *    edit, and out-of-range no-ops never pollute history;
 *  - the onChange callback fires with the correct `survey` flag (drives re-warp);
 *  - the undo stack is ring-capped.
 *
 * Pure engine → runs headless (the whole reason the logic is runes-free; the
 * `.svelte.ts` store is a thin `$state` facade over this).
 */
import { describe, it, expect, vi } from 'vitest';
import { WellEditCore, type WellChangeInfo } from '../well-edit-core';
import type { Wson } from '../wson';

function sampleDoc(): Wson {
  return {
    meta: { wellName: 'W', td: 1000 },
    ch: [
      { od: 20, id: 19.124, top: 0, bot: 60, grade: 'K55', type: 'conductor' },
      { od: 9.625, id: 8.681, top: 0, bot: 1000, grade: 'L80', type: 'production' },
    ],
    completions: [
      { description: 'Tubing Hanger', tool_comp: 'tbgHanger', od: 8.681, top: 0, bot: 0.5 },
      { description: 'Baker Packer', tool_comp: 'PACKERS.X', od: 8.681, top: 980, bot: 981 },
    ],
    profile: [
      { md: 0, dev: 0, az: 0 },
      { md: 500, dev: 0, az: 0 },
    ],
  };
}

/** Fresh throwaway doc (the caller owns cloning — the core mutates in place). */
function core(onChange?: (i: WellChangeInfo) => void) {
  return new WellEditCore(sampleDoc(), onChange);
}

describe('WellEditCore — strings (ch[])', () => {
  it('addString appends a default row and returns its index', () => {
    const c = core();
    const idx = c.addString();
    expect(idx).toBe(2);
    expect(c.doc.ch).toHaveLength(3);
    expect(c.doc.ch![2]).toMatchObject({ od: 9.625, type: 'production' });
  });

  it('addString merges overrides over the defaults', () => {
    const c = core();
    c.addString({ od: 7, type: 'liner' });
    expect(c.doc.ch![2]).toMatchObject({ od: 7, type: 'liner' });
  });

  it('updateString patches in place and leaves siblings untouched', () => {
    const c = core();
    const row0 = c.doc.ch![0];
    c.updateString(1, { od: 10.75, grade: 'P110' });
    expect(c.doc.ch![1]).toMatchObject({ od: 10.75, grade: 'P110' });
    expect(c.doc.ch![0]).toBe(row0); // sibling ref untouched
    expect(c.doc.ch![0].od).toBe(20);
  });

  it('updateString never clobbers with a blank/NaN number', () => {
    const c = core();
    c.updateString(0, { od: NaN, grade: 'X56' });
    expect(c.doc.ch![0].od).toBe(20); // NaN skipped
    expect(c.doc.ch![0].grade).toBe('X56');
  });

  it('removeString splices the right row and shifts the rest', () => {
    const c = core();
    c.removeString(0);
    expect(c.doc.ch).toHaveLength(1);
    expect(c.doc.ch![0].od).toBe(9.625);
  });

  it('out-of-range remove/update are no-ops that record NO history', () => {
    const c = core();
    expect(c.removeString(9)).toBe(false);
    expect(c.updateString(-1, { od: 1 })).toBe(false);
    expect(c.undoDepth).toBe(0);
    expect(c.canUndo).toBe(false);
  });
});

describe('WellEditCore — completions (reuses applyCompletionPatch)', () => {
  it('addCompletion appends a default component', () => {
    const c = core();
    c.addCompletion({ description: 'SSD', tool_comp: 'FLOW_CONTROL.SSD' });
    expect(c.doc.completions).toHaveLength(3);
    expect(c.doc.completions![2]).toMatchObject({ description: 'SSD', tool_comp: 'FLOW_CONTROL.SSD' });
  });

  it('updateCompletion patches via the canonical helper', () => {
    const c = core();
    c.updateCompletion(1, { od: 9.5, description: 'Renamed' });
    expect(c.doc.completions![1]).toMatchObject({ od: 9.5, description: 'Renamed' });
  });

  it('removeCompletion splices', () => {
    const c = core();
    c.removeCompletion(0);
    expect(c.doc.completions).toHaveLength(1);
    expect(c.doc.completions![0].description).toBe('Baker Packer');
  });
});

describe('WellEditCore — survey (profile[]) + re-warp signalling', () => {
  it('addStation defaults MD to the deepest existing station', () => {
    const c = core();
    const idx = c.addStation();
    expect(idx).toBe(2);
    expect(c.doc.profile![2]).toMatchObject({ md: 500, dev: 0, az: 0 });
  });

  it('updateStation edits in place', () => {
    const c = core();
    c.updateStation(1, { dev: 45, az: 90 });
    expect(c.doc.profile![1]).toMatchObject({ md: 500, dev: 45, az: 90 });
  });

  it('a survey mutation fires onChange with survey:true', () => {
    const seen: WellChangeInfo[] = [];
    const c = core((i) => seen.push(i));
    c.updateStation(1, { dev: 30 });
    expect(seen.at(-1)).toEqual({ cause: 'edit', survey: true });
  });

  it('a NON-survey mutation fires onChange with survey:false', () => {
    const seen: WellChangeInfo[] = [];
    const c = core((i) => seen.push(i));
    c.updateString(0, { od: 21 });
    expect(seen.at(-1)).toEqual({ cause: 'edit', survey: false });
  });
});

describe('WellEditCore — generic element ops', () => {
  it('addElement creates a missing array', () => {
    const c = core();
    expect(c.doc.perforations).toBeUndefined();
    c.addElement('perforations', { top: 990, bot: 995, label: 'zone A' });
    expect(c.doc.perforations).toHaveLength(1);
    expect(c.doc.perforations![0]).toMatchObject({ top: 990, bot: 995 });
  });

  it('addElement deep-clones the value (no aliasing into history)', () => {
    const c = core();
    const v = { top: 1, bot: 2 };
    c.addElement('oh', v as unknown as object);
    (c.doc.oh![0] as { top: number }).top = 999;
    expect(v.top).toBe(1); // caller's object not aliased
  });

  it('updateElement / removeElement respect bounds', () => {
    const c = core();
    expect(c.updateElement('oh', 0, { top: 5 })).toBe(false); // no oh array
    expect(c.removeElement('completions', 5)).toBe(false);
  });
});

describe('WellEditCore — undo / redo', () => {
  it('undo restores the exact prior doc, redo re-applies', () => {
    const c = core();
    c.updateString(0, { od: 30 });
    expect(c.doc.ch![0].od).toBe(30);
    expect(c.canUndo).toBe(true);

    expect(c.undo()).toBe(true);
    expect(c.doc.ch![0].od).toBe(20); // restored
    expect(c.canRedo).toBe(true);

    expect(c.redo()).toBe(true);
    expect(c.doc.ch![0].od).toBe(30); // re-applied
  });

  it('doc IDENTITY is stable across edit + undo + redo (no-remount contract)', () => {
    const c = core();
    const ref = c.doc;
    c.addString();
    c.undo();
    c.redo();
    expect(c.doc).toBe(ref); // same object throughout
  });

  it('handles a multi-step edit → undo → undo → redo sequence', () => {
    const c = core();
    c.updateString(0, { od: 21 });      // edit 1
    c.addString({ od: 5 });             // edit 2
    c.removeString(0);                  // edit 3
    expect(c.doc.ch!.map((s) => s.od)).toEqual([9.625, 5]);

    c.undo();                           // undo edit 3 (re-add row 0)
    expect(c.doc.ch!.map((s) => s.od)).toEqual([21, 9.625, 5]);
    c.undo();                           // undo edit 2 (drop the od:5 row)
    expect(c.doc.ch!.map((s) => s.od)).toEqual([21, 9.625]);
    c.redo();                           // redo edit 2
    expect(c.doc.ch!.map((s) => s.od)).toEqual([21, 9.625, 5]);
  });

  it('a fresh edit after undo CLEARS the redo stack', () => {
    const c = core();
    c.updateString(0, { od: 21 });
    c.undo();
    expect(c.canRedo).toBe(true);
    c.updateString(1, { od: 8 }); // branches history
    expect(c.canRedo).toBe(false);
    expect(c.redo()).toBe(false);
  });

  it('undo / redo on an empty stack are false no-ops', () => {
    const c = core();
    expect(c.undo()).toBe(false);
    expect(c.redo()).toBe(false);
    expect(c.canUndo).toBe(false);
    expect(c.canRedo).toBe(false);
  });

  it('undo signals survey:true only when the profile actually changed', () => {
    const surveyFlags: boolean[] = [];
    const c = core((i) => { if (i.cause === 'undo') surveyFlags.push(i.survey); });
    c.updateString(0, { od: 21 }); // non-survey edit
    c.undo();
    expect(surveyFlags).toEqual([false]);

    c.updateStation(0, { dev: 12 }); // survey edit
    c.undo();
    expect(surveyFlags).toEqual([false, true]);
  });

  it('undo of an add removes the added row; of a remove restores it', () => {
    const c = core();
    c.addCompletion({ description: 'Nipple', tool_comp: 'FLOW_CONTROL.NIPPLE_R' });
    expect(c.doc.completions).toHaveLength(3);
    c.undo();
    expect(c.doc.completions).toHaveLength(2);

    c.removeCompletion(0);
    expect(c.doc.completions).toHaveLength(1);
    c.undo();
    expect(c.doc.completions).toHaveLength(2);
    expect(c.doc.completions![0].description).toBe('Tubing Hanger');
  });

  it('restored snapshots do not alias (later edits never mutate history)', () => {
    const c = core();
    c.updateString(0, { od: 30 });
    c.undo();                       // back to od:20
    c.updateString(0, { od: 40 });  // new edit over restored state
    c.undo();                       // must return to od:20, not 30/40
    expect(c.doc.ch![0].od).toBe(20);
  });
});

describe('WellEditCore — reset + cap', () => {
  it('reset clears history and can load a different well', () => {
    const c = core();
    c.updateString(0, { od: 99 });
    expect(c.canUndo).toBe(true);
    c.reset({ meta: { wellName: 'OTHER' }, ch: [{ od: 7, top: 0, bot: 100 }] });
    expect(c.canUndo).toBe(false);
    expect(c.doc.meta.wellName).toBe('OTHER');
    expect(c.doc.ch).toHaveLength(1);
  });

  it('reset preserves doc identity while swapping contents', () => {
    const c = core();
    const ref = c.doc;
    c.reset({ meta: { wellName: 'X' } });
    expect(c.doc).toBe(ref);
    expect(c.doc.ch).toBeUndefined(); // old key gone
  });

  it('the undo stack is ring-capped (does not grow unbounded)', () => {
    const c = core();
    for (let i = 0; i < 250; i++) c.updateString(0, { od: 1 + i });
    expect(c.undoDepth).toBeLessThanOrEqual(100);
    // history still coherent — an undo steps back one edit
    const cur = c.doc.ch![0].od;
    c.undo();
    expect(c.doc.ch![0].od).not.toBe(cur);
  });
});

describe('WellEditCore — onChange invocation count', () => {
  it('fires exactly once per successful mutation, and not on no-ops', () => {
    const onChange = vi.fn();
    const c = core(onChange);
    c.addString();               // 1
    c.updateString(0, { od: 5 }); // 2
    c.removeString(0);           // 3
    c.removeString(99);          // no-op → no fire
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe('WellEditCore — session-batched undo (beginEdit / endEdit)', () => {
  it('coalesces a burst of edits into ONE undo entry', () => {
    const c = core();
    c.beginEdit();
    c.updateString(0, { od: 21 });
    c.updateString(0, { od: 22 });
    c.updateString(0, { od: 23 }); // three keystrokes, one field
    c.endEdit();

    expect(c.doc.ch![0].od).toBe(23);
    expect(c.undoDepth).toBe(1);   // ONE history entry, not three

    c.undo();
    expect(c.doc.ch![0].od).toBe(20); // straight back to the pre-session value
    expect(c.canUndo).toBe(false);
  });

  it('still fires onChange for every edit in the session (live updates)', () => {
    const onChange = vi.fn();
    const c = core(onChange);
    c.session(() => {
      c.updateString(0, { od: 21 });
      c.updateString(0, { od: 22 });
    });
    expect(onChange).toHaveBeenCalledTimes(2); // reactive per edit …
    expect(c.undoDepth).toBe(1);               // … one undo step
  });

  it('redo re-applies the whole coalesced session in one step', () => {
    const c = core();
    c.session(() => {
      c.updateString(0, { od: 21 });
      c.updateString(0, { od: 22 });
    });
    c.undo();
    expect(c.doc.ch![0].od).toBe(20);
    c.redo();
    expect(c.doc.ch![0].od).toBe(22); // final session value restored at once
  });

  it('a fresh session after a prior one opens a NEW undo entry', () => {
    const c = core();
    c.session(() => { c.updateString(0, { od: 21 }); c.updateString(0, { od: 22 }); });
    c.session(() => { c.updateString(0, { od: 30 }); c.updateString(0, { od: 31 }); });
    expect(c.undoDepth).toBe(2);
    c.undo(); expect(c.doc.ch![0].od).toBe(22); // back to end of session 1
    c.undo(); expect(c.doc.ch![0].od).toBe(20); // back to before session 1
  });

  it('an edit OUTSIDE a session is still its own undo entry', () => {
    const c = core();
    c.updateString(0, { od: 21 });                 // solo edit → entry 1
    c.session(() => { c.updateString(0, { od: 30 }); c.updateString(0, { od: 31 }); }); // entry 2
    expect(c.undoDepth).toBe(2);
  });

  it('nested begin/endEdit collapse to the OUTERMOST session', () => {
    const c = core();
    c.beginEdit();
    c.updateString(0, { od: 21 });
    c.beginEdit();                 // nested — no new entry
    c.updateString(0, { od: 22 });
    c.endEdit();                   // inner close does not end coalescing
    c.updateString(0, { od: 23 });
    expect(c.inSession).toBe(true);
    c.endEdit();                   // outer close ends the session
    expect(c.inSession).toBe(false);
    expect(c.undoDepth).toBe(1);
    c.undo();
    expect(c.doc.ch![0].od).toBe(20);
  });

  it('an empty session (no mutations) records no history', () => {
    const c = core();
    c.session(() => { /* nothing */ });
    expect(c.undoDepth).toBe(0);
    expect(c.canUndo).toBe(false);
  });

  it('doc IDENTITY is preserved across a coalesced session + undo', () => {
    const c = core();
    const ref = c.doc;
    c.session(() => { c.addString(); c.updateString(2, { od: 7 }); });
    c.undo();
    expect(c.doc).toBe(ref);
  });

  it('unbalanced endEdit() is a harmless no-op', () => {
    const c = core();
    c.endEdit();                   // no open session
    expect(c.inSession).toBe(false);
    c.updateString(0, { od: 21 }); // behaves as a normal solo edit
    expect(c.undoDepth).toBe(1);
  });

  it('session() closes the session even when the body throws', () => {
    const c = core();
    expect(() => c.session(() => {
      c.updateString(0, { od: 21 });
      throw new Error('boom');
    })).toThrow('boom');
    expect(c.inSession).toBe(false); // not left open
    expect(c.undoDepth).toBe(1);     // the pre-throw edit is still captured (once)
    c.undo();
    expect(c.doc.ch![0].od).toBe(20);
  });

  it('undo mid-session force-closes it so the next edit starts fresh', () => {
    const c = core();
    c.beginEdit();
    c.updateString(0, { od: 21 });
    c.undo();                      // closes the session, restores od:20
    expect(c.inSession).toBe(false);
    expect(c.doc.ch![0].od).toBe(20);
    c.updateString(0, { od: 40 }); // a new, independent undo entry
    expect(c.undoDepth).toBe(1);
    c.undo();
    expect(c.doc.ch![0].od).toBe(20);
  });

  it('a session mixing survey + non-survey edits still signals survey:true once', () => {
    const seen: WellChangeInfo[] = [];
    const c = core((i) => seen.push(i));
    c.session(() => {
      c.updateString(0, { od: 21 });   // survey:false
      c.updateStation(0, { dev: 15 }); // survey:true
    });
    expect(seen.map((i) => i.survey)).toEqual([false, true]);
    expect(c.undoDepth).toBe(1); // but one undo entry for the whole session
  });
});
