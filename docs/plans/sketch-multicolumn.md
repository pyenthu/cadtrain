# Sketch card multi-column layout (1 / 2 / 3 columns)

Plan owner: editor / sketch card. Target file:
`src/lib/shared/GraphEditorPane.svelte` (~9455 lines). Read-only analysis
done 2026-06; line numbers below were verified against the current file but
will drift — anchor on the function/CSS-class names, not the integers.

## Goal

The sketch card lists every op in ONE tall vertical column. A line/spline op
renders a stacked r/z sub-row pair (45px = `POLY_VTX_PITCH`); a fillet/chamfer
renders a single short row (24px). A part with many points produces a very
tall card. We add a toolbar control to wrap the single ordered op list into
**1, 2, or 3 columns** so the card is shorter and wider, plus a small
per-column **read-sequence arrow** so the wrap order (down a column, then to
the next column's top) stays legible.

## The fragile contract (read this first)

The op rows are HTML inside a `<foreignObject>`; the wire INPUT sockets are
SVG `<circle>` siblings positioned by a cumulative-height walk. Their Y must
agree pixel-for-pixel or sockets drift off their rows. Today that agreement is:

- `sketchEntryH(op)` ~L2392 — 24 for fillet/chamfer, else 45.
- `sketchRowTop(node, idx)` ~L2395 — `36 + Σ sketchEntryH(prior ops)`; 36 =
  header+divider = the foreignObject's `y`.
- `sketchSockR/Z/Val(node, idx)` ~L2401-2403 — `rowTop + 12 / +31 / +12`.
- CSS that MUST mirror the math: `.ge-sketch-vtx` (L8591), `.ge-sketch-srow`
  (height 18, L8596), `.ge-sketch-ops` (L8590). Comment block at L8586-8589
  spells out "row height MUST equal sketchEntryH or the sockets drift."
- The polygon card has the SAME pattern in `polyRowTop` (~L2375) /
  `polySockR/Z/Ref` (~L2384) — see "Future" below.

There are TWO renderings of the sketch card that BOTH call
`sketchRowTop`/`sketchSock*`:

1. **On-graph node card** — markup L6189-6267 (rows in a `.ge-sketch-ops`,
   left-edge sockets at `cx="0"`, `cy={sketchSockR(n, idx)}`). Sized by
   `nodeSize` sketch branch (L2464-2472). No scroll wrapper, no toolbar.
2. **Full-tab sketch editor's floating card** — markup L6774-6864 inside the
   `.ge-sketch-cards` overlay SVG. Sockets are scroll-shifted
   (`cy={sketchSockR(sn, idx) - sketchOpsScrollTop}`) and gated by
   `sketchRowVisible`. Sized by `miniLayout` (L3117-3126) + `sketchCardSize`
   (L3504). The sketch toolbar (`.ge-sketch-vtools`, L6606-6616) lives here.

Because both call the same geometry helpers, **any column awareness must be a
parameter, not a global mutation of `sketchRowTop`** — otherwise turning on 3
columns in the full-tab editor would shift the on-graph card's sockets while
its HTML still renders one column. See step 1.

## 1. State + persistence

Recommendation: **persist per-node in `graph.layout[id].cols`**.

`LayoutXY` (composition-graph.ts L244) is already `{ x; y; w?; h? }` and the
whole `layout` object round-trips for free: `serialiseGraph` emits
`layout: graph.layout` (composition-emit.ts L655) and `hydrateGraph` spreads
`{ ...savedLayout }` (composition-graph.ts L325-341). Adding an optional
`cols?: 1 | 2 | 3` to `LayoutXY` therefore needs only a one-line type change
and persists with no emit/hydrate plumbing — and, keyed by node id, it gives
`nodeSize`, `miniLayout`, and BOTH card renderers a single source of truth.

Read it through a small accessor so the default and clamp live in one place:

```ts
function sketchCols(node: any): 1 | 2 | 3 {
  const c = graph.layout[node.id]?.cols;
  return c === 2 || c === 3 ? c : 1;
}
function setSketchCols(id: NodeId, cols: 1 | 2 | 3) {
  graph = setLayout(graph, id, { ...(graph.layout[id] ?? { x: 0, y: 0 }), cols });
}
```

`setLayout` already exists (L481) and merges into `layout[id]`. Confirm it
preserves the existing `{x,y,w,h}` — pass a spread as above to be safe.

Alternative considered: a session-only `let sketchCols = $state(1)` rune.
Simpler but (a) doesn't survive reload, (b) is ambiguous when the on-graph
card and the editor disagree, and (c) doesn't key by node, so two sketches
share one setting. Rejected in favour of the layout field, which is nearly
free here.

## 2. Distribution strategy + the pure helper

**Use sequential (column-major) fill balanced by HEIGHT, never round-robin by
count.** The read-sequence arrow requires that each column hold a CONTIGUOUS
range of ops (col 0 = ops 0..k, col 1 = ops k+1..m, …) so "down a column then
to the next column's top" matches op order. Round-robin (op i -> col
i % cols) would interleave the sequence and make the arrow meaningless.

