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
  PolyRepeatNode, SketchNode, ArgValue, GraphExpr, ExprDef, ExprOut,
} from './composition-graph-types';
import { newNodeId, asLiteral } from './composition-graph-types';
import { setLayout, defaultCallPosition, collectEdges } from './composition-graph-mutate';
import { deriveInputNames } from './graph-exprs';

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

/** Capture (or clear) the editor's per-part VIEW scale on the graph, called at
 *  save time. When `manual` is true (the user set a scale — `scene.scaleAuto`
 *  is off) the z/x exaggeration is persisted so reopening the part restores it;
 *  when false (auto-normalized) the fields are DROPPED so the part re-auto-scales
 *  on the next open. VIEW-ONLY — never affects geometry or bake output. */
export function setViewScale(graph: Graph, z: number, x: number, manual: boolean): Graph {
  const { viewZScale: _z, viewXScale: _x, ...rest } = graph;
  if (!manual || !Number.isFinite(z) || !Number.isFinite(x)) return rest;
  return { ...rest, viewZScale: z, viewXScale: x };
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
      } else if (entry?.kind === 'expr-list-ref') {
        // #11 expression-as-builder — pass through unchanged.
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

  // Fold legacy Repeat single `child` → `children: [child]` (#repeat-enhance
  // 2026-06-17). Forward, one-way, lossless: pre-existing parts saved a single
  // `child` NodeId; new code reads `children[]`. A Repeat that already has a
  // `children` array is left as-is. The stray `child` field is dropped so it
  // can't drift out of sync with children[].
  for (const id of Object.keys(migratedNodes)) {
    const n = migratedNodes[id] as any;
    if (n?.type !== 'repeat') continue;
    if (!Array.isArray(n.children)) {
      const child = typeof n.child === 'string' ? n.child : '';
      n.children = child ? [child] : [];
    }
    if ('child' in n) delete n.child;
    migratedNodes[id] = n;
  }

  // Spline path producers (TODO #15) — defensive normalisation so a hand-edited
  // / partial file always has a well-formed control-point array + a samples
  // ArgValue (a bare number is lifted to a literal). Idempotent.
  for (const id of Object.keys(migratedNodes)) {
    const n = migratedNodes[id] as any;
    if (n?.type !== 'spline') continue;
    if (!Array.isArray(n.points)) n.points = [];
    n.points = n.points
      .filter((p: any) => Array.isArray(p))
      .map((p: any) => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
    if (n.samples == null) n.samples = { kind: 'literal', value: 32 };
    else if (typeof n.samples === 'number') n.samples = { kind: 'literal', value: n.samples };
    // `closed` normalises to a strict boolean; absent / falsy ⇒ false (an OPEN
    // curve, today's behaviour). The path producer owns loop-ness (auto-follow).
    n.closed = n.closed === true;
    // `pointsExpr` (TODO #26) — a WIRED control-points source. Keep it only when
    // it is a well-formed ArgValue (expr/param); anything else is dropped so the
    // node falls back to its manual `points`. Absent ⇒ manual (byte-identical).
    if (n.pointsExpr != null && !(n.pointsExpr?.kind === 'expr' || n.pointsExpr?.kind === 'param')) {
      delete n.pointsExpr;
    }
    // `plot` (TODO #24) — VIEW-ONLY diagnostic-overlay flag. Kept SPARSE: only a
    // strict-true value survives (absent ⇒ no overlay, byte-identical). Any
    // well-formed `#rrggbb` plotColor is kept; anything else is dropped.
    if (n.plot === true) n.plot = true; else delete n.plot;
    if (!(typeof n.plotColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(n.plotColor))) delete n.plotColor;
    migratedNodes[id] = n;
  }

  // Transforms are SEPARATE mv / rot cards (2026-07-01). The old fold that
  // migrated mv/rot → a unified `txfmn` (xform) card was REMOVED — it re-ran on
  // every load, so a saved mv reappeared as an xform card. mv/rot now stay as
  // they are; a rotate-then-translate reads as an mv whose child is a rot node
  // (two small chained cards). We also UNFOLD any legacy `txfmn` still in a
  // saved graph back into mv/rot so old parts convert too. emit handles
  // MvNode/RotNode directly.
  {
    const ns = migratedNodes as Record<string, any>;
    const isZero3 = (v: any): boolean =>
      Array.isArray(v) && v.every((c: any) => c?.kind === 'literal' && Number(c.value) === 0);
    for (const id of Object.keys(ns)) {
      const t = ns[id];
      if (!t || t.type !== 'txfmn') continue;
      const hasRot = !isZero3(t.rot);
      const hasMv = !isZero3(t.offset);
      if (hasRot && hasMv) {
        // Mixed txfmn = rotate-then-translate = mv(rot(child)). Split into an
        // mv (keeps this id so parent refs hold) wrapping a NEW rot node.
        const rotId = `${id}_rot`;
        ns[rotId] = { id: rotId, type: 'rot', child: t.child ?? null, rot: t.rot };
        ns[id] = { id, type: 'mv', child: rotId, offset: t.offset };
        const lay = migratedLayout[id];
        if (lay) migratedLayout[rotId] = { x: (lay.x ?? 0) - 60, y: lay.y ?? 0 };
      } else if (hasRot) {
        ns[id] = { id, type: 'rot', child: t.child ?? null, rot: t.rot };
      } else {
        ns[id] = { id, type: 'mv', child: t.child ?? null, offset: t.offset };
      }
    }
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
  // Editor VIEW scale (VIEW-ONLY). Sparse: restore only a finite positive
  // number so legacy files (+ auto-scaled parts, which never persist a value)
  // stay undefined → the editor auto-normalizes on open. Never touches
  // geometry/bake; only the PRIMARY-open-part load path reads these.
  const posNumOrUndef = (v: any) =>
    (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : undefined;
  const savedViewZScale = posNumOrUndef(serialised.viewZScale);
  const savedViewXScale = posNumOrUndef(serialised.viewXScale);
  // Render OPACITY (0–1, VIEW-ONLY). Sparse: restore only a finite value < 1 so
  // legacy/opaque files stay undefined (= fully opaque). Clamped to (0, 1].
  const opacityOrUndef = (v: any) =>
    (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1) ? v : undefined;
  const savedOpacity = opacityOrUndef((serialised as any).opacity);
  // Named material TEXTURE (G-MAT2, VIEW-ONLY). Sparse: restore only a non-empty
  // string so un-textured files stay undefined (= no map). Unknown names are
  // tolerated here (getMaterialTexture resolves them to undefined at render).
  const textureOrUndef = (v: any) =>
    (typeof v === 'string' && v.trim() && v.trim() !== 'none') ? v.trim() : undefined;
  const savedTexture = textureOrUndef((serialised as any).texture);
  // Per-part appearance overrides (sparse, keyed by node id). Sanitise each
  // entry's fields the same way as the part-level colours.
  const savedPartAppearance = (() => {
    const raw = (serialised as any).partAppearance;
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<string, any> = {};
    for (const [id, v] of Object.entries(raw as Record<string, any>)) {
      if (!v || typeof v !== 'object') continue;
      const e: any = {};
      const co = hexOrUndef(v.colorOuter); if (co) e.colorOuter = co;
      const ci = hexOrUndef(v.colorInner); if (ci) e.colorInner = ci;
      const m = typeof v.material === 'string' ? v.material.trim() : '';
      if (m && m !== 'none') e.material = m;
      if (typeof v.opacity === 'number' && Number.isFinite(v.opacity) && v.opacity > 0 && v.opacity < 1) e.opacity = v.opacity;
      const tx = textureOrUndef(v.texture); if (tx) e.texture = tx;
      if (Object.keys(e).length) out[id] = e;
    }
    return Object.keys(out).length ? out : undefined;
  })();
  // Calculated expressions (B.6 / id 914) — restore the sparse `exprs` array,
  // keeping only well-formed {name, src} string rows (defensive against hand-
  // edited / legacy files). Absent ⇒ undefined ⇒ emit byte-identical to today.
  const savedExprs: GraphExpr[] | undefined = (() => {
    const raw = (serialised as any).exprs;
    if (!Array.isArray(raw)) return undefined;
    const out: GraphExpr[] = [];
    for (const e of raw) {
      if (e && typeof e.name === 'string' && typeof e.src === 'string' && e.name.length) {
        out.push({ name: e.name, src: e.src });
      }
    }
    return out.length ? out : undefined;
  })();
  // Expression DEFINITIONS (B.7 / id 914 v3) — restore saved defs, then run the
  // one-way migrations (idempotent): a v2 `ExprNode{outputs,bindings}` (no
  // `defId`) synthesises a def (outputs = its outputs, params = the derived
  // inputs with no default, consts/vars empty) and is rewritten to an instance;
  // a v1 `graph.exprs[]` row becomes a single-output def (name-deduped so a
  // re-saved part doesn't duplicate). Absent everywhere ⇒ undefined ⇒
  // byte-identical emit.
  const savedExprDefs = ((): ExprDef[] => {
    const out: ExprDef[] = [];
    const raw = (serialised as any).exprDefs;
    if (!Array.isArray(raw)) return out;
    const str = (v: any) => (typeof v === 'string' ? v : '');
    const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    for (const d of raw) {
      if (!d || typeof d.id !== 'string' || typeof d.name !== 'string') continue;
      out.push({
        id: d.id,
        name: d.name,
        params: Array.isArray(d.params) ? d.params.filter((p: any) => p && str(p.name)).map((p: any) => {
          const def = num(p.default); return def == null ? { name: p.name } : { name: p.name, default: def };
        }) : [],
        consts: Array.isArray(d.consts) ? d.consts.filter((c: any) => c && str(c.name)).map((c: any) => ({ name: c.name, value: num(c.value) ?? 0 })) : [],
        vars: Array.isArray(d.vars) ? d.vars.filter((v: any) => v && str(v.name)).map((v: any) => ({ name: v.name, formula: str(v.formula) })) : [],
        outputs: Array.isArray(d.outputs) ? d.outputs.filter((o: any) => o && str(o.name)).map((o: any) => {
          // #11 expression-as-builder — preserve the sparse output SHAPE/ELEM
          // typing. Absent ⇒ scalar ⇒ byte-identical emit (no migration).
          const out: ExprOut = { name: o.name, formula: str(o.formula) };
          if (o.shape === 'list' || o.shape === 'object') out.shape = o.shape;
          if (out.shape === 'list' && typeof o.elem === 'string') out.elem = o.elem;
          return out;
        }) : [],
      });
    }
    return out;
  })();
  const exprDefsOut: ExprDef[] = [...savedExprDefs];
  const exprDefNameSet = new Set(exprDefsOut.map((d) => d.name));
  const uniqueDefName = (): string => {
    let k = exprDefsOut.length + 1;
    let name = `expr_${k}`;
    while (exprDefNameSet.has(name)) name = `expr_${++k}`;
    return name;
  };
  // v2 → v3: ExprNode{outputs,bindings} → ExprDef + instance{defId,bindings}.
  for (const id of Object.keys(migratedNodes)) {
    const n = migratedNodes[id] as any;
    if (!n || n.type !== 'expr') continue;
    if (typeof n.defId === 'string') continue; // already v3
    const outputs: ExprOut[] = Array.isArray(n.outputs)
      ? n.outputs.filter((o: any) => o && typeof o.name === 'string' && typeof o.formula === 'string')
          .map((o: any) => ({ name: o.name, formula: o.formula }))
      : [];
    const params = deriveInputNames(outputs).map((nm) => ({ name: nm }));
    const defId = newNodeId();
    const name = uniqueDefName();
    exprDefsOut.push({ id: defId, name, params, consts: [], vars: [], outputs });
    exprDefNameSet.add(name);
    const bindings = (n.bindings && typeof n.bindings === 'object' && Object.keys(n.bindings).length) ? n.bindings : undefined;
    migratedNodes[id] = { id, type: 'expr', defId, ...(bindings ? { bindings } : {}) } as GraphNode;
  }
  // v1 graph.exprs[] → one single-output def each (name-deduped, idempotent).
  // The legacy emit path (emitExprConsts) keeps driving geometry until re-save.
  if (savedExprs) {
    for (const e of savedExprs) {
      if (exprDefNameSet.has(e.name)) continue;
      exprDefsOut.push({ id: newNodeId(), name: e.name, params: [], consts: [], vars: [], outputs: [{ name: e.name, formula: e.src }] });
      exprDefNameSet.add(e.name);
    }
  }
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
    ...(savedOpacity != null ? { opacity: savedOpacity } : {}),
    ...(savedTexture ? { texture: savedTexture } : {}),
    ...(savedViewZScale != null ? { viewZScale: savedViewZScale } : {}),
    ...(savedViewXScale != null ? { viewXScale: savedViewXScale } : {}),
    ...(savedPartAppearance ? { partAppearance: savedPartAppearance } : {}),
    ...(savedExprs ? { exprs: savedExprs } : {}),
    ...(exprDefsOut.length ? { exprDefs: exprDefsOut } : {}),
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
    if ((n.type === 'mv' || n.type === 'rot' || n.type === 'txfmn') && n.child) {
      const child = g.nodes[n.child];
      if (child?.type === 'call') continue; // inline wrapper, no own card
    }
    g = setLayout(g, id, defaultCallPosition(g));
  }
  g = { ...g, edges: collectEdges(g) };
  return g;
}
