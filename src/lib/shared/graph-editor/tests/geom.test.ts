import { describe, it, expect } from 'vitest';
import {
  polyEntryH, polyRowTop, polySockR, polySockZ, polySockRef,
  sketchRowTop, sketchSockR, sketchSockZ, sketchSockVal,
  entryIdxForEvalIdx, nodeSize, cardMinWidth, chipWidthFor, paramCardSize, paramPos,
  nodePos, outputSocketAt, inputSocketAt,
  exprRowTop, exprInputSockY, exprOutputSockY, EXPR_BODY_TOP, EXPR_ROW_H,
  PARAM_H, CARD_PAD, CARD_TITLE_H, POLY_VTX_PITCH, POLY_RREF_PITCH,
} from '../geom';
import type { Graph } from '../composition-graph';

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

describe('expr block socket geometry (B.7 v2)', () => {
  // Input sockets (left edge) + output sockets (right edge) share ONE row
  // pitch so a left/right pair on the same visual row line up; indices are
  // independent (different counts). nodeSize must size to the taller column.
  it('rows are a cumulative walk from EXPR_BODY_TOP at EXPR_ROW_H pitch', () => {
    expect(exprRowTop(0)).toBe(EXPR_BODY_TOP);
    expect(exprRowTop(1)).toBe(EXPR_BODY_TOP + EXPR_ROW_H);
    expect(exprRowTop(2)).toBe(EXPR_BODY_TOP + 2 * EXPR_ROW_H);
  });

  it('input + output sockets centre on their row (line-aligned outputs)', () => {
    for (const i of [0, 1, 2]) {
      expect(exprInputSockY(i) - exprRowTop(i)).toBe(EXPR_ROW_H / 2);
      expect(exprOutputSockY(i) - exprRowTop(i)).toBe(EXPR_ROW_H / 2);
      expect(exprInputSockY(i)).toBe(exprOutputSockY(i));
    }
  });

  it('nodeSize height grows with the TALLER of {def.params, def.outputs}', () => {
    // v3: the instance reads THROUGH its def — 3 params, 1 output ⇒ 3 rows tall.
    const def = { id: 'd', name: 'x', params: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], consts: [], vars: [], outputs: [{ name: 'out', formula: 'a + b + c' }] };
    const node = { id: 'e', type: 'expr', defId: 'd' };
    const g = { nodes: { e: node }, layout: {}, params: {}, exprDefs: [def] } as unknown as Graph;
    const { h } = nodeSize(g, node as any);
    expect(h).toBe(EXPR_BODY_TOP + 3 * EXPR_ROW_H + 30);
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

  it('a CSG method renders as a fixed compact circle (40×40)', () => {
    // CSG subtract/add/intersect is a compact circle operator, not a card —
    // fixed size, ignores auto/min width.
    const method = nodeSize(graph, { id: 'm', type: 'method' });
    expect(method.w).toBe(40);
    expect(method.h).toBe(40);
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

describe('mv/rot are STANDALONE chainable icon nodes (#25)', () => {
  // rot(call): rot.child = c (a Call). The transform renders as its own icon;
  // its output is its own right edge, and it auto-places offset from its child
  // when it lacks a persisted layout slot.
  const graph = {
    root: 'root',
    nodes: {
      root: { id: 'root', type: 'list', children: ['r'] },
      r: { id: 'r', type: 'rot', child: 'c', rot: [] },
      c: { id: 'c', type: 'call', src: 'x', args: {} },
    },
    layout: { c: { x: 100, y: 50 } }, // only the Call has a slot
    params: {},
  } as unknown as Graph;

  it('the transform output sits on its OWN right edge (not on the Call)', () => {
    const size = nodeSize(graph, graph.nodes.r);   // {40,40} icon
    const pos = nodePos(graph, 'r');               // auto-placed
    const out = outputSocketAt(graph, 'r');
    expect(out).toEqual({ x: pos.x + size.w, y: pos.y + size.h / 2 });
  });

  it('a layout-less mv/rot AUTO-PLACES offset to the right of its child', () => {
    const cp = nodePos(graph, 'c');                // {100,50}
    const cs = nodeSize(graph, graph.nodes.c);
    const rp = nodePos(graph, 'r');
    expect(rp).toEqual({ x: cp.x + cs.w + 60, y: cp.y });
  });

  it('a persisted layout slot wins over the auto-place fallback', () => {
    const g2 = { ...graph, layout: { ...graph.layout, r: { x: 5, y: 7 } } } as unknown as Graph;
    expect(nodePos(g2, 'r')).toEqual({ x: 5, y: 7 });
  });

  it('the child input socket is on the transform icon LEFT edge', () => {
    const size = nodeSize(graph, graph.nodes.r);
    const pos = nodePos(graph, 'r');
    const tgt = inputSocketAt(graph, 'r', 'child');
    expect(tgt).toEqual({ x: pos.x, y: pos.y + size.h / 2 });
  });

  it('a rot→mv chain auto-places each transform, cascading right', () => {
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
    const rp = nodePos(g, 'r');
    const mp = nodePos(g, 'm');
    expect(rp.x).toBeGreaterThan(nodePos(g, 'c').x);   // r right of c
    expect(mp.x).toBeGreaterThan(rp.x);                // m right of r
  });
});
