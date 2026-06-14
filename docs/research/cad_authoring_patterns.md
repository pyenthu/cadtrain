# CAD Authoring Patterns — Current (2026-06-14)

> Updated successor to `cad_authoring_patterns.archived-2026-06-01.md`. The
> archived doc surveyed six tools to design a *tree* composition editor (K.63).
> Since then we shipped the **node-graph editor** (`GraphEditorPane`), a
> polygon-sampling geometry engine, vocabulary-driven authoring, and RAG. This
> doc (a) reconciles which 2026-06-01 recommendations we kept / dropped /
> **reversed**, and (b) answers the live question: **what is our possibility**
> for smooth, curved, "real CAD" geometry — the thread the g_star blockiness
> investigation opened.

---

## 1. Where we actually landed vs. the 2026-06-01 plan

| 2026-06-01 recommendation | What shipped | Verdict |
|---|---|---|
| §D "render the tree as an **indented vertical list**, NOT a horizontal canvas" | **Node-graph canvas** (`GraphEditorPane`) — boxes + wires, pan/zoom | **REVERSED** |
| §F3 "**Don't** add a 2D node-canvas — it'll hit the density wall by 15 joints" | We built the canvas; density managed by **auto-layout** (dagre/force, planned) + collapsible cards, not a vertical list | **REVERSED — but the risk it named is real** (see §3) |
| §D "Node IDs: hide the hash, show short auto-name (`tube_1`)" | Cards show alias (`A`, named instances); hash internal | **ADOPTED** |
| §D "Type chips on slots (№/◆/ƒ)" | `ƒ` chip on prop inputs + arg slots; popover for expressions | **ADOPTED** |
| §D "popup (FloatingPanel) for profile-fn + ƒ-expressions" | mv/rot ƒ popover, FloatingPanel convention | **ADOPTED** (memory `feedback_popup_over_inline`) |
| §B "operand picking is hybrid (typeahead + drag-wire)" | **Drag-wire sockets** A→B + Call `src` typeahead | **ADOPTED** |
| §E "tip-marker / solo / mute" | Not built; bake shows the **whole** graph result | **DROPPED** (per-part cutaway + ghosts cover most of the need) |
| §B "live preview <300ms" | Bake cache + ⚡draft + coarse-bake; g_dp_stand 27s→~1s | **ADOPTED, hard-won** (perf was a multi-session fight) |

**Why the reversal was right:** the archived doc feared the Grasshopper
"200-node spaghetti" wall. Our parts are **small** (3–8 nodes: a polygon, a
repeat, a Call), and the graph's *spatial* layout makes the
profile→repeat→extrude dataflow legible in a way an indented list does not —
especially with `poly_repeat`/`repeat-ref` wires. The density wall is deferred,
not disproven; auto-layout (Phase 20–22) is the mitigation the archived doc
predicted we'd need.

## 2. The new axis the 2026-06-01 survey missed: **geometry kernel class**

All six surveyed tools were compared on *UI*. The survey never classified them
by **how they represent curves** — which turns out to be the thing that
governs whether output looks "blocky" or "smooth." That's the gap this update
closes.

| Tool | Kernel | Curve representation | Smoothness ceiling |
|---|---|---|---|
| Replicad, FreeCAD, Onshape | **OCCT BREP** | NURBS / analytic arcs, **adaptive** tessellation | Effectively infinite (true curves) |
| OpenSCAD | CSG → mesh | `$fn`-faceted circles; **polygon** primitives | Facet count only — no true curves |
| Grasshopper / Houdini | Mesh + NURBS hybrid | NURBS surfaces *or* sampled meshes | High (NURBS) / sampling (mesh) |
| **cadtrain** | **ManifoldCAD** (mesh CSG) | **Polygon profiles**, sampled `poly_repeat`, sketch (Maker.js → sampled points) | **Sampling-bounded** — like OpenSCAD, not BREP |

**This is the crux.** cadtrain is a **mesh-CSG / polygon-sampling** kernel, in
the OpenSCAD class — NOT the BREP class. We will never get OCCT's *adaptive,
analytically-exact* curves. But OpenSCAD-class tools routinely produce
visually-smooth output by **sampling dense enough** — which is entirely within
reach (see g_star → g_wavy_star, `docs/plans/wavy-star.md`).

## 3. What is our possibility — smooth/curved geometry

Three tiers, in increasing order of work and fidelity. All three are
**authorable through our own graph GUI** (with one engine fix for tier 2).

