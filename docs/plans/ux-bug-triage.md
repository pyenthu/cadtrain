# UX bug triage — 2026-06-16

Read-only diagnosis of three reported bugs. Each section gives the root cause
(with `file:line`), the concrete fix, and an effort/risk estimate. No source was
modified; no commits made.

---

## Bug 1 — Sidebar folder-create does not appear

**Report:** Creating a sub-folder inside `basic` in the `/primitives` left
sidebar does nothing visible. The folder never shows up.

### Root cause — the empty folder IS created and IS in the data, but the render filters it out

The folder is created correctly:

- `mkFolder()` POSTs `/api/primitives/mkdir` and then `await loadList()`
  (`src/routes/primitives/+page.svelte:131-146`,
  `:157-164` for `createSubfolderIn`).
- `/api/primitives/mkdir` does a recursive idempotent `mkdir`
  (`src/routes/api/primitives/mkdir/+server.ts:28-30`).
- `mkdir` IS proxied to prod (`src/hooks.server.ts:29`, in `VOLUME_PROXY_PATHS`)
  and so is `list`, so both hit the same store — no local-vs-prod split.
- The `list` endpoint's `buildNode()` walks `readdir(..., {withFileTypes})` and
  emits a `FolderNode` child for **every** directory, including empty ones
  (`src/routes/api/primitives/list/+server.ts`, `buildNode`). So the new empty
  folder DOES appear in the returned `tree`.

The bug is purely in the sidebar render. The recursive folder snippet gates
child-folder visibility on `subtreeMatches`:

```
src/routes/primitives/+page.svelte:1036
  {@const kids = sortFolders(node.children, sortMode).filter((n) => subtreeMatches(n, pass))}
src/routes/primitives/+page.svelte:1134   (same filter for the active node's direct children)
```

`subtreeMatches` (`src/routes/primitives/primitives-tree.ts:37-39`) returns:

```
node.parts.some(pass) || node.children.some((c) => subtreeMatches(c, pass))
```

For a freshly-created **empty** folder both arrays are empty, so it returns
`false` — even when the filter box is empty (`[].some(pass)` is `false`
regardless of `pass`). Result: **empty folders are unconditionally hidden**, so
a just-created sub-folder never renders. (The same gate also hides empty
`completions/<family>` structure folders.)

Note: the `pendingCreated` optimistic-insert mechanism
(`+page.svelte:104-126`) keys off a part **id** (`treeHasId`), so it does not
help an empty folder — there is no part to track.

### Fix

Only apply the `subtreeMatches` filter when a filter is actually active. Two
identical edits:

`src/routes/primitives/+page.svelte:1036` and `:1134`, change:

```
.filter((n) => subtreeMatches(n, pass))
```
to:
```
.filter((n) => !filter.trim() || subtreeMatches(n, pass))
```

This shows all folders (including empty ones) when there is no filter, and keeps
the existing "hide non-matching subtrees while filtering" behaviour. The `empty`
placeholder row at `:1069` already handles the now-visible empty folder.

**Effort:** trivial (2-line change, same edit twice). **Risk:** very low — only
broadens visibility when the filter is empty; filtered behaviour unchanged.
**This is a safe ~1-liner — greenlight-ready.**

---

## Bug 2 — Z browser blocky / janky on long parts

**Report:** The vertical Z-pan slider on the right of the 3D view scrolls in
coarse jumps / janks for long parts.

### Root cause — the slider's `step` is dynamic and depends on the slider's OWN value

The slider (`src/lib/shared/PrimitiveDualCanvas.svelte:426-427`):

```
<input class="pd-zslider" type="range" min={zSpan.min} max={zSpan.max} step={zStep}
  bind:value={scene.zFocus} ... />
```

`zStep` is a `$derived` whose value depends on `scene.zFocus` (the slider's own
bound value) and `scene.cam`
(`src/lib/shared/PrimitiveDualCanvas.svelte:347-355`):

```
const tz = pc.z + scene.zFocus;
const dist = Math.hypot(scene.cam.x - pc.x, scene.cam.y - pc.y, scene.cam.z - tz);
const visible = 2 * dist * TAN_HALF_FOV;
return Math.min(total / 20, Math.max(0.02, visible / 120));
```

A range input snaps its `value` to the nearest multiple of `step`. When `step`
changes, the browser **re-snaps the thumb to the new grid**. Here every drag
tick mutates `scene.zFocus` → `tz` changes → `zStep` recomputes → the `step`
attribute changes mid-drag → the value re-snaps → the thumb visibly jumps.

The code comment claims "dragging the slider never changes its own step ...
distance is invariant under the pan" — that holds only at steady state. During a
drag `bind:value` updates `scene.zFocus` **synchronously**, but `scene.cam` is
only resynced **a frame later** by OrbitControls' change event (the Z-pan effect
in `src/lib/shared/PrimitiveDualScene.svelte:254-262` moves the camera, then
`onChange` writes `scene.cam`). For the intervening frame(s) `tz` has moved but
`scene.cam.z` has not → `dist` (hence `zStep`) shifts by the drag delta.

