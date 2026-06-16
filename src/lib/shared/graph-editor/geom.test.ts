import { describe, it, expect } from 'vitest';
import {
  polyEntryH, polyRowTop, polySockR, polySockZ, polySockRef,
  sketchRowTop, sketchSockR, sketchSockZ, sketchSockVal,
  entryIdxForEvalIdx, nodeSize, cardMinWidth, chipWidthFor, paramCardSize, paramPos,
  inlineXformStrip, inlineXformSocket, inlineXformOutput,
  attachedTransforms, transformBaseCall, transformChainBase, isAttachedTransform,
  xformStripAt, xformOutputAt, xformArrows,
  STRIP_W, STRIP_H, STRIP_TOP, PARAM_H, CARD_PAD, CARD_TITLE_H, POLY_VTX_PITCH, POLY_RREF_PITCH,
} from './geom';
import type { Graph } from './composition-graph';

// These tests PIN the socket↔DOM row-height contract that the whole editor's
// SVG-socket / HTML-row alignment depends on (modularize plan §5/§6). The
// constants here mirror the CSS row pitches; a row-height change must update
// both the geom math AND this test in lockstep.

describe('polygon row geometry', () => {
  const node = {
    id: 'p', type: 'polygon',
    points: [{ kind: 'point' }, { kind: 'repeat-ref', sourceId: 'pr' }, { kind: 'point' }],
  };

  it('polyEntryH returns the per-kind row pitch', () => {
    expect(polyEntryH({ kind: 'point' })).toBe(POLY_VTX_PITCH);   // 45
    expect(polyEntryH({ kind: 'repeat-ref' })).toBe(POLY_RREF_PITCH); // 38
    expect(polyEntryH({ kind: 'repeat' })).toBe(74);
  });

  it('polyRowTop is a cumulative walk from the 36px header offset', () => {
    expect(polyRowTop(node, 0)).toBe(36);
    expect(polyRowTop(node, 1)).toBe(36 + POLY_VTX_PITCH);            // 81
    expect(polyRowTop(node, 2)).toBe(36 + POLY_VTX_PITCH + POLY_RREF_PITCH); // 119
  });

  it('polySock* sit at fixed offsets inside each row (12 / 31 / 18)', () => {
    for (const i of [0, 1, 2]) {
      const top = polyRowTop(node, i);
      expect(polySockR(node, i) - top).toBe(12);
      expect(polySockZ(node, i) - top).toBe(31);
      expect(polySockRef(node, i) - top).toBe(18);
    }
  });
});

describe('sketch row geometry (cols=1, single-column walk)', () => {
  // line op = two stacked sub-rows (r over z); the socket offsets must match
  // the polygon vertex (12 / 31), and the value socket sits at 12.
  const node = { id: 's', type: 'sketch', ops: [{ kind: 'line', r: 1, z: 1 }, { kind: 'line', r: 2, z: 2 }] };

  it('sketchSock* sit at fixed offsets relative to the row top', () => {
    for (const i of [0, 1]) {
      const top = sketchRowTop(node, i, 1);
      expect(sketchSockR(node, i, 1) - top).toBe(12);
      expect(sketchSockZ(node, i, 1) - top).toBe(31);
      expect(sketchSockVal(node, i, 1) - top).toBe(12);
    }
  });

  it('first row top is the 36px header offset', () => {
    expect(sketchRowTop(node, 0, 1)).toBe(36);
  });
});

