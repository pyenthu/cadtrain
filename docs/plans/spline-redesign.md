# Plan: Redesign the SPLINE operator as a single grouped, endpoint-relative entity

> Produced 2026-06-13 by a planning subagent. Extends `docs/plans/profile-sketcher.md`
> (bundle M). Goal from the user: a spline = a *group* of through-points edited
> as one spline, with internal control points stored RELATIVE to the endpoints
> so they parametrize. No backward-compat constraint.

## 0. Current state (what we're replacing)

A spline today is an *edge*, not an entity. `sketch.ts` op: `{ op:'spline'; r; z; ctrl? }`
— the segment from the *previous* vertex to this op's `(r,z)`, with optional
**absolute** `ctrl` points, else an auto Catmull-Rom tangent. Graph mirror in
`composition-graph.ts` (~line 179). Problems: to draw a curve through N points
you add N ops; `ctrl` is absolute (doesn't move with endpoints, doesn't
parametrize); sketch op coords are NOT in `collectEdges`/`validateGraph`, so
wiring `p.x` into a spline coord silently produces no edge. No saved file sets
`ctrl`, so migration cost ≈ 0.

## 1. Data model — one `spline` op with a `pts[]` group + relative end-handles `h0/h1` in the chord-affine frame

A spline keeps "reaches `(r,z)`" (end endpoint; start = preceding vertex) and adds:
- `pts[]` — ordered through-points, **chord-relative** `(u,v)`.
- `h0`, `h1` — optional end tangent handles, chord-relative, off the start/end.

Chord frame: with start `a`, end `b`, `d=b−a`, `(u,v) → abs = a + u·d + v·rot90(d)`,
`rot90([dx,dy])=[−dy,dx]`. `u`≈0..1 along the chord, `v` = perpendicular bulge as
a fraction of chord length. Move/rotate/scale an endpoint → the curve follows;
wire `p.bulge` into a `v` and the curve bows proportionally.

Graph type (replaces composition-graph.ts ~179):
```ts
| { op:'spline'; r:ArgValue; z:ArgValue;
    pts?: Array<[ArgValue, ArgValue]>;   // through-points, chord-relative (u,v)
    h0?: [ArgValue, ArgValue];           // start tangent handle, chord-relative
    h1?: [ArgValue, ArgValue]; }         // end tangent handle, chord-relative
```
Engine numeric mirror (sketch.ts ~22): same with `number` instead of `ArgValue`.
EVERY component is an ArgValue (r, z, each pts[k][0/1], h0/h1[0/1]) → param-wireable.

**Rejected option:** per-through-point handles (full illustrator path) — doubles
the data + ArgValue slots, needs a heavier editor, and doesn't map onto a single
`bulge` param. Interior tangents are better auto-derived (Catmull-Rom); only the
two ENDS expose handles. Additive later if true per-knot control is needed.

## 2. Engine (`compileSketch`, sketch.ts)
- `toVerts`: a spline stays ONE vertex at `(r,z)`, carrying `pts/h0/h1` on `Vert`
  (replace `ctrl`). Through-points are NOT vertices — they live inside the edge.
  Fillet/chamfer (vertex-level) untouched; splines stay non-filletable.
- Add frame helpers `chordToAbs(a,b,u,v)` and `absToChord(a,b,p)` (inverse, for
  drag→(u,v)) near the vector utils.
- Rewrite the spline branch: knot seq `K=[a, ...pts.map(chordToAbs), b]`; each
  sub-segment `K[k]→K[k+1]` → cubic via the existing Catmull-Rom tangents (ends
  clamped to a/b neighbours). End-handle override: `h0` → first sub-seg `c1`,
  `h1` → last sub-seg `c2`; absent → auto tangent (migrated plain spline is
  geometry-identical). Emit each cubic as a `makerjs.models.BezierCurve`.
  Shared endpoints → `findSingleChain`/`toKeyPoints` still walks one chain;
  determinism + `segments` dial unchanged; downstream bake untouched.

