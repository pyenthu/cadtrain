# Compact CSG node (⊖ / ⊕ / ⊗)

## The ask (2026-06-17) — VISUAL ONLY
The CSG **Container** node (`op: 'subtract' | 'add' | 'intersect'`) currently
renders as a full card — too much space. Render it instead as a **compact circular
operator** that you **WIRE INTO** (like a transform node — A and B are wired in,
NOT held inside the card):
- a small **circle** with the op glyph (**−** subtract · **+** add · **×** intersect),
- **two input sockets**: **A on top, B on bottom** (drag a node's output → these),
- **one output socket** (right),
- semantics: **A − B** (top minus bottom) for subtract; order matters.

**Model unchanged.** This is purely a render/interaction change — the Container
keeps `op` + `children[]` (A = children[0], B = children[1]); wiring a node into
the top socket sets children[0], bottom sets children[1]. "It doesn't need to
CONTAIN — it can transform": visually it reads as a wire-in operator, not a box
that swallows its inputs.

## Where it lives
- Model: `composition-graph-types.ts` — NO change (Container already has op +
  children; reuse the existing wire-in plumbing the transform nodes use).
- Render: `GraphEditorPane.svelte` Container render arm (the card). Add a COMPACT
  branch when `n.type === 'container'` AND `op ∈ {subtract,add,intersect}` AND the
  node is NOT the root ▶ Output list.
- Geometry: `graph-editor/geom.ts` — socket positions for the circle (A top-left,
  B bottom-left, output mid-right) + the wire-bezier endpoints must point at them.
- Emit is unchanged (`A.subtract(B)` already emitted from op + children order).

## Scope / steps
1. `geom.ts`: `csgNodeSocketAt(node, slot)` → A/B input + output points for a
   fixed-size circle (~48px). Pure + unit-testable.
2. GEP: compact render branch — `<circle>` + glyph + 3 sockets; keep drag-wire
   (start/endWireOnContainerSlot) hooked to the new socket points; 2-child cap
   for subtract/intersect (A,B), N for add (or keep add as the card).
3. Wire rendering: the bezier from each child's output → the A/B socket.
4. Order affordance: a tiny A/B label (top=A, bottom=B) + a swap control (since
   A−B ≠ B−A). Swapping = reorder children.
5. Browser-verify on dt_tube (A=outer shaft, B=inner shaft → tube).

## Risks
- GEP is ~7k lines + fragile (a bare `scene` ref crashed it this session). Do the
  render branch INLINE, build + BROWSER-MOUNT verify (build-green ≠ works for
  Svelte), commit in one focused pass.
- Socket Y-math is the usual footgun (socket↔DOM offset) — reuse the existing
  container-slot socket helpers, don't hand-roll new Y math.

## Note
There's a pre-existing aspiration for exactly this — GEP header comment "4 (CSG)
— drop ⊖ ⊕ ⊗ method nodes; drag-wire from a node's …". This formalises it.
