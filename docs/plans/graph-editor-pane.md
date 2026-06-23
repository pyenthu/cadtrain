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
| `src/lib/shared/graph-editor/Popovers.svelte` (413) + `popover-clamp.ts` (26) | the 4 self-contained popovers (container · argExpr · profile · profileRef) | **A ✓** (642b00e) |
| `graph-editor-bake.ts` (50, pure+tested) + `graph-editor-bake.svelte.ts` (115, rune) | source/meta parsers + the expected-params cache (drift detection) | **B ✓** (2e71155) |
| `PropertiesCard.svelte` (~140) + `ParamsCard.svelte` (~165) | the PROPERTIES + PARAMS tab bodies of the overlay card | **D ✓** (aa6c74f + aebb3cd) |
| `wire-state.svelte.ts` (262, per-instance class) + `pointer-capture.ts` (19) | the drag-to-wire subsystem | **C ✓** (54e8505) |

> **Phase C DONE 2026-06-16.** `WireState` is a PER-INSTANCE class (one `new
> WireState(getGraph, setGraph, clientToGraph)` per pane), NOT a module `$state`
> singleton — /primitives mounts all tab panes at once, so a singleton would
> leak drag-state. Owns from/mouse/justArmed/pointerMoved/downAt/connectMode/
> isCoarse/tapConnect + all 16 handlers (arrow fields → `this` stays bound as
> Svelte event handlers); graph mutated via getGraph/setGraph. `clientToGraph`
> stayed in GEP (needs canvasEl/pan/zoom); `releaseImplicitCapture` → shared
> `pointer-capture.ts` (also used by sketch-card drags). ~130 refs rewired to
> `wire.*`. Verified end-to-end with a synthetic param→coord wire-drag (in-memory,
> reverted; disk untouched). GEP 8192 → 8024 (−168).