This is **worse on long parts** because `total` is large, so the active step
(bounded by `total/20` when zoomed out) is large, so the per-tick mismatch — and
the resulting re-snap jump — is large. On short parts the delta is tiny and the
re-snap is imperceptible. The `total/20` floor also caps a zoomed-out long part
at ~20 discrete stops, compounding the coarseness.

### Fix

Make the step independent of the slider's own value. Cleanest option — continuous
slider, no snapping at all (`src/lib/shared/PrimitiveDualCanvas.svelte:426`):

```
step="any"
```

(remove the `step={zStep}` binding). A range input with `step="any"` takes
continuous values, so there is no grid to re-snap to and the thumb tracks the
pointer smoothly regardless of part length or zoom.

If a discrete step is preferred (for keyboard arrow / wheel granularity), use a
**stable** step that does not depend on `zFocus`, e.g.:

```
step={Math.max(0.001, (zSpan.max - zSpan.min) / 1000)}
```

This gives a constant ~1000-stop resolution that never changes mid-drag.
`zStep`/`TAN_HALF_FOV` (`:347-355`) can then be deleted.

**Effort:** trivial (1-line for the `step="any"` route; a few lines if removing
the now-dead `zStep` derived). **Risk:** low — `step="any"` only affects slider
granularity; `scene.zFocus` clamping (`:362-367`) and the camera-pan effect are
untouched. **`step="any"` is a safe ~1-liner — greenlight-ready.**

---

## Bug 3 — Drag slippage (node card lags the cursor)

**Report:** Dragging a node card in the graph editor slips/lags behind the
cursor.

### Root cause — full-graph clone + re-render on every pointermove (no rAF coalescing)

The coordinate math and pointer capture are **correct**:

- `onNodePointerMove` divides the screen delta by `zoom`
  (`src/lib/shared/graph-editor/GraphEditorPane.svelte:1812-1818`):
  `dx = (ev.clientX - dragStart.x) / zoom`. Cards render inside
  `<g transform="translate(pan.x,pan.y) scale(zoom)">` (`:4072`), so screen
  delta `= dx * zoom = (clientX - startX)` → exact 1:1 with the cursor.
- Pointer capture is set on pointerdown (`:1809`,
  `setPointerCapture(ev.pointerId)`) and released on pointerup (`:1821`), with
  `preventDefault`/`stopPropagation` to block native text selection
  (`:1804`,`:1810`).

The slippage is a **render-throughput** problem. Every `pointermove` does:

```
src/lib/shared/graph-editor/GraphEditorPane.svelte:1817
  graph = setLayout(graph, dragging, { x: dragOrig.x + dx, y: dragOrig.y + dy, w: dragOrig.w });
```

`setLayout` (`src/lib/graph/composition-graph-mutate.ts:20-22`) returns a **new**
`graph` object (`{ ...graph, layout: { ...graph.layout, [id]: xy } }`).
Reassigning `graph` invalidates every `$derived`/`{#each}` that reads it — all
node cards, all param wires, and every `bezier()` route recompute on **each**
pointermove (which fire at up to ~120 Hz). On a dense graph a single frame's
render exceeds the inter-event interval, so layout writes queue and the dragged
card visibly **trails** the cursor — classic drag lag, not coordinate slippage.

### Fix

Coalesce the layout write into a single `requestAnimationFrame` per frame so at
most one re-render happens per painted frame:

- In `onNodePointerMove`, store the latest `{x,y}` in a ref and schedule an rAF
  (if not already scheduled) that applies it via `setLayout` once, then clears
  the handle. Cancel any pending rAF in `onNodePointerUp`.

A larger-but-better follow-up (optional): during an active drag, apply the live
offset directly to the dragged card's `transform` (a transient `$state` offset
read only by that one card) and commit to `graph.layout` only on pointerup. That
keeps the other cards/wires from re-rendering at all mid-drag.

The wheel-zoom (`:1717-1721`) zooms about the graph origin, not the cursor — a
separate, milder UX nit (content drifts under the cursor on zoom), not the
reported drag slippage; leave it out of this fix unless asked.

**Effort:** small (rAF coalescing ~10 lines) to moderate (transient-offset
refactor). **Risk:** low for rAF coalescing (behaviour identical, just
throttled); moderate for the transient-offset path (touches the render of the
dragged card). **Not a 1-liner**, but the rAF version is contained and safe.

---

## Summary

| Bug | Root cause | Fix | Effort / Risk |
|---|---|---|---|
| 1 Folder not appearing | `subtreeMatches` filter hides ALL empty folders, even with no active filter (`+page.svelte:1036,1134`) | gate the filter on `!filter.trim()` | trivial / very low — **safe 1-liner** |
| 2 Z browser blocky | `<input range step={zStep}>` where `zStep` depends on the slider's own `zFocus` → step changes mid-drag → value re-snaps (`PrimitiveDualCanvas.svelte:426,347-355`) | `step="any"` (or a stable span-based step) | trivial / low — **safe 1-liner** |
| 3 Drag slippage | every pointermove clones `graph` → full canvas re-render, no rAF coalescing (`GraphEditorPane.svelte:1817`, `setLayout`); coord math + capture are correct | rAF-coalesce the layout write (optionally transient drag offset) | small / low |
