/**
 * composition-graph-hydrate.ts — graph constructors + the serialise→Graph
 * inverse (+ legacy migrations).
 *
 * `newGraph` / `setViewport` / `hydrateGraph` live here. Depends on the leaf
 * types module plus a few mutators (setLayout / defaultCallPosition /
 * collectEdges) from composition-graph-mutate. Re-exported by the
 * composition-graph.ts barrel.
 */

// Chord-affine inverse, used by the spline `ctrl`→`pts` migration in
// hydrateGraph (absolute legacy control points → chord-relative through-points).
import { absToChord } from './sketch';

import type {
  Graph, GraphNode, ContainerNode, LayoutXY, Viewport, PolygonNode, PolygonEntry,
  PolyRepeatNode, SketchNode, ArgValue,
} from './composition-graph-types';
import { newNodeId, asLiteral } from './composition-graph-types';
import { setLayout, defaultCallPosition, collectEdges } from './composition-graph-mutate';

export function newGraph(): Graph {
  const rootId = newNodeId();
  const rootNode: ContainerNode = { id: rootId, type: 'list', children: [] };
  // Default root layout — sits to the RIGHT of where new Calls land
  // (defaultCallPosition starts at x=80), so the visible ▶ Output card
  // is downstream of the workflow. Pure presentational; the user can
  // drag it anywhere afterward.
  return {
    nodes: { [rootId]: rootNode },
    root: rootId,
    params: {},
    edges: [],
    imports: [],
    layout: { [rootId]: { x: 600, y: 80 } },
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
  };
}

/** Update the canvas viewport (pan + zoom). Called from the editor at save
 *  time so the next hydrate restores the same view region. */
export function setViewport(graph: Graph, pan: LayoutXY, zoom: number): Graph {
  return { ...graph, viewport: { pan: { ...pan }, zoom } };
}

/** Hydrate a serialised meta.graph block back into a runnable Graph.
 *
 *  serialiseGraph(g) drops `edges` (rebuildable from args) and `layout`
 *  (a visual concern, not part of the contract). This inverse rebuilds
 *  both — edges via collectEdges, layout via a default rough-grid pass
 *  so a loaded assembly has its nodes visible immediately even though
 *  the user never positioned them on this client.
 *
 *  Tolerant of partial data (returns newGraph() on missing/invalid
 *  nodes/root) so legacy or hand-edited sources fall through gracefully
 *  to the empty-canvas state. */