> **Phase D DONE 2026-06-16 (both cards).** `PropertiesCard.svelte` (clean HTML
> foreignObject) + `ParamsCard.svelte` (SVG: card `<g>` + chip foreignObjects +
> `.ge-sock out param` sockets). ParamsCard takes `startParamWire` +
> `openAddParamPop` as PROPS (wire-state stayed in GEP — turns out ParamsCard
> never needed C done first, just the callbacks). Position math from `geom`
> (shared with the param→arg wires in node arms → socket↔wire lockstep verified
> intact). `.ge-params-card-*`/`.ge-param-chip`/`.ge-sock` CSS duplicated (sketch
> mini card still uses GEP's copies until E). `addParamPop` + `wirePop` stay in
> GEP for now (minor; can fold into Popovers later). GEP 8308 → 8231 → 8192 (−116).

> **Phase B landed 2026-06-16 — REFINED.** "Bake glue" turned out to be mostly
> NOT movable: `runBake` is just `bakeNonce++` and the real bake is a reactive
> `$derived` chain (immovable); the `drop*` handlers are trivial 1-liners
> (`closePicker(); graph = addX(graph).graph` — no win to move). What WAS a clean,
> cohesive unit: the **source/meta parsers** (pure) + the **expected-params cache**
> (drift detection). Split across two files so the pure logic is vitest-able (a
> `.svelte.ts` rune module can't be imported by a plain test — `$state` won't
> compile there). `expected` is a SHARED `$state` singleton (keyed by src, global
> cache, shared across /primitives tabs). Graph-touching fns take graph explicitly;
> `refreshCallArgs` returns the new graph. GEP 8429 → 8308 (−121).

> **Phase A landed 2026-06-16 — REFINED scope.** The inventory showed the 8
> popovers are NOT one clean unit: each `apply*` belongs to a different feature
> card, and `polyExprPop` is fused with the `hlVertex`/`svgTip` highlight read by
> node arms + SVGs. So Phase A extracted only the **4 self-contained** ones
> (container, argExpr, profile, profileRef) — `graph = $bindable()`, exported
> `open*`/`moveChild`/`detachProfile`, driven via `bind:this={popovers}`. The
> other 4 ride their owning card's phase, NOT a future "Popovers part 2":
> `sketchExprPop` → **E** (SketchEditorPane), `polyExprPop` (+ transform-axis +
> poly_repeat + hlVertex/svgTip) → **F** (NodeCard), `addParamPop` + `wirePop` →
> **D** (Params/Props cards). `clampToViewport` is now shared via `popover-clamp.ts`
> (the sketch/poly expr popovers in GEP still use it). The shared
> `.ge-wire-*`/`.ge-expr-*`/`.ge-param-add`/`.ge-empty` CSS is DUPLICATED in
> Popovers transitionally — it collapses out of GEP once D/E/F move the rest.
> GraphEditorPane 8737 → 8429 (−308).

## 2. Remaining carve targets (current locations, smallest-safest-FIRST)

Ordered for INLINE safety — NodeCard (biggest, most shared-state) goes LAST so
its render arms already pull from extracted, tested helpers.

| # | Extract → | What moves (current L) | Risk | Notes |
|---|---|---|---|---|
| ~~**A**~~ ✓ | `graph-editor/Popovers.svelte` — DONE (642b00e). | 4 self-contained pops (container · argExpr · profile · profileRef). | — | See the refined-scope note above. The other 4 pops ride D/E/F, below. |
| ~~**B**~~ ✓ | `graph-editor-bake.ts` + `.svelte.ts` — DONE (2e71155). | parsers + expected-params cache (see refined note above). | — | `runBake`/bake-pipeline stay (reactive); `drop*` stay (trivial 1-liners); `setAutoBake`/`rebuildCache`/`restartDevServer` stay (small, bake-pipeline-coupled $state). |
| ~~**C**~~ ✓ | `wire-state.svelte.ts` (per-instance `WireState` class) + `pointer-capture.ts` — DONE (54e8505). | wireFrom→`wire.from` + all start/endWireOn*/unwire handlers. | — | Per-instance class (NOT singleton). The endWireOn* text-substitution wiring is kept AS-IS for K.67. |
| ~~**D**~~ ✓ | `PropertiesCard.svelte` (aa6c74f) + `ParamsCard.svelte` (aebb3cd). | both overlay-card bodies done. `addParamPop`/`wirePop` left in GEP (minor). | — | ParamsCard took startParamWire/openAddParamPop as props — didn't need C first. |
| **E** | `SketchEditorPane.svelte` — **ATTEMPTED + REVERTED 2026-06-16; do WITH F.** | the full-tab sketch editor: 21 `sketch*` handlers, the `sketchEditor` `$derived` + frozen-frame, the tools rail + 2D canvas markup + the mini params/sketch cards. | **HIGH (entangled with F)** | See the failure note below. |

> **Phase E — ATTEMPTED + REVERTED 2026-06-16.** Built `SketchEditorPane.svelte`
> as a `bind:this` component owning all sketch state + `open(id)` (1407 lines,
> via sed-extract of the 3 script chunks + 2 markup chunks). It MOUNTED but the
> graph wouldn't load — TWO runtime `ReferenceError`s (build didn't catch them;
> Svelte treats unknown markup idents as runtime-resolved): (1) the markup_pop
> range over-grabbed the polygon `{#if svgTip}` tooltip (Phase F), and worse
> (2) **the Sketch NODE CARD (Phase F, stays in GEP) shares `sketchExprPop` +
> `sketchAxisLabel` + `openSketchExprPop` + `toggleSketchOpMode` with the full-tab
> editor.** `sketchExprPop` is ONE popover that can't render in two components,
> and `toggleSketchOpMode` reads the editor's `sketchEditor` derived — so the
> editor and the node card are NOT separable while the node card lives in GEP.
> Reverted cleanly to the committed state (A/B/C/D intact, GEP ~8021).
> **CORRECTED DESIGN — confirmed by re-inventory 2026-06-16 (the execution-ready spec):**
> The shared helpers `sketchExprPop` + `openSketchExprPop` + `toggleSketchOpMode`
> + `sketchAxisLabel` are called from BOTH the node-card arm (`{:else if
> n.type==='sketch'}`, GEP ~5310–5400) AND the full-tab editor (~5673+) AND
> `sketchAnchorTap` — so neither can move to a component while the other stays
> (this is precisely what broke Phase E).
>
> **Step 1 = a per-instance `sketch-state.svelte.ts` class** (the proven WireState
> pattern, scaled up): owns editingSketchId / sketchTool / the drags / frame /
> cards state + `sketchExprPop` + all 21 `sketch*`/`mini*` handlers + the
> `sketchEditor` + `miniLayout` `$derived`s; mutates graph via getGraph/setGraph
> and takes the `wire` instance. GEP holds `const sketch = new SketchState(...)`;
> BOTH the node-card arm and the editor block reference the ONE instance
> (`sketch.openSketchEditor`, `sketch.toggleSketchOpMode`, `sketch.exprPop`, …).
> Markup STAYS in GEP, rewired to `sketch.*`. **SCOPE: ~233 sketch-state refs +
> ~80 handler call-sites** — large + fragile; INLINE, one focused pass, build +
> **BROWSER-MOUNT verify mandatory** (g_dp_box: enter editor, draw line/spline/
> fillet, drag anchor, abs/rel toggle, the coord ƒ-popover, AND the node-card
> inline ops). Per-instance (NOT a singleton — /primitives mounts all panes).
>
> **Step 2 (after Step 1 lands):** move the editor block → `SketchEditorPane.svelte`
> and the node-card arm → `SketchNodeCard.svelte` (both take the `sketch` instance).
> This is what unblocks the **M.5 sketch-repeat** data model + the repeat windowed editor.
>
> _(superseded note: "do E+F together as one pass" — the SketchState class IS the
> shared unit; markup components come after.)_
| **F** | `NodeCard.svelte` (+ per-type arms) | the per-node render arms (markup L4467–5340): Call / Container(list/stack/group) / Method / Mv / Rot / Repeat / Polygon / PolyRepeat / Sketch cards **+ `polyExprPop`** (vertex/loop/binding/count **+ transform-axis** ƒ-editor; fused with `hlVertex`/`hoverVertex`/`svgTip`). | **HIGH** | Most shared-state-dependent — reads `graph`, selection, wire-state (C), geom (A-helpers). Do LAST. Enumerate leaf types explicitly — polygon/poly_repeat have no `children` (memory `autolayout_predecessors_polygon_crash`). One dispatcher with labelled `{#if}` arms, or N small components. |

