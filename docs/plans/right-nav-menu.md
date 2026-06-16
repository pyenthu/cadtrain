# Right-Side Nav Menu — structure plan

> Status: PLAN (no source changed). Scope = the graph editor's right-hand
> chrome. Primary interpretation: the **right-pane vertical tab rail**
> (`RightPane.svelte`). Secondary: the **scene-controls ⚙ overlay**
> (`SceneControls.svelte`) that lives on the 3D canvas. Both are "the nav
> menu on the right"; this plan covers the tab rail in depth and folds the
> scene controls into a coherent whole.

## 1. Current state

### 1a. RightPane vertical tab rail
`src/lib/shared/graph-editor/RightPane.svelte` — a `grid auto 1fr`: a
vertical tab rail (`.ge-pane-tabs`, `writing-mode: vertical-rl`) on the left
of a body region (`.ge-pane-bodies`). Six flat, ungrouped tabs in fixed
source order:

| Tab | Label | What it shows |
|---|---|---|
| `bake` | `3D bake` / `2D preview` | live mesh + GLB dual canvas, or the 2D profile snippet |
| `source` | `SRC` | emitted `<id>.asm.ts` (read-only `<pre>`) |
| `md` | `MD` (+ char count) | drawing-descriptor markdown textarea + ✨ AI |
| `svg` | `SVG` | vector render (coarse/high), on-demand bake |
| `glb` | `GLB` | slow GLB-only bake, on-demand |
| `brep` | `BREP` | server-side OCCT true-curve render |

Properties:
- Tab selection persisted to `localStorage['ge-right-tab']`; bound to parent
  via `rightTab = $bindable()` (parent forces `source` on legacy load).
- Each body uses `class:hidden` (grid-stacked, `grid-area: 1/1`); `bake`,
  `source`, `md` stay mounted while hidden (instant switch, no lost typing).
  `svg` / `glb` / `brep` are gated behind `{#if rightTab === …}` so their
  expensive bakes run only when open (active-tab-only discipline).
- Each tab carries a `data-tip` tooltip. No visual grouping, no separators,
  no icons — purely uppercase text labels, vertical, equal weight.

Issues that scaling exposes:
- **Flat list of 6 (soon 7+).** No signal that `bake/svg/glb/brep` are all
  *geometry views* of the same part while `source/md` are *text*. They read
  as one undifferentiated stack.
- **Order is historical, not semantic.** `md` sits between `source` and the
  three geometry-renderer tabs (`svg/glb/brep`), splitting the renderer
  family.
- **No headroom.** A 7th/8th view (e.g. drawing/dimensioned, FEM overlay,
  STEP export) just lengthens the rail; nothing tells the user where a new
  view belongs.
- **`writing-mode: vertical-rl` text** is hard to scan at a glance; fine for
  6, poor for 10.

### 1b. SceneControls ⚙ overlay
`src/lib/shared/SceneControls.svelte` — NOT in the rail. It is an absolutely-
positioned gear button (top-right, `z-index: 30`) mounted *inside*
`PrimitiveDualCanvas.svelte` (line 452, `{#if showControls && SceneControls}`),
so it appears as an overlay on the `bake`, `glb`, and `brep` canvases. Click
expands a dark floating panel with: **Cam** xyz · **Z×** zScale slider ·
**Cross-section / Edges / Ortho** checkboxes · **Z light** (intensity, angle)
· **Warp** (axis, amp, freq). State lives in `scene-state.svelte.ts` (shared
singleton); warp commits re-bake via `warpBakeNonce`.

This is the *view-settings* surface. It is correctly scoped to the canvas
(it only makes sense over a 3D view), but it is visually and structurally
disconnected from the tab rail, and it grows unbounded (warp, z-light, and
future dials all pile into one flat panel).

### 1c. Route-level navigation (context, not in scope)
- `src/routes/+page.svelte` — landing menu (vertical list of route links;
  dark theme, `#cc2222` accent header). This is the *app* nav, not the
  editor nav.
- `/primitives` — left sidebar (parts tree) + multi-tab wrapper, each tab a
  `GraphEditorPane`. So horizontally: **left = parts**, **center = node
  graph**, **right = this pane**. The right pane is the only "what do I want
  to look at for THIS part" surface — which is exactly why it should read as
  a structured menu, not a flat strip.

