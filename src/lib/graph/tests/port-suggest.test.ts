/**
 * port-suggest.test.ts — the GENERATIVE typed-ports hook (#13, PR5).
 *
 * Covers the FIRST end-to-end pair: a `list<point>` expr output + a polygon with
 * an open points slot is a mechanical, type-compatible match. Mirrors the
 * expr-list.test.ts scaffold (newGraph / addExprDef / addExprInstance /
 * addPolygon / addPolygonExprListRef).
 */
import { describe, it, expect } from 'vitest';
import {
  newGraph,
  addExprDef, addExprInstance,
  addExprDefParam, setExprDefParamName,
  addExprDefOutput, setExprDefOutputName, setExprDefOutputFormula, setExprDefOutputShape,
  addPolygon, addPolygonExprListRef,
} from '$lib/graph/composition/composition-graph';
import {
  portTypeOfExprOutput,
  graphOutputs,
  openInputSlots,
  autoWireSuggestions,
} from '$lib/graph/port/port-suggest';

// ── portTypeOfExprOutput ──────────────────────────────────────────────────────

describe('portTypeOfExprOutput — expr output → registry PortType id', () => {
  it('maps a list<point> output to "list<point>"', () => {
    expect(portTypeOfExprOutput({ name: 'pts', formula: '', shape: 'list', elem: 'point' }))
      .toBe('list<point>');
  });

  it('maps a scalar output (no shape/elem) to "scalar"', () => {
    expect(portTypeOfExprOutput({ name: 'wall', formula: 'a-b' })).toBe('scalar');
  });
});

// ── a list<point> def + a polygon → ONE suggestion ────────────────────────────

/** Build a def with a single list<point> output named `out`, drop an instance,
 *  add an (empty) polygon. Returns { graph, exprId, polyId, outName }. */
function listPointGraph() {
  let graph = newGraph();
  const made = addExprDef(graph); graph = made.graph; const defId = made.id;
  graph = addExprDefParam(graph, defId); graph = setExprDefParamName(graph, defId, 0, 'NPts');
  graph = addExprDefOutput(graph, defId);
  graph = setExprDefOutputName(graph, defId, 0, 'profile_pts');
  graph = setExprDefOutputFormula(graph, defId, 0, 'map(range(0, NPts), f(i)=[i, i])');
  graph = setExprDefOutputShape(graph, defId, 0, 'list', 'point');

  const inst = addExprInstance(graph, defId); graph = inst.graph;
  const poly = addPolygon(graph, []); graph = poly.graph;
  return { graph, exprId: inst.id, polyId: poly.id, outName: 'profile_pts' };
}

describe('autoWireSuggestions — list<point> output → polygon points', () => {
  it('enumerates the typed output + the open polygon slot', () => {
    const { graph, exprId, polyId } = listPointGraph();

    const outs = graphOutputs(graph);
    expect(outs).toContainEqual({ nodeId: exprId, output: 'profile_pts', typeId: 'list<point>' });

    const slots = openInputSlots(graph);
    expect(slots).toContainEqual({ nodeId: polyId, slot: 'points', acceptsTypeId: 'list<point>' });
  });

  it('returns exactly one type-compatible suggestion', () => {
    const { graph, exprId, polyId, outName } = listPointGraph();
    const sug = autoWireSuggestions(graph);
    expect(sug).toEqual([
      { sourceId: exprId, output: outName, targetId: polyId, slot: 'points', typeId: 'list<point>' },
    ]);
  });

  it('drops the suggestion once the pair is already wired (no dup)', () => {
    let { graph, exprId, polyId, outName } = listPointGraph();
    graph = addPolygonExprListRef(graph, polyId, exprId, outName);
    expect(autoWireSuggestions(graph)).toEqual([]);
  });
});

// ── a scalar output never matches a polygon (canWire false) ───────────────────

describe('autoWireSuggestions — type filtering', () => {
  it('a scalar-output expr yields NO polygon suggestion (scalar ≠ list<point>)', () => {
    let graph = newGraph();
    const made = addExprDef(graph); graph = made.graph; const defId = made.id;
    graph = addExprDefOutput(graph, defId);
    graph = setExprDefOutputName(graph, defId, 0, 'wall');
    graph = setExprDefOutputFormula(graph, defId, 0, '1');
    // shape left default → scalar
    const inst = addExprInstance(graph, defId); graph = inst.graph;
    const poly = addPolygon(graph, []); graph = poly.graph;

    const outs = graphOutputs(graph);
    expect(outs).toContainEqual({ nodeId: inst.id, output: 'wall', typeId: 'scalar' });
    expect(autoWireSuggestions(graph)).toEqual([]);
  });
});
