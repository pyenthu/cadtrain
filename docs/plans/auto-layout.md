# Auto-layout for `/graph-editor` — research + roadmap

Open todo: ship an **Auto-layout** action on the editor that arranges
nodes algorithmically. Manual layouts (which now persist — Phase 18) stay
the default; auto is a one-click intervention when the canvas gets messy
or after a translator regen drops everything at the default grid.

## Why now

- Phase 18 made manual layouts sticky → users invest in arranging.
- Phase 14 + 15 + 17 closed the K.68 vocab loop → loading `stand` /
  `joint` brings in 4–13 nodes that all snap to the default grid.
- The visible ▶ Output card + output wires (latest commits) make the
  data-flow direction explicit → there's a "correct" left-to-right
  layout the editor can compute deterministically.

## Reference leads (user-shared)

- **G6 (AntV)** — https://github.com/antvis/g6
  Open-source graph visualisation lib (Apache-2.0). Built-in layouts:
  `force`, `dagre`, `dagreCompound`, `fruchterman`, `mds`, `circular`,
  `grid`, `concentric`, `radial`, `comboCombined`, `gForce`. The
  underlying `@antv/layout` (TS, treeshakable) can be used WITHOUT G6's
  renderer — that's the relevant subset for cadtrain since we already
  have an SVG canvas.

- **yFiles interactive organic** — https://www.yfiles.com/demos/layout/interactiveorganic/index.html
  Commercial. Reference quality bar — physics-based "organic" layout
  that holds user constraints while drag-pinning nodes you care about.
  Worth replicating the UX even if the algorithm is simpler.

## Other candidates evaluated

| Lib | Layout | Size (min+gz) | License | Notes |
|---|---|---|---|---|
| **dagre** | layered DAG | ~28 KB | MIT | Pure algorithm; positions come back, you render. Battle-tested for flowcharts. |
| **elkjs** | layered + many | ~700 KB | EPL-2.0 | Port of Eclipse Layout Kernel. Most powerful; heavy. |
| **@antv/layout** | force, dagre, hierarchical, …  | ~80–200 KB per layout | MIT | G6's layout module standalone. Tree-shakeable. |
| **d3-force** | organic / physics | ~10 KB | ISC | Native to D3; constraint-friendly. Good for the yFiles-style organic. |
| **WebCola** | constraint-based | ~100 KB | MIT | Strong for user-defined constraints (e.g. "node A left of node B"). |
| **vis-network** | physics + hierarchical | ~150 KB | MIT/Apache | Full lib with own renderer — would overlap our SVG canvas. |

## Cadtrain-specific fit

Our graph is:
- A small DAG (rarely > 20 nodes).
- Has hierarchical containers (root list, stack/group children).
- Has clear data-flow direction: param chips (left) → calls → methods/mvs
  → root output card (right).
- Has fixed-position elements (the tacked params card, the Output card).

That points at **layered/hierarchical** as the natural default — same
shape the user implicitly draws by hand. Force-directed / organic is
a different aesthetic the user can opt into.

## Proposed phases

### Phase 20 — Heuristic layered layout (no dependency)

Implement a deterministic layered layout in ~100 LOC using
`topoOrder(graph)`:

1. Walk topologically to assign each node a "depth" (longest path from
   any input). Param chips = depth -1 (always leftmost). Root list =
   max depth + 1 (always rightmost).
2. Group nodes by depth → column.
3. Within each column, order by Y to minimise wire crossings (median
   barycenter from prior column).
4. Space columns by `max(width) + gap` per column; rows by a fixed gap.
5. Optionally bias the Output card's Y to the centroid of its children.

Pros: zero deps, ~100 LOC, exact fit for our DAG.
Cons: not as pretty as dagre for medium graphs.

### Phase 21 — dagre integration (optional)

When Phase 20 hits its limits (15+ nodes, lots of CSG branching),
swap the layered algo for `dagre`'s `dagre.layout()`. We feed
`graph.nodes` + edges via `collectEdges(graph)`. dagre returns
`{x, y}` per node — we drop into `graph.layout`.

Pros: production-grade quality, used by every graph editor.
Cons: ~28 KB dep + glue code.

### Phase 22 — Force-directed "interactive organic" (G6 + yFiles inspiration)

For organic look + UI parity with yFiles' interactive demo:
- Pull `@antv/layout-gpu` or `d3-force` for physics simulation.
- Tick the simulation while the user drags a node — the rest of the
  graph relaxes around the dragged node.
- Pinned/tacked nodes (📌 Params card, ▶ Output card) stay fixed.
- "Stop" button freezes the layout into `graph.layout` on save.

Heavier UX but matches the yFiles demo exactly.

## Recommended path

**Ship Phase 20 first.** Tiny, dep-free, deterministic — the user gets
"Auto-layout" working before we pull any external lib. If/when graphs
grow past ~15 nodes and the heuristic shows cracks, add Phase 21 (dagre)
as a quality bump. Phase 22 is the polish move, not the foundation.

## UX

- Button in the editor header: `📐 Auto-layout`.
- Single click rearranges. Undo restores the prior layout (one-step
  undo, kept in client state).
- Modifier-click (Shift?) opens a menu with layout options once we have
  more than one algorithm.
- Pinned (tacked) nodes stay put even under auto-layout — same 📌
  semantic as params chips.

## Open questions

- **Default trigger** on URL-load — for a freshly-translated `stand`
  with 13 nodes at the default grid, should we auto-layout on first
  open? Probably yes, then save-with-layout becomes the canonical
  form going forward.
- **Animation** — should auto-layout transition the nodes smoothly, or
  snap? Snap is simpler; transition is nicer.
- **Per-container sub-layouts** — should each stack/group lay out its
  own children in a sub-region? Phase 20 keeps it flat; Phase 21+ can
  recurse via dagre's `compound` mode (or G6's `dagreCompound`).
