# CAD Authoring Patterns — Reference for K.63 Composition Editor

Survey of six parametric/procedural CAD tools, extracted patterns, and concrete
recommendations for cadtrain's editable composition-tree editor.

## A) Tool survey

**Grasshopper (Rhino)** — Visual dataflow canvas: components are boxes wired
left-to-right; *parameters* are sliders/panels feeding input grips; composition
is an **acyclic graph** (not a tree); errors surface as red/orange node halos
with a hover-tooltip explaining the fault. Borrow: explicit **Panel** and
**Group/Cluster** nodes for commenting/collapsing — readability hygiene is
first-class, not an afterthought. ([best practices](https://parametricbydesign.com/explanation/visual-programming/best-practices/))

**OpenSCAD** — Text-first imperative-looking CSG; parameters are top-of-file
variables / `module` args (no real type system); composition is **nested
function-call text**; errors print to a console with line numbers but no
in-canvas highlight. Borrow: the `#`/`%`/`*` **modifier characters** that
mark a subexpression for debug-render or mute — a one-keystroke "show this
piece alone" affordance. ([CHI 2024 study](https://arxiv.org/html/2408.01796v1))

**Replicad** — TypeScript in the browser, OCCT via WASM; parameters are
`main({ ... })` function args with TS types; composition is **fluent method
chains** (`.fuse().cut().fillet()`); errors are TS compiler diagnostics plus
runtime OCCT exceptions surfaced in a side log. Borrow: **autocomplete +
inline JSDoc** as the discoverability layer — no separate node palette
needed. ([replicad docs](https://replicad.xyz/docs/advanced-topics/typescript/))

**Onshape FeatureScript** — Proprietary JS-derived language inside a built-in
IDE; parameters are declared via a **`precondition` UI spec** that auto-builds
the right-side panel (length / boolean / enum / **array of grouped items**);
composition is **linear feature timeline** with sub-features; errors are
red-banner with a "jump to definition" link. Borrow: the **array parameter
with expand/collapse named items** — directly matches cadtrain's "list of
parts" need. ([Feature UI spec](https://cad.onshape.com/FsDoc/uispec.html))

**Houdini SOPs** — Node graph (DAG) per surface-operator context; parameters
live in a right-side panel keyed to the *selected* node; composition is wires
left→right with sub-networks for hierarchy; errors are red node-border plus
status-bar text. Borrow: **flag system** (display flag, render flag, template
flag) — explicit per-node toggles for "this is what I'm looking at right now"
beats hunting for a preview checkbox. ([SOP docs](https://www.sidefx.com/docs/houdini/nodes/sop/index.html))

**FreeCAD PartDesign** — Linear feature timeline ("body") in a left tree;
parameters edit in a property panel; composition is **strict sequence with a
"tip" pointer** for current state; errors range from silent breakage (the
infamous **topological-naming problem** when faces get re-indexed) to red
crosses in the tree. Borrow as a *cautionary* lesson — but adopt the
**tip-marker** idea: explicit cursor showing which step the viewport reflects.
([toponaming wiki](https://wiki.freecad.org/topological%20naming%20problem))

## B) Cross-tool patterns (≥4 tools)

- **Parameter binding via expressions**, not just literals — all six accept
  `width/2` or `outerR - wall`. Cadtrain already does this via `expandInstancePropRefs`.
- **Live preview** (Grasshopper, Houdini, FreeCAD, Onshape) beats solver-on-demand
  (OpenSCAD F5/F6, Replicad save-to-reload). Users tolerate ~300ms; >2s they stop trusting.
- **Stable names + references** — every tool either gives nodes an ID
  (Grasshopper GUIDs, Houdini node paths) or pays the price (FreeCAD toponaming).
- **Boolean + Transform + Array** are the universal composition trio; cadtrain's
  `add/subtract/intersect` + `mv/rot` + `place()/repeat` already maps cleanly.
- **Operand picking is hybrid**: Onshape and FreeCAD prefer **click-in-viewport**;
  Grasshopper/Houdini use **drag-wire**; Replicad/OpenSCAD use **typeahead identifiers**.
  No tool relies on one mode exclusively.

## C) Anti-patterns

- **Dense graph at scale** — Grasshopper definitions of 200+ nodes become
  unreadable spaghetti; mitigations (Clusters, named wires) are bolted on.
- **Flat scope** — OpenSCAD's single top-level scope forces long variable names
  and makes refactor hostile; CHI study cites this as a top-3 pain point.
- **Hidden server state** — Onshape FeatureScript can't be debugged offline; a
  slow round-trip kills exploratory edits.
- **Brittle references** — FreeCAD's `Face13`-style names break under upstream edits.
- **Property-panel-only editing** — FreeCAD/Houdini both force users to *select*
  a node before they can see its params; cursor cost adds up.

## D) K.63-specific recommendations

- **Node IDs**: hide the hash, show a **short auto-name** (`tube_1`, `cut_2`)
  that is editable; keep the hash internally for refs (avoids FreeCAD's trap).
- **Picker mode**: **typeahead by default** (keyboard-first), **dropdown for
  enums**, **drag-onto-slot** as a discoverability bonus — never the only path.
- **Top-to-bottom reading**: render the tree as **indented vertical list**
  (one node per line, 2-space indent per depth), NOT a horizontal canvas; a
  10-joint stack should scroll, not pan. Collapse children behind a `▾`.
- **Type chips on slots**: yes — show a small `№` / `◆` / `ƒ` glyph (Number /
  Manifold / Function) on each arg slot; colors match Grasshopper's data-type
  wires; tooltip on hover gives the full TS type.
- **Keyboard add-node flow**: `Enter` on a slot opens a **command palette**
  (fuzzy: `r_t<tab>` → `r_tube`); `Tab` cycles args; `Esc` cancels; `Cmd+Enter`
  commits + re-bakes. Mirror VS Code's "Go to Symbol".
- **Inline vs popup vs side-panel**: **inline** for scalars (number, enum
  dropdown); **popup (FloatingPanel)** for profile-fn editor and ƒ-expressions
  (already cadtrain convention); **side panel** for whole-node settings
  (color, name, comment) — never for primary geometry params.

## E) Three conventions to ADOPT now

1. **Tip-marker on the tree** — a single visible cursor (▶) on the row whose
   output the viewport currently shows, so users always know "what am I looking at."
2. **Solo / mute modifiers** per node (`s` / `m` keys) — OpenSCAD's `#`/`*` idea;
   one-keystroke isolate-this-subtree for debugging composition.
3. **Command palette for node insertion** (`Cmd+K` or `Enter` on empty slot)
   with fuzzy match over `r_*` + active instance names; closes the discoverability
   gap without committing to a node-palette sidebar.

## F) Three conventions to AVOID

1. **Don't expose internal hash IDs** in the tree UI — they leak Manifold
   relation noise; users want `tube_1` not `a3f9c2`.
2. **Don't require selection-before-edit** — keep at least the rename + color
   swatch + delete inline on the row; selection is for advanced settings only.
3. **Don't add a 2D node-canvas view** for composition — the tree is recursive
   and reads top-to-bottom; a horizontal Grasshopper-style canvas will hit the
   density wall (anti-pattern C1) by the time a BHA has 15 joints.

## Sources

- [Onshape Feature UI spec](https://cad.onshape.com/FsDoc/uispec.html)
- [Replicad TypeScript docs](https://replicad.xyz/docs/advanced-topics/typescript/)
- [Grasshopper best practices](https://parametricbydesign.com/explanation/visual-programming/best-practices/)
- [Houdini SOP nodes](https://www.sidefx.com/docs/houdini/nodes/sop/index.html)
- [FreeCAD toponaming wiki](https://wiki.freecad.org/topological%20naming%20problem)
- [CHI 2024 — OpenSCAD challenges](https://arxiv.org/html/2408.01796v1)
- [OpenSCAD CSG manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/CSG_Modelling)