describe('entryIdxForEvalIdx (entry-idx vs eval-idx gotcha)', () => {
  // memory `entry_idx_eval_idx_gotcha`: literal vertices accept a UI insert
  // (return their entry index); points inside a repeat expansion return null.
  const repeatGraph = {
    nodes: {
      poly: {
        id: 'poly', type: 'polygon',
        points: [
          { kind: 'point' },                                  // eval idx 0
          { kind: 'repeat', count: { kind: 'literal', value: 3 } }, // eval idx 1,2,3
          { kind: 'point' },                                  // eval idx 4
        ],
      },
    },
  } as unknown as Graph;

  it('maps literal vertices back to their entry index', () => {
    const poly = (repeatGraph as any).nodes.poly;
    expect(entryIdxForEvalIdx(repeatGraph, poly, 0)).toBe(0);
    expect(entryIdxForEvalIdx(repeatGraph, poly, 4)).toBe(2);
  });

  it('returns null for eval indices inside a repeat expansion', () => {
    const poly = (repeatGraph as any).nodes.poly;
    expect(entryIdxForEvalIdx(repeatGraph, poly, 1)).toBeNull();
    expect(entryIdxForEvalIdx(repeatGraph, poly, 2)).toBeNull();
    expect(entryIdxForEvalIdx(repeatGraph, poly, 3)).toBeNull();
  });

  it('repeat-ref spans resolve via the referenced poly_repeat count', () => {
    const refGraph = {
      nodes: {
        poly: { id: 'poly', type: 'polygon', points: [{ kind: 'repeat-ref', sourceId: 'pr' }] },
        pr: { id: 'pr', type: 'poly_repeat', count: { kind: 'literal', value: 2 } },
      },
    } as unknown as Graph;
    const poly = (refGraph as any).nodes.poly;
    // both expanded points fall inside the repeat-ref expansion → null
    expect(entryIdxForEvalIdx(refGraph, poly, 0)).toBeNull();
    expect(entryIdxForEvalIdx(refGraph, poly, 1)).toBeNull();
  });
});

describe('card sizing', () => {
  const graph = { nodes: {}, layout: {}, params: {} } as unknown as Graph;

  it('nodeSize clamps to the per-type minimum width', () => {
    const method = nodeSize(graph, { id: 'm', type: 'method' });
    expect(method.w).toBeGreaterThanOrEqual(cardMinWidth({ type: 'method' }));
    expect(method.h).toBe(64);
  });

  it('a call card height grows 22px per arg (above the 80px floor)', () => {
    const twoArgs = nodeSize(graph, { id: 'c', type: 'call', args: { a: 1, b: 2 } });
    const threeArgs = nodeSize(graph, { id: 'c', type: 'call', args: { a: 1, b: 2, c: 3 } });
    expect(twoArgs.h).toBe(50 + 2 * 22);   // 94, above the 80px floor
    expect(threeArgs.h - twoArgs.h).toBe(22);
  });

  it('chipWidthFor + paramCardSize + paramPos agree on the chip pitch', () => {
    const chipW = chipWidthFor(8);
    const card = paramCardSize(3, chipW);
    expect(card.w).toBe(CARD_PAD * 2 + chipW);
    // chip i+1 sits one (PARAM_H + gap) pitch below chip i
    const y0 = paramPos(0, 'a', 0).y;
    const y1 = paramPos(0, 'b', 1).y;
    expect(y1 - y0).toBe(PARAM_H + 2);
    expect(y0).toBe(0 + CARD_TITLE_H + CARD_PAD); // cardY0 = 0 in this call
  });
});

describe('inline mv/rot strip + output socket consistency', () => {
  // A call wrapped by an inline rot transform, sitting inside the root list so
  // inlineTransformOf recognises it as inline. The output socket and the row-0
  // strip sockets must stay in lockstep (the "connector disconnects" bug).
  const graph = {
    root: 'root',
    nodes: {
      root: { id: 'root', type: 'list', children: ['r'] },
      r: { id: 'r', type: 'rot', child: 'c', rot: [] },
      c: { id: 'c', type: 'call', src: 'x', args: {} },
    },
    layout: { c: { x: 100, y: 50 } },
    params: {},
  } as unknown as Graph;

  it('row-0 axis sockets sit on the strip top edge', () => {
    const strip = inlineXformStrip(graph, 'c', 'rot')!;
    expect(strip).not.toBeNull();
    expect(strip.row).toBe(0);
    const sock = inlineXformSocket(graph, 'c', 'rot', 0)!;
    expect(sock.y).toBe(strip.y); // top edge for row 0
  });

  it('single-transform output sits at the strip cluster right edge, mid-strip', () => {
    const strip = inlineXformStrip(graph, 'c', 'rot')!;
    const out = inlineXformOutput(graph, 'c');
    expect(out.x).toBe(strip.x + STRIP_W);
    expect(out.y).toBe(STRIP_TOP + STRIP_H / 2);
  });
});