Balancing by COUNT vs by HEIGHT differs because entries are heterogeneous
(fillet=24 vs line=45): a column of three fillets is 72px while a column of
three lines is 135px. Splitting by equal COUNT can leave wildly uneven column
heights (and thus a tall card defeating the point). So: compute
`target = totalHeight / cols`, walk ops accumulating height into the current
column, and start the next column when adding the next op would exceed
`target` AND columns remain — never splitting an op across columns.

One pure helper is the clean seam; it is the SINGLE source of truth used by
both the render partition and the socket math:

```ts
const SKETCH_COL_W = 140;   // inner content width per column (≈ MINI_SCW - 12)
const SKETCH_COL_GAP = 16;  // gutter; wide enough to host an interior socket

type SketchCell = { op: any; idx: number; col: number; x: number; yTop: number };
type SketchColLayout = {
  columns: SketchCell[][];   // partition for the #each render (op order within each)
  byIdx: SketchCell[];       // same cells indexed by original op idx (socket lookup)
  colWidth: number;
  gap: number;
  tallestH: number;          // max column pixel height (drives card height)
  innerW: number;            // cols*colWidth + (cols-1)*gap
};

function sketchColLayout(ops: any[], cols: 1 | 2 | 3): SketchColLayout;
```

Semantics:
- `cell.x = col * (SKETCH_COL_W + SKETCH_COL_GAP)` — column left offset inside
  the ops area (col 0 = 0).
- `cell.yTop = 36 + Σ sketchEntryH of prior ops IN THE SAME column` — the 36
  header offset is added once per column (every column starts at the same top).
- Each op keeps its original `idx` so the existing handlers
  (`moveSketchOp`, `setSketchOpField`, `removeSketchOp`, `openSketchExprPop`)
  are unchanged.

Keep `cols=1` producing EXACTLY today's numbers (`columns[0]` = all ops,
`x=0`, `yTop` identical to current `sketchRowTop`) so the on-graph card and
all snapshots are byte-stable when the feature is off.

## 3. Socket math (X offset)

`sketchRowTop` / `sketchSockR/Z/Val` gain an optional `cols` parameter
defaulting to 1, and delegate to `sketchColLayout`:

```ts
function sketchRowTop(node, idx, cols: 1|2|3 = 1) {
  return sketchColLayout(node?.ops ?? [], cols).byIdx[idx]?.yTop ?? 36;
}
function sketchSockR(node, idx, cols = 1) { return sketchRowTop(node, idx, cols) + 12; }
function sketchSockZ(node, idx, cols = 1) { return sketchRowTop(node, idx, cols) + 31; }
function sketchSockVal(node, idx, cols = 1){ return sketchRowTop(node, idx, cols) + 12; }
```

The Y stays `+12/+31`; the NEW piece is X. Add a sibling that returns the
column's left socket X (today every socket is at `cx="0"`):