After A–F the shell is props + the ~110 `$state` (many will move with their
feature) + `onMount`/keydown + the `<svg>` canvas host + child slots. The CSS
follows each component out.

## 3. Phase sequence (each = one inline PR, build + browser-verify, then commit)

1. ~~**A — popovers.**~~ ✓ DONE (642b00e) — 4 self-contained pops only (refined
   scope above). **B is the next phase.**
2. ~~**B — bake glue.**~~ ✓ DONE (2e71155) — parsers + expected-params cache only
   (the bake pipeline is reactive; drops are 1-liners). **D is the next phase.**
3. ~~**D — Params/Properties cards.**~~ ✓ DONE (aa6c74f + aebb3cd) — both bodies
   extracted; ParamsCard took startParamWire/openAddParamPop as props. **C is next.**
4. ~~**C — wire-state.svelte.ts.**~~ ✓ DONE (54e8505) — per-instance `WireState`
   class; verified with a synthetic param→coord wire-drag. **E is next.**
5. **E — SketchEditorPane.svelte. ATTEMPTED + REVERTED (see note above) — do E+F TOGETHER.**
   The largest self-contained chunk: the full-tab
   sketch editor (21 sketch* handlers, the `sketchEditor` $derived, the tools rail
   + 2D canvas markup + the mini params/sketch cards). Carries `sketchExprPop` +
   the sketch mini-card (which can then drop GEP's duplicated `.ge-param-chip`/
   `.ge-params-card-*` CSS). Props: the sketch node + param scope + the `wire`
   instance + callbacks. **This unblocks the M.5 sketch-repeat UI — do E first.**
6. **F — NodeCard.svelte.** Last. The per-node render arms + `polyExprPop`. Full
   graph e2e: every node type renders + wires + the inline mv/rot strips + slots.

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

## 6. Phase E Step 2 — execution map (LOCKED 2026-06-23, do in a FRESH session)

Step 1 (the `SketchState` class) is DONE — `sketch-state.svelte.ts` (710 lines)
homes all state + the 21 `sketch*` handlers + `sketchEditor`/`miniLayout`
`$derived`s. GEP holds `const sketch = new SketchState(...)` and the markup is
already rewired to `sketch.*`. Step 2 just MOVES three markup blocks out. **GEP
is 7,897 lines — INLINE only (subagents stall on this file); browser-mount verify
every sketch op (mandatory). Line anchors below WILL shift — read the file fresh,
match on the `{:else if n.type === 'sketch'}` / `ge-sketch-editor` / `sketch.sketchExprPop`
anchors, not raw line numbers.**