export function hydrateGraph(serialised: any): Graph {
  if (!serialised || typeof serialised !== 'object' || !serialised.nodes || !serialised.root) {
    return newGraph();
  }
  // Use the SAVED layout when present (any value, even partial — the loop
  // below fills only the holes). Older files saved before composition-emit
  // started preserving layout will have it undefined; those nodes still
  // get the default-grid auto-layout, so legacy files open cleanly.
  const savedLayout =
    (serialised.layout && typeof serialised.layout === 'object') ? { ...serialised.layout } : {};
  // Hydrate viewport too. Default falls back to (0, 0, zoom=1) — same as
  // newGraph() — so files saved before viewport landed open at the origin
  // view, preserving the prior behavior.
  const savedViewport: Viewport =
    (serialised.viewport && typeof serialised.viewport === 'object' &&
     serialised.viewport.pan && typeof serialised.viewport.zoom === 'number')
      ? { pan: { x: Number(serialised.viewport.pan.x) || 0, y: Number(serialised.viewport.pan.y) || 0 },
          zoom: Number(serialised.viewport.zoom) || 1 }
      : { pan: { x: 0, y: 0 }, zoom: 1 };
  // Migrate legacy inline {kind:'repeat'} polygon entries (Phase B / #154)
  // into the new separate-card model (#157): create a PolyRepeatNode per
  // inline repeat + replace the entry with a {kind:'repeat-ref', sourceId}.
  // Round-tripping a pre-#157 file no longer loses the loop data.
  const migratedNodes: Record<string, GraphNode> = { ...(serialised.nodes ?? {}) };
  const migratedLayout: Record<string, LayoutXY> = { ...savedLayout };
  for (const id of Object.keys(migratedNodes)) {
    const n = migratedNodes[id];
    if (!n || (n as any).type !== 'polygon') continue;
    const poly = n as PolygonNode;
    const newEntries: PolygonEntry[] = [];
    let migratedAny = false;
    for (const entry of (poly.points as any[])) {
      if (entry?.kind === 'repeat') {
        // Allocate a new PolyRepeatNode; preserve count/loopVar/r/z.
        const repeatId = newNodeId();
        const repeatNode: PolyRepeatNode = {
          id: repeatId,
          type: 'poly_repeat',
          count: entry.count,
          loopVar: String(entry.loopVar || 'i'),
          r: entry.r,
          z: entry.z,
        };
        migratedNodes[repeatId] = repeatNode;
        // Layout — sits to the right of the polygon if its position is
        // known, otherwise gets a default slot. The pass below filling
        // missing positions will also catch the edge cases.
        const polyXY = migratedLayout[id];
        if (polyXY) migratedLayout[repeatId] = { x: polyXY.x + 280, y: polyXY.y + 40 };
        newEntries.push({ kind: 'repeat-ref', sourceId: repeatId });
        migratedAny = true;
      } else if (entry?.kind === 'point') {
        newEntries.push(entry);
      } else if (entry?.kind === 'repeat-ref') {
        newEntries.push(entry);
      } else {
        // Untagged legacy point (pre-#154 entries with no kind).
        newEntries.push({ kind: 'point', r: entry.r, z: entry.z });
      }
    }
    if (migratedAny) {
      migratedNodes[id] = { ...poly, points: newEntries };
    }
  }

  // Migrate legacy ABSOLUTE spline `ctrl` points → chord-relative `pts`
  // (the redesign, 2026-06-13). A pre-redesign spline op carried `ctrl` as
  // absolute (r,z) control points off the chord; convert each via absToChord
  // against the chord [prev vertex → this op's (r,z)] so it now parametrises
  // with the endpoints. Plain splines (no `ctrl`, the common case) are left
  // untouched — the engine's no-handle path reproduces today's geometry. Only
  // literal coords convert cleanly; a non-literal endpoint/ctrl just drops the
  // stale `ctrl` (no saved file sets it, so this is defensive).
  const litNum = (v: any): number =>
    (v && v.kind === 'literal' && typeof v.value === 'number') ? v.value : NaN;
  const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
  for (const id of Object.keys(migratedNodes)) {
    const n = migratedNodes[id];
    if (!n || (n as any).type !== 'sketch') continue;
    const sk = n as SketchNode;
    let changed = false;
    let prevPt: [number, number] | null = null;
    const newOps = sk.ops.map((op: any) => {
      if (op.op !== 'line' && op.op !== 'spline') return op; // fillet/chamfer carry no point
      const cur: [number, number] = [litNum(op.r), litNum(op.z)];
      if (op.op === 'spline' && 'ctrl' in op) {
        const { ctrl, ...rest } = op;
        changed = true;
        if (Array.isArray(ctrl) && ctrl.length && prevPt &&
            Number.isFinite(cur[0]) && Number.isFinite(cur[1]) &&
            Number.isFinite(prevPt[0]) && Number.isFinite(prevPt[1])) {
          const a = prevPt, b = cur;
          const pts = ctrl
            .map((c: any) => [litNum(c[0]), litNum(c[1])] as [number, number])
            .filter((abs) => Number.isFinite(abs[0]) && Number.isFinite(abs[1]))
            .map((abs) => {
              const [u, v] = absToChord(a, b, abs);
              return [asLiteral(round6(u)), asLiteral(round6(v))] as [ArgValue, ArgValue];
            });
          prevPt = cur;
          return pts.length ? { ...rest, pts } : rest;
        }
        prevPt = cur;
        return rest; // unconvertible — just drop the stale ctrl
      }
      prevPt = cur;
      return op;
    });
    if (changed) migratedNodes[id] = { ...sk, ops: newOps };
  }

  // Part-level appearance round-trips through the serialised graph block.
  // Sparse: only attach when present + well-formed so legacy files stay
  // undefined (= unset → default appearance).
  const hexOrUndef = (v: any) =>
    (typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim()))
      ? v.trim().toLowerCase()
      : undefined;
  // Back-compat: a legacy single `color` migrates to `colorOuter` (an explicit
  // `colorOuter` wins if both somehow exist).
  const savedColorOuter = hexOrUndef(serialised.colorOuter) ?? hexOrUndef(serialised.color);
  const savedColorInner = hexOrUndef(serialised.colorInner);
  const savedMaterial =
    (typeof serialised.material === 'string' && serialised.material.trim() &&
     serialised.material.trim() !== 'none')
      ? serialised.material.trim()
      : undefined;
  let g: Graph = {
    nodes: migratedNodes,
    root: serialised.root,
    params: serialised.params ?? {},
    edges: [],
    imports: serialised.imports ?? [],
    layout: migratedLayout,
    viewport: savedViewport,
    ...(savedColorOuter ? { colorOuter: savedColorOuter } : {}),
    ...(savedColorInner ? { colorInner: savedColorInner } : {}),
    ...(savedMaterial ? { material: savedMaterial } : {}),
  };
  // Fill missing positions only — preserves any saved entry, populates the
  // rest via the same rough-grid heuristic used at create-time. Inline
  // mv/rot wrappers don't render on the main canvas (they surface inside
  // their child Call), so they don't need a layout slot.
  for (const id of Object.keys(g.nodes)) {
    if (g.layout[id]) continue; // already saved — keep it
    const n = g.nodes[id];
    if (id === g.root) {
      // Root list — visible as the ▶ Output card. Default to the right side
      // so it's downstream of new Calls (matches newGraph()).
      g = setLayout(g, id, { x: 600, y: 80 });
      continue;
    }
    if (n.type === 'list') continue;
    if ((n.type === 'mv' || n.type === 'rot') && n.child) {
      const child = g.nodes[n.child];
      if (child?.type === 'call') continue; // inline wrapper, no own card
    }
    g = setLayout(g, id, defaultCallPosition(g));
  }
  g = { ...g, edges: collectEdges(g) };
  return g;
}