```ts
function sketchSockX(node, idx, cols = 1) {
  const c = sketchColLayout(node?.ops ?? [], cols).byIdx[idx]?.col ?? 0;
  // col 0 keeps cx=0 (hangs on the card's left border, as today). For col>0
  // the socket sits at that column's left content edge. The foreignObject is
  // inset 6px (x="6"), so the card-space X of column c's content left edge is
  //   6 + c*(SKETCH_COL_W + SKETCH_COL_GAP)
  // and we keep the same ~6px left overhang the col-0 socket has at cx=0:
  return c === 0 ? 0 : c * (SKETCH_COL_W + SKETCH_COL_GAP);
}
```

In BOTH card markups, replace `cx="0"` with `cx={sketchSockX(node, idx, cols)}`
(on-graph passes `cols=1`; full-tab passes `sketchCols(sn)`). Interior-column
sockets land in the inter-column gutter; `SKETCH_COL_GAP=16` is sized to host
the 4px-radius socket. Wires from the Params card route across freely (they
already cross cards). Reconciling the exact overhang vs the col-0 `cx=0`
convention is the implementer's fragile pixel task — verify visually that an
interior socket sits flush on its row's left edge, mirroring how `cy` is
verified.

## 4. HTML / SVG agreement (single source of truth)

Do NOT use CSS `column-count`/`columns`: the browser balances by content with
break points we can't predict, which breaks the pixel contract with
`sketchColLayout`. Instead render an **explicit flex row of N column stacks**,
partitioned by the SAME `sketchColLayout(...).columns`:

```svelte
{@const cl = sketchColLayout(sn.ops, sketchCols(sn))}
<div class="ge-sketch-ops" class:multicol={cl.columns.length > 1} onscroll={...}>
  {#each cl.columns as colCells (colCells[0]?.idx ?? -1)}
    <div class="ge-sketch-col" style="width: {cl.colWidth}px">
      {#each colCells as { op, idx } (idx)}
        <!-- the EXISTING .ge-sketch-vtx / .ge-sketch-srow markup, verbatim -->
      {/each}
    </div>
  {/each}
</div>
```

CSS: `.ge-sketch-ops.multicol { display: flex; flex-direction: row; gap: 16px;
align-items: flex-start; }` and `.ge-sketch-col { display: flex;
flex-direction: column; }`. The 16px flex `gap` MUST equal `SKETCH_COL_GAP`,
and `.ge-sketch-col` width MUST equal `SKETCH_COL_W` — these two CSS values are
the second half of the pixel contract (the first half is `sketchEntryH` vs
`.ge-sketch-vtx` height). Call this out in a comment next to the constants,
exactly like the existing L8586-8589 warning.

Because the partition (`columns`) and the socket lookup (`byIdx`) come from one
`sketchColLayout` call, the HTML row order and the SVG socket Y can't diverge.
Compute `cl` ONCE per render (a `{@const}` at the top of the card) and reuse it
for the foreignObject partition AND the socket `{#each}` so both see identical
column boundaries even mid-edit.

## 5. nodeSize + miniLayout (width/height)

`nodeSize` sketch branch (L2464-2472) today:
```
rowsH = Σ sketchEntryH(op);  autoH = 36 + max(44, rowsH) + 62;
return { w: Math.max(w, 210), h };
```
becomes column-aware:
```
const cols = sketchCols(node);
const cl = sketchColLayout(ops, cols);
const autoW = 12 + cl.innerW;                 // 12 = foreignObject 6px insets
const autoH = 36 + Math.max(44, cl.tallestH) + 62;
const w = Math.max(savedW ?? autoW, cardMinWidth(node), cols * 80);
return { w, h };
```
Width scales with column count (`innerW = cols*COL_W + (cols-1)*gap`); height is
the TALLEST column + chrome (not the sum). Keep the saved-width override
(`graph.layout[id].w`) winning, but bump the floor so a stale narrow width
can't crush 3 columns.