## 2. Proposed structure

Two coordinated changes, both inside the right pane:

1. **Group the tab rail into labelled sections** so the rail communicates
   "geometry views vs. text/data" and has an obvious home for new views.
2. **Promote a `VIEW` settings affordance into the rail** (or keep the ⚙ on
   the canvas but visually tie it to the rail), so scene/camera/light/zScale
   controls are discoverable as part of the same menu rather than a floating
   mystery gear.

### 2a. Grouped rail — ASCII mock

```
┌──────────────────────────────────────────────┬─────────┐
│                                                │  VIEW   │  ← section label (muted, small-caps)
│                                                │ ┌─────┐ │
│                                                │ │ 3D  │ │  ← active (left accent bar + white bg)
│            node-graph canvas                   │ ├─────┤ │
│              (center pane)                     │ │ SVG │ │
│                                                │ ├─────┤ │
│                                                │ │ GLB │ │
│                                                │ ├─────┤ │
│                                                │ │BREP │ │
│                                                │ └─────┘ │
│                                                │  DATA   │  ← section label
│                                                │ ┌─────┐ │
│                                                │ │ SRC │ │
│                                                │ ├─────┤ │
│                                                │ │ MD• │ │  ← • dot = has content
│                                                │ └─────┘ │
│                                                │ ─────── │
│                                                │   ⚙     │  ← VIEW settings (scene-controls), pinned to rail foot
└──────────────────────────────────────────────┴─────────┘
```

Rail reads top→bottom as two named groups + a settings foot:

- **VIEW** (geometry renderers, all show the same baked part):
  `3D` · `SVG` · `GLB` · `BREP`
- **DATA** (text/authoring surfaces):
  `SRC` · `MD`
- **⚙ settings** pinned at the rail foot (scene/camera/light/zScale).

Within VIEW, order = fast→slow / default→specialist: `3D` (always-on, the
working view) → `SVG` (coarse, fast vector) → `GLB` (slow, on-demand export)
→ `BREP` (server OCCT, specialist). Within DATA: `SRC` (the canonical
emitted file) → `MD` (the hand-authored descriptor).

### 2b. Where scene/camera/light/zScale controls live

Recommended: **keep the actual control panel anchored to the canvas** (it
must overlay the 3D view to give live camera feedback), but **add a `⚙`
entry at the foot of the rail** that toggles the same `open` state. Concretely:
hoist `SceneControls`'s `open` flag into `scene-state.svelte.ts`
(`scene.controlsOpen`) so both the canvas gear AND a rail-foot ⚙ button drive
it. This makes view-settings a *named member of the right menu* (discoverable)
without moving the panel away from the geometry it controls.

The settings panel itself should also be grouped (it is currently a flat
stack) into the same VIEW vocabulary:

```
┌─ VIEW SETTINGS ──────────────── × ┐
│ CAMERA                            │
│   Cam  [x][y][z]   ☐ Ortho        │
│ DISPLAY                           │
│   Z×  [────●──]  ☐ Cross-section  │
│                  ☐ Edges          │
│ LIGHTING                          │
│   ☐ Z light   i[1.0]  ∠[0]        │
│ DEFORM                            │
│   ☐ Warp  (X)(Y)  a[ ] ƒ[ ]       │
└───────────────────────────────────┘
```

Sections: **CAMERA** · **DISPLAY** · **LIGHTING** · **DEFORM**. Same
grouping discipline as the rail, so the two surfaces feel like one menu.

### 2c. Scaling rules (how new views slot in)

- A new *renderer* (dimensioned drawing, FEM overlay, STEP/IGES export
  preview) → add to **VIEW**.
- A new *text/data* surface (BOM, params JSON, changelog) → add to **DATA**.
- A new *display dial* (section plane, explode, measure) → add a section to
  the **VIEW SETTINGS** panel, never a new top-level tab.
- Hard cap the rail at ~3 groups; if VIEW exceeds ~6, the least-used go
  behind a `⋯ More` disclosure at the group foot rather than lengthening the
  rail.

### 3. Grouping rationale

- **Job-to-be-done split.** "Look at the geometry" (VIEW) and "read/edit the
  text" (DATA) are different intents; the user picks a group first, then a
  variant. Two short scans beat one long one.
