# Plan — Decompose `GraphEditorPane.svelte` (the elephant)

> **Status:** PLAN. Focused successor to the GraphEditorPane section of
> `docs/plans/modularize.md` (which was written at 9635 lines, pre-extraction).
> **Current size: 8737 lines** = script (L20–4204, ~4180) + markup (L4205–7338,
> ~3130) + scoped CSS (L7339–8737, ~1400). **110 `$state` declarations.**
> **Goal:** carve to a thin shell (≤ ~1500 lines: props, top-level `$state`,
> `onMount`/keydown, the `<svg>` host + pan/zoom group, and child slots).

---

## 0. Hard-won rules (read before touching this file)

1. **INLINE only — no background subagents on this file.** Every subagent that
   tried a big GEP extraction this session **stalled at the watchdog** mid-large-
   write (mv/rot, P11 sidebar). The ones that worked were inline (P1/P2) or a
   short subagent (P5, ~20 min). Do these inline, one at a time.
2. **One phase per PR, sequential.** Never two edits to this file in flight
   (parallel branches off different bases 500'd us once — the BREP clobber).
3. **`bun run build` green AND browser-verify** after every phase before commit.
   `build` (vite/rollup) tsc-checks all importers — the real safety net.
4. **Socket↔wire lockstep** (memory `entry_idx_eval_idx_gotcha`): the SVG socket
   `cx/cy`, the param→arg wire endpoints, and `outputSocketAt` MUST share one
   geometry source (now `graph-editor-geom.ts`). Never let them drift.
5. **Stable props to canvases** (memories `canvas_height_contract`,
   `fresh_array_props_effect_loops`): pass memoised `$derived` refs, never inline
   `[...]`/`{...}` literals → avoids PrimitiveDualCanvas auto-fit loops.
6. **Scoped CSS travels with the component** — when a block leaves, its
   `<style>` rules leave too; the ~1400-line CSS shrinks as a side-effect, not a
   standalone phase.

## 1. Already extracted (do NOT redo)

| Module | What | PR |
|---|---|---|
| `src/lib/cad/graph-editor-geom.ts` (644) | socket/wire/card position math (+ test) | P1 ✓ |
| `src/lib/cad/graph-editor-args.ts` (79) | ArgValue/expr formatting + profile-kind lookups | P2 ✓ |
| `src/lib/shared/RightPane.svelte` (485) | the 6-tab right column (bake/src/md/svg/glb/brep) | P5 ✓ |

## 2. Remaining carve targets (current locations, smallest-safest-FIRST)

Ordered for INLINE safety — NodeCard (biggest, most shared-state) goes LAST so
its render arms already pull from extracted, tested helpers.

| # | Extract → | What moves (current L) | Risk | Notes |
|---|---|---|---|---|
| **A** | `graph-editor-popovers/` (or one `Popovers.svelte`) | the `open/close/apply*Pop` families (L3231–4057): container · argExpr · sketchExpr · polyExpr · polyRepeat{Count,Binding} · transformAxis · profile · profileRef · addParam · wire. ~10 near-identical anchored dropdowns + their `$state` pop objects. | **LOW-MED** | Most self-contained. Each is `{x,y}` + draft + apply→`graph` mutation. FloatingPanel z-index rules (memory `floating_panel_z_index`). Do FIRST — biggest line-win for least risk. |
| **B** | `graph-editor-bake.ts` (glue) | `runBake`/`setAutoBake`/`rebuildCache`/`restartDevServer`/`extractGraphFromSource`/`extractDrawingMd…`/`loadExpectedParamsFor`/`refreshCallArgs`/`isCallDrifted` (L1081–2441 scattered) + the `drop*` palette handlers (`dropCall/Csg/Mv/Rot/Stack/Pen/Polygon/Sketch/Solid/Repeat`, L2330–3292). | MED | Orchestration; several mutate `graph` → pass a graph getter/setter or keep thin wrappers in the shell. Pure-ish bits (`extractGraphFromSource`) can go to a `.ts`; mutators may need a `.svelte.ts`. |
| **C** | `wire-state.svelte.ts` (rune module) | the 23 wire+drop fns: `wireFrom` state + `armWire`/`startWire`/`startParamWire` + the full `endWireOn*` family + `unwireTransformAxis` + `releaseImplicitCapture`. | MED | Cross-cutting + pointer-capture (memory `touch_implicit_pointer_capture`). Keep the text-substitution wiring AS-IS so K.67 has one small file to rewrite. **Browser wire-drag + touch test mandatory.** |
| **D** | `ParamsCard.svelte` + `PropertiesCard.svelte` | the viewport-glued overlay cards (the tabbed Params \| Properties block) + add-param pop. | MED | Stay OUTSIDE the pan/zoom group (don't reparent). `CARD_Y0`/socket positions already in geom — keep passing them. |
| **E** | `SketchEditorPane.svelte` | the full-tab sketch editor: 21 `sketch*` handlers (`sketchCanvas*`/`sketchAnchor*`/`sketchBar*`/`sketchCardResize*`/`splineComp*`/`fitSketchFrame`/`cornerAtOpIdx`…), the `sketchEditor` `$derived` (L2609) + frozen-frame, the tools rail + 2D canvas markup. | MED-HIGH | Largest self-contained chunk. Props: the sketch node + param scope + callbacks. Verify vs `sketch*.test.ts`. **This is where the M.5 sketch-repeat UI will land — do E before sketch-repeat.** |
| **F** | `NodeCard.svelte` (+ per-type arms) | the per-node render arms (markup L4467–5340): Call / Container(list/stack/group) / Method / Mv / Rot / Repeat / Polygon / PolyRepeat / Sketch cards. | **HIGH** | Most shared-state-dependent — reads `graph`, selection, wire-state (C), geom (A-helpers). Do LAST. Enumerate leaf types explicitly — polygon/poly_repeat have no `children` (memory `autolayout_predecessors_polygon_crash`). One dispatcher with labelled `{#if}` arms, or N small components. |

After A–F the shell is props + the ~110 `$state` (many will move with their
feature) + `onMount`/keydown + the `<svg>` canvas host + child slots. The CSS
follows each component out.

## 3. Phase sequence (each = one inline PR, build + browser-verify, then commit)

1. **A — popovers.** Lowest-risk, biggest easy line-win. Verify each popover
   opens/edits/applies/dismisses.
2. **B — bake glue.** Verify bake / auto-bake / rebuild / drop-each-palette-item.
3. **D — Params/Properties cards.** Verify param edit + color/material + the tab
   switch + param→arg wires still land (socket lockstep).
4. **C — wire-state.** Verify every wire-drag kind + touch + the
   "connector-disconnects" path.
5. **E — SketchEditorPane.** Verify enter/edit/exit, each tool, spline/fillet/
   chamfer; THEN unblock M.5 sketch-repeat UI.
6. **F — NodeCard.** Last. Full graph e2e: every node type renders + wires +
   the inline mv/rot strips + the container slots.

Stop-and-bank after any phase — each leaves a smaller, working shell.

## 4. Done-when
GraphEditorPane ≤ ~1500 lines; each extracted unit has its own scoped CSS + (where
pure) a test; `bun run build` + `bun test` + a recorded graph e2e green; no
behavior change (every phase browser-verified against the same parts:
g_dp_box for sketch+sockets, g_mule_shoe for inline strips, a polygon part).

## 5. Out of scope here
K.67 graph-promotion (the wire-state rewrite — C just relocates it), the
client-side-execution split (`docs/plans/client-side-execution.md`), and the
`/vocab` (P12) + `builder.ts` (P13) + `ProfileFnEditor` (P15) files.