### The blocks (anchors as of 7,897-line HEAD)
1. **Sketch NODE CARD** — `{:else if n.type === 'sketch'}` at ~L4947, ends before
   the `poly_repeat` arm ~L5053 (vertex rows, op rows, ✎ open-editor button,
   +line/+spline/+fillet/+chamfer foot). → **`SketchNodeCard.svelte`**.
2. **Full-tab EDITOR block** — `{#if sketch.editingSketchId && sketch.sketchEditor}`
   at ~L5312, `.ge-sketch-editor` (tools rail `.ge-sketch-vtools`, the 2D canvas,
   the mini params/sketch cards `sketch.miniLayout` ~L5426, the floating sketch
   card ~L5494, the coord sockets ~L5566). Closes with the `.ge-sketch-editor`
   `</div>` + its `{/if}` — VERIFY the close during extraction (nested `{#each}`/
   `{#if}` cascade ~L5556-5566). → **`SketchEditorPane.svelte`**.
3. **Coord ƒ-popover** — `{#if sketch.sketchExprPop}` at ~L5942 (uses
   `clampToViewport`, `paramEntries`, `sketch.applySketchExprPop` /
   `insertParamIntoSketchDraft`). **STAYS IN THE SHELL — DO NOT MOVE.** Both new
   components only SET `sketch.sketchExprPop`; the shell renders the ONE popover.
   **This is the fix for the original Phase-E revert** ("one popover can't render
   in two components") — it already lives in the shell, so the entanglement is
   already resolved by Step 1; Step 2 must not re-introduce it.

### Do NOT conflate
- The sketch per-coord param-WIRE pass `{:else if n.type === 'sketch'}` at ~L3775
  (bezier wires from param sockets → sketch coord inputs; sibling to the
  polygon/poly_repeat wire passes) lives in the canvas **wire `<svg>` layer**, NOT
  the card. Leave it in the shell wire layer; do not move it into SketchNodeCard.
- The mini params/sketch cards live INSIDE the editor block → move WITH
  SketchEditorPane.

### Component interfaces (both take the ONE `sketch` instance)
- `SketchNodeCard.svelte`: `{ sketch, n (sketch node), graph, setGraph, wire,
  consumedSet, paramEntries, geom: sketchEntryH/sketchSockR/sketchSockZ/sketchSockVal }`
  + the `openSketchEditor` trigger. Sets `sketch.sketchExprPop` (popover in shell).
- `SketchEditorPane.svelte`: `{ sketch, sid, se=sketch.sketchEditor, graph, setGraph,
  wire, paramEntries, geom: sketchSockR/Z, sketchRowVisible, sketchEntryH, miniBez }`
  + `addSketchOp`/`removeSketchSplinePoint`. Sets `sketch.sketchExprPop`.

### CSS to move (the `.ge-sketch*` block, ~L7056-7110+)
- → `SketchNodeCard`: `.ge-sketch`, `-ops`, `-vtx`(+`.corner`/`.editing`), `-srow`,
  `-axis`(+rel/spline/corner/chamfer), `-in`, `-btn`, `-foot`, `-add`, `-edit-btn`.
- → `SketchEditorPane`: `.ge-sketch-editor`, `-vtools`, `-topbar`, `-grip`, `-dial`,
  `-cards`, `-fx`, `-stool-sep`, `-foot`(if used there too).
- `.ge-sketch-vtx`/`-axis` are used by BOTH the node card AND the mini sketch card —
  duplicate into both component `<style>`s (cheap) rather than a shared import.

### Order (bank after each)
1. **SketchNodeCard FIRST** (smaller, ~105 lines) — de-risks the `sketch.*`
   prop-passing + the popover-in-shell pattern on the smaller block. Build +
   browser-verify the node-card inline ops + the coord ƒ-popover firing from the
   card. Commit.
2. **SketchEditorPane** (the ~250-line block + mini cards). Build + browser-verify:
   enter editor (✎ on g_dp_box), draw line/spline/fillet, drag an anchor, abs/rel
   axis toggle, the coord ƒ-popover from the editor, the mini param wires. Commit.

### Done-when (Step 2)
GEP drops ~350-400 lines (sketch markup + CSS out); `bun run build` green; the
sketch ƒ-popover still fires from BOTH the node card and the editor; recorded
g_dp_box e2e green. Then **M.5 sketch-repeat** is unblocked.