## 3. Graph helpers / edges / validation
- New helpers (finalize-wrapped): `addSketchSplinePoint`, `setSketchSplinePoint`
  (axis 'u'|'v'), `removeSketchSplinePoint`, `setSketchSplineHandle`
  (which 'h0'|'h1'), `clearSketchSplineHandle`. `setSketchOpKind` line→spline
  preserves r/z + no pts/h0/h1; spline→line drops them.
- **collectEdges (composition-graph.ts ~427): add a `sketch` case** (missing
  today) emitting param edges per component: `…ops.i.r/.z`, `…ops.i.pts.k.u/.v`,
  `…ops.i.h0.u`, etc.
- **validateGraph (composition-emit.ts ~94): add a `sketch` case** mirroring the
  polygon path so a wired-then-deleted param surfaces as `missing-param`. Both
  are pure additions — do in Phase 1.

## 4. Emit (composition-emit.ts ~415)
Serialize group + handles instead of `ctrl`:
`{ op:'spline', r:…, z:…, pts:[[u,v],…], h0:[…], h1:[…] }`. Runtime stays
`sketch([...ops], seg)` → compileSketch consumes numeric pts/h0/h1. `__POLY__`
substitution + consumed-set unaffected.

## 5. Migration (no back-compat)
In `hydrateGraph` (alongside the polygon migration), one-shot over `sketch`
nodes: legacy absolute `ctrl` → chord-relative through-points via
`absToChord(prevPt,[r,z],ctrlPt)` → `pts`; drop `ctrl`. Plain splines (no `ctrl`,
the common case) unchanged — engine's no-handle path reproduces today's geometry.

## 6. Editor UX (GraphEditorPane.svelte)
**6a. Full-tab — spline as one entity.** `sketchEditor` derived: map evaluated
`pts/h0/h1` (replace `ctrl`). Endpoint anchor unchanged (one anchor at r,z) —
already "edited as a single spline." Add `selectedSplineOpIdx` (parallel to
`selectedCornerOpIdx`); selecting a spline anchor renders draggable through-point
dots at `chordToAbs(a,b,u,v)` + end-handle dots at `a+h0`/`b+h1` with handle
lines. Drag → `absToChord` → write literals via the new helpers. Toolbar (the
floating bar) gets `+pt`/`−pt`/`auto tangent` when a spline is selected; extend
the PARAMS aside's `bindCornerParam` into a generic "bind selected component".

**6b. Inline card — grouped list + per-component sockets.** Beneath the r/z
endpoint inputs, a nested through-point list + the two handle rows, each an
editable `ge-sketch-in` (argStr/argFrom). Mirror the **polygon per-coord socket**
pattern (`ge-sock in poly-coord` + `endWireOnPolygonCoord`): left-edge SVG
sockets per component with `endWireOnSplineCoord` handlers calling the matching
setter with `asParam(...)`. Reuse `polyRowTop`-style cumulative Y; bump the
sketch `nodeSize` row height.

## 7. Tests (sketch.test.ts)
1. through-point bows the curve; 2. relative points scale with the endpoint
(b vs 2·b → proportional bulge); 3. endpoint rotation carries the bulge onto the
rotated perpendicular; 4. end handle controls the end tangent; 5. auto-smooth
parity (no pts/h0/h1 == pre-redesign geometry); 6. a `pts` component wired
`kind:'param'` appears in collectEdges, round-trips, and validateGraph flags it
when the param is deleted.

## 8. Phasing
- **Phase 1 — model + engine + emit + edges/validation + migration + tests**
  (no new UI; endpoint drag still works, through-points just not draggable yet).
  Verify: vitest green; existing sketch parts bake identically.
- **Phase 2 — full-tab entity editing** (through-point + relative end-handle
  dots, drag, +pt/−pt/auto-tangent, bind-component-to-param).
- **Phase 3 — inline card grouping + per-component wire sockets**
  (`endWireOnSplineCoord`, nodeSize bump). Independent of Phase 2.

NOTE (2026-06-13): the inline-card per-coord wire sockets (Phase 3 groundwork)
are being built first as a standalone change for LINE/fillet/chamfer coords
(`endWireOnSketchCoord`, `sketchRowTop`/`sketchSock*`), per a separate user
request; the spline through-point sockets extend that.