- **Renderer family stays contiguous.** Today `md` splits `source` from
  `svg/glb/brep`; regrouping reunites the four geometry renderers, which all
  share the bake result and (for 3D/GLB/BREP) the same `PrimitiveDualCanvas`
  chrome + ⚙.
- **Settings get a name.** The floating gear is undiscoverable; pinning a ⚙
  entry to the rail foot (sharing `open` state) makes view-settings a first-
  class, labelled member of the right menu.
- **Headroom is explicit.** Named groups + a `⋯ More` overflow give every
  future view a defined home and a defined ceiling, so the rail never just
  grows.
- **Consistency with existing chrome.** `/primitives` left sidebar is already
  a grouped tree (Rule 16, location = category); a grouped right rail mirrors
  that mental model (left = "which part", right = "which view of it").

## 4. Implementation plan

All changes confined to `src/lib/shared/graph-editor/RightPane.svelte`,
`src/lib/shared/SceneControls.svelte`, and `scene-state.svelte.ts`. No graph,
emit, bake, or server changes. Tab IDs (`bake/source/md/svg/glb/brep`) and the
`localStorage['ge-right-tab']` contract stay UNCHANGED — only presentation
groups, so persistence and the parent's `rightTab` binding keep working.

1. **Group the rail markup (RightPane).** Wrap the 6 existing `.ge-pane-tab`
   buttons in two `<div class="ge-tab-group">` blocks (VIEW: bake, svg, glb,
   brep; DATA: source, md), each preceded by a muted `.ge-tab-group-label`.
   Reorder buttons to the semantic order in 2a. Keep every `onclick`,
   `data-tip`, `class:active`, and `aria` attribute as-is. Add the small `•`
   dot to MD when `drawingMd` non-empty (replace the inline `· {n}c`, or keep
   the count — minor). Commit.
2. **Style the groups.** Add `.ge-tab-group` (flex column) + section-label CSS
   (small-caps, `#a8a29e`, ~9px, 4px vertical padding, a hairline separator).
   Keep the existing `.ge-pane-tab` vertical-text styling. Verify the active
   accent bar still reads. Commit.
3. **Hoist settings open-state (scene-state + SceneControls).** Add
   `controlsOpen = $state(false)` to `scene-state.svelte.ts`; change
   `SceneControls`'s local `open` to read/write `scene.controlsOpen`. No
   behaviour change yet (canvas gear still toggles it). Commit.
4. **Add the rail-foot ⚙ entry (RightPane).** After the DATA group, render a
   pinned `.ge-tab-settings` ⚙ button that toggles `scene.controlsOpen`.
   Because the panel is canvas-anchored, this only has effect when a canvas
   view (3D/GLB/BREP) is active — disable/dim it on SRC/MD/SVG tabs (or
   auto-switch to 3D). Commit.
5. **Group the settings panel (SceneControls).** Wrap the existing rows into
   CAMERA / DISPLAY / LIGHTING / DEFORM sections with the same label styling.
   Pure markup/CSS; no state changes. Commit.
6. **Verify.** `bun run build`; then `claude --chrome` on `/graph-editor?id=
   g_shaft&embed=1`: confirm (a) all 6 tabs still switch + persist across
   reload, (b) groups render with labels, (c) ⚙ rail button and canvas gear
   both toggle the same panel, (d) SVG/GLB/BREP still bake only when opened.
   Rule 11: offer an e2e run (`bun run test:graph`) after the UI change.

### Risks / notes
- **Don't change tab IDs or localStorage key** — parent binding + persistence
  depend on them (handoff memory: `rightTab` is bindable, parent sets
  `source` on legacy load).
- The settings panel must stay canvas-anchored (live camera feedback); the
  rail ⚙ is a *second trigger*, not a relocation.
- `writing-mode: vertical-rl` labels: section labels likely read better
  horizontal (rotate only the tab labels, not the group headers) — decide
  during step 2 visually.
- Low blast radius: presentation-only, two files + one state field. No bake,
  emit, or server path touched.

## 5. Alternative interpretation
If "the nav menu on the right" meant the **app-level route nav** (the landing
menu in `src/routes/+page.svelte`, since there is no global navbar after
2026-06-09), that is a different, smaller task: a persistent route switcher
(Primitives/Forge/Wells/FEM/Plan) docked right. Not pursued here — the editor
right-pane rail is the far more likely referent given "the editor."