### Tier 1 — dense continuous-function sampling (HAVE IT TODAY)
Replace discrete-corner polygons with a **continuous radius/position function**
sampled at high `poly_repeat` count. `R(θ)=R_mid+amp·cos(N·θ)` at `points×48`
gives smooth N-lobed forms; spirals, cams, wavy tubes, lobed mandrels all fall
out of the same move. **Zero engine change.** This is the g_wavy_star plan.
- *Reach:* anything expressible as `r=f(θ)` / `z=g(θ)` / a swept continuous
  profile. Covers most "organic-but-axisymmetric" downhole shapes.
- *Limit:* corners are *rounded by the function*, never analytically sharp;
  mesh size scales with sample count.

### Tier 2 — sketch + spline + fillet (NEEDS ONE ENGINE FIX)
The sketch engine (`src/lib/cad/sketch.ts`) already has `spline` (Bézier) and
`fillet` (Maker.js arc) ops, sampled at `segments`. True smooth arcs with
**independent per-corner fillet radii** — the canonical smooth-profile path.
- *Gap:* the `sketch` graph node takes a **static ops array** — no loop. A
  parametric N-arm star needs a new **`sketch_repeat`** node (mirror of
  `polygon`←`poly_repeat`). ~Same surface area as the existing poly_repeat
  plumbing: `composition-graph.ts` + `composition-emit.ts` (~L358) + a card.
- *Reach:* filleted slots, rounded keyseats, smooth cam lobes, blended
  shoulders — profiles where corners must be controlled, not just rounded.

### Tier 3 — true BREP (OUT OF CLASS — explicitly NOT our path)
OCCT-via-WASM (replicad/OpenCascade.js) would give analytic curves + adaptive
tessellation + real fillets-on-solids. **We deliberately do not go here:** it's
a second geometry kernel alongside Manifold, a large WASM payload, a different
boolean/robustness model, and it abandons the mesh-CSG simplicity that makes
our bake cache + instancing work. Documented as a known ceiling, not a TODO.
- *If ever revisited:* it would be a separate engine behind the same graph UI,
  not a Manifold replacement. Parked unless a part genuinely needs G2 surface
  continuity we can't sample our way to.

### Where smoothness is already free
ManifoldCAD's `revolve`/`extrude` with a high `segments`/`circularSegments`
already round *axisymmetric* surfaces smoothly — the blockiness only bites when
the **profile itself** has straight segments (g_star) or the **z-slicing**
(`divs`) is sparse. Tiers 1–2 fix the profile; raising `divs` fixes the sides.

## 4. Other current-situation deltas worth recording

- **Vocabulary + RAG layer** (didn't exist 2026-06-01): generative authoring is
  now RAG-then-translate (Rule 24), a layer *above* the graph editor the
  archived survey predates. Tool-comparison analogue: closest to **Onshape's
  precondition UI-spec** (params drive the panel) but text-prompt-seeded.
- **Engine layering** (Rule 21): stdlib/stdstale split + glob registry — our
  answer to the archived "stable names + references" pattern (§B), applied to
  *engines* not just nodes.
- **Z-down + view-only scale/lights** — our viewport conventions (zScale,
  directional Z-light, ortho default) are domain-specific (long thin downhole
  tools) and have no analogue in the general-purpose tools surveyed.

## 5. Net possibility statement

> cadtrain is a **mesh-CSG, polygon-sampling** CAD system in the OpenSCAD
> kernel class. We **cannot** produce OCCT-exact BREP curves — and we choose
> not to. We **can** produce **visually smooth, parametric, curved** geometry
> today (Tier 1) and with one bounded engine fix get **controlled filleted**
> profiles (Tier 2) — all authored through our own node-graph GUI. The g_star
> "blockiness" was never a kernel limit; it was a **straight-edged profile**
> we hadn't yet replaced with a sampled curve. That is fixable now.

## Sources / cross-refs

- `docs/plans/wavy-star.md` — the concrete Tier-1/Tier-2 build plan
- `docs/research/cad_authoring_patterns.archived-2026-06-01.md` — prior snapshot
- `src/lib/cad/sketch.ts` (spline/fillet) · `composition-emit.ts` (sketch emit)
- g_star investigation (2026-06-14): polygon straight edges + `divs:12` = blocky
- [Replicad (OCCT/BREP reference)](https://replicad.xyz/docs/examples/wavy-vase)