describe('transform CHAIN walk (standalone mv/rot auto-attach)', () => {
  // A standalone mv whose `.child` is a Call resolves to that Call.
  it('a standalone mv whose child is a Call resolves to that Call', () => {
    const g = {
      root: 'root',
      nodes: {
        root: { id: 'root', type: 'list', children: ['m'] },
        m: { id: 'm', type: 'mv', child: 'c', offset: [] },
        c: { id: 'c', type: 'call', src: 'x', args: {} },
      },
      layout: { c: { x: 0, y: 0 } },
      params: {},
    } as unknown as Graph;
    expect(transformChainBase(g, 'm')).toBe('c');
    expect(transformBaseCall(g, 'm')).toEqual({ callId: 'c', chain: ['m'] });
    expect(attachedTransforms(g, 'c')).toEqual(['m']);
    expect(isAttachedTransform(g, 'm')).toBe(true);
  });

  // A rot→mv chain on a Call lists BOTH transforms, nearest-call-first.
  // Wiring: container → mv → rot → call  (rot.child=call, mv.child=rot), so the
  // transform nearest the Call (rot) comes first, its wrapper (mv) second.
  it('a chain rot→mv on a Call lists both in chain order', () => {
    const g = {
      root: 'root',
      nodes: {
        root: { id: 'root', type: 'list', children: ['m'] },
        m: { id: 'm', type: 'mv', child: 'r', offset: [] },
        r: { id: 'r', type: 'rot', child: 'c', rot: [] },
        c: { id: 'c', type: 'call', src: 'x', args: {} },
      },
      layout: { c: { x: 0, y: 0 } },
      params: {},
    } as unknown as Graph;
    expect(attachedTransforms(g, 'c')).toEqual(['r', 'm']);
    // both transforms see the same base Call + full chain
    expect(transformBaseCall(g, 'm')).toEqual({ callId: 'c', chain: ['r', 'm'] });
    expect(transformBaseCall(g, 'r')).toEqual({ callId: 'c', chain: ['r', 'm'] });
    // strips cascade: rot index 0 (row 0), mv index 1 (row 1, same column)
    expect(xformStripAt(g, 'c', 0).row).toBe(0);
    expect(xformStripAt(g, 'c', 1).row).toBe(1);
    // output socket clears 1 column (2 strips → 1 col)
    const out = xformOutputAt(g, 'c');
    expect(out.x).toBe(xformStripAt(g, 'c', 0).x + STRIP_W);
    // sequence arrows connect card → strip0 → strip1 → output
    expect(xformArrows(g, 'c').length).toBeGreaterThanOrEqual(3);
  });

  // A mv wrapping a Method (not a Call) stays a normal card → null.
  it('a mv wrapping a Method resolves to null', () => {
    const g = {
      root: 'root',
      nodes: {
        root: { id: 'root', type: 'list', children: ['m'] },
        m: { id: 'm', type: 'mv', child: 'meth', offset: [] },
        meth: { id: 'meth', type: 'method', op: 'subtract', obj: 'a', arg: 'b' },
      },
      layout: {},
      params: {},
    } as unknown as Graph;
    expect(transformChainBase(g, 'm')).toBe('meth');
    expect(transformBaseCall(g, 'm')).toBeNull();
    expect(isAttachedTransform(g, 'm')).toBe(false);
    expect(attachedTransforms(g, 'meth')).toEqual([]);
  });
});