`miniLayout` (L3117-3126) — the full-tab card — mirrors this:
```
const cl = sketchColLayout(se.node.ops, sketchCols(se.node));
const sch = 36 + cl.tallestH + MINI_FOOT_H;   // was 36 + opsH + MINI_FOOT_H
const scW = 12 + cl.innerW;                   // was MINI_SCW (152)
const w = sx + scW + 12;
```
and the markup's `{@const scW = sketchCardSize?.w ?? MINI_SCW}` (L6707) becomes
`?? (12 + cl.innerW)`. `scH` (L6708) already reads `?? ml.sch`, which now
carries the column-aware height. Footer (`.ge-sketch-foot`, L6828) sits below
all columns and already wraps; with a wider card it has more room.

## 6. Scroll / visibility

Wrapping is meant to REPLACE most of the need to scroll: the auto-fit card now
grows to the tallest column instead of the full op sum, so in auto mode
(`sketchCardSize === null`) it shows everything. Scroll remains only when the
user manually shrinks the card via the resize grip (sets `sketchCardSize`).

`sketchRowVisible(node, idx, scH)` (L2407) and `sketchOpsScrollTop` (L3509)
keep working with one change: thread `cols` so `top = sketchRowTop(node, idx,
cols) - sketchOpsScrollTop`. The `[36, scH]` band check stays correct per-row
because every cell's `yTop` already includes the 36 header and is the row's
real card-space Y. Note one behaviour change to verify: all columns live in ONE
scroll container, so they scroll together — acceptable, since each row's
visibility is still judged by its own `yTop`. (If a future need arises to scroll
columns independently, that's out of scope.)

## 7. Sequence arrow

Recommendation: the **simplest legible** option — a small down-glyph at each
column foot plus a short elbow connector to the next column's head, drawn as an
SVG overlay (NOT HTML), so it can span the inter-column gutter and carry an
arrowhead `<marker>`.

- Render in the `.ge-sketch-cards` overlay SVG (full-tab card), inside the
  sketch card `<g transform=translate(sketchCardPos.sketch...)>` group, AFTER
  the foreignObject and BEFORE/clear of the left-edge sockets.
- For each adjacent column pair c -> c+1: a faint dashed path from the bottom
  of column c (x = c-col-right-edge, y = 36 + columnHeight[c]) elbowing up to
  the top of column c+1 (x = (c+1)-col-left-edge, y = 36), with a small
  arrowhead at the head. Place the elbow in the gutter so it never overlaps the
  col>0 left-edge sockets (sockets are at each column's far-left; the connector
  leaves column c from its RIGHT/bottom and arrives at column c+1's TOP —
  approach from above, not from the socket side).
- Optionally a tiny "down" arrowhead at each column foot to reinforce
  top->bottom. Keep it subtle (stroke `#c4b5fd`, `stroke-dasharray`, no fill)
  so it reads as a hint, not a wire.

Use the same `SKETCH_COL_W` / `SKETCH_COL_GAP` / `tallestH` / per-column height
from `sketchColLayout` so the arrow tracks edits. Only draw when
`cols > 1`. Skip on the on-graph node card (it stays single-column unless its
own `layout.cols` is set; if it is, draw the same overlay there too — the
markup at L6246-6264 is the analogous socket block).

Rejected alternative: per-column "1 -> 2 -> 3" numeric badges. Less direct than
a flow arrow and competes with the existing per-point number labels on canvas
(L6654).

## 8. Toolbar control

A segmented `1 | 2 | 3` button group in the top tool rail `.ge-sketch-vtools`
(L6606-6616), after a `.ge-stool-sep`, styled with the existing `.ge-stool`
class and `.on` for the active count (matches the select/line/spline buttons):

```svelte
<div class="ge-stool-sep"></div>
{#each [1, 2, 3] as n}
  <button class="ge-stool" class:on={sketchCols(se.node) === n}
    title="{n}-column op layout"
    onclick={() => setSketchCols(se.node.id, n)}>{n}</button>
{/each}
```

This is the most discoverable home and needs no new CSS. (`se` = the active
`sketchEditor`; `se.node` is in scope in that block — confirm against the
`sketchEditor` derived used at L6606+.) The on-graph node card gets no
control in PR-1; if desired later, a small cycle button can call
`setSketchCols` there too.

## 9. Risk-sequenced, independently buildable steps

Each step ends green on `bun run build` + `bun run test:graph`.

1. **Pure helper + type, no UI.** Add `cols?: 1|2|3` to `LayoutXY`
   (composition-graph.ts L244). Add `SKETCH_COL_W`, `SKETCH_COL_GAP`,
   `sketchColLayout`, `sketchCols`/`setSketchCols`, `sketchSockX`. Add the
   optional `cols=1` param to `sketchRowTop`/`sketchSock*`/`sketchRowVisible`.
   Touch NO markup. Assert `cols=1` reproduces today's `sketchRowTop` values
   (a small Vitest in the style of `sketch.test.ts` is ideal). Build stays
   byte-identical in behaviour. LOWEST risk.
2. **nodeSize + miniLayout width/height** read `sketchColLayout` but with
   `cols` still forced to 1 everywhere (no toolbar yet). Confirms the new
   formulas equal the old ones at cols=1. Pure sizing, no socket/markup change.
3. **Toolbar control + state wiring** (step 8) so `sketchCols(node)` can become
   2/3, but the full-tab card markup still renders one column (ignore cols in
   render). Now the CARD RESIZES (wider/shorter) when you pick 2/3, but rows
   are still single-column — visible proof the sizing seam works before the
   risky markup change.
4. **Full-tab card column render** (step 4 markup) + socket `cx` -> `sketchSockX`
   + thread `sketchCols(sn)` into every `sketchSock*`/`sketchRowVisible`/
   `sketchRowTop` call in the L6711-6858 block. This is the fragile
   HTML/SVG-agreement step; verify sockets sit on rows in all of 1/2/3.
5. **Sequence arrow overlay** (step 7). Pure additive SVG, gated on `cols>1`.
6. **(Optional) On-graph node card** — apply the same render + `sketchSockX`
   to L6189-6264 so a persisted `layout.cols` also reflects there. Defer if not
   needed.

## Smallest-first PR recommendation

Ship **steps 1-3 as PR-1**: the type field + pure `sketchColLayout` helper +
threaded (default-1) geometry params + column-aware `nodeSize`/`miniLayout` +
the `1|2|3` toolbar. At cols=1 nothing changes; at cols=2/3 the card visibly
resizes (shorter + wider) while still rendering a single column. This lands the
whole load-bearing seam (state, persistence, sizing, control) behind tests with
ZERO change to the fragile foreignObject/socket markup. PR-2 then does the
genuinely risky part in isolation — the column render + `sketchSockX` wiring
(step 4) — and PR-3 adds the sequence arrow (step 5). Keep the on-graph card
(step 6) out of the critical path.

## Future: share with the polygon card

`polyRowTop` (~L2375) / `polySockR/Z/Ref` (~L2384) are the exact same
cumulative-walk pattern with heterogeneous entry heights (`polyEntryH`,
vertex=45 / repeat-ref=38 / repeat=74). Once `sketchColLayout` is proven, a
generalised `colLayout(entries, heightOf, cols)` could back BOTH cards. Do NOT
attempt that refactor in this feature — note it as a follow-up so the polygon
card's socket contract isn't disturbed while the sketch column work stabilises.

## Critical files for implementation

- `src/lib/shared/GraphEditorPane.svelte` (helpers ~L2392-2410, `nodeSize`
  ~L2464-2472, `miniLayout` ~L3117-3126, toolbar ~L6606-6616, full-tab card
  markup ~L6774-6864, on-graph card markup ~L6189-6267, CSS ~L8583-8627)
- `src/lib/graph/composition-graph.ts` (`LayoutXY` L244, `setLayout` L481,
  hydrate L325-341)
- `src/lib/graph/composition-emit.ts` (`serialiseGraph` layout round-trip L649-655)
- `src/lib/graph/sketch.test.ts` (model for a `sketchColLayout` unit test)
