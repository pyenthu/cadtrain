# `src/routes/vocab/` — the K.68/K.69 vocabulary editor UI

`/vocab` is the durable surface where vocabulary terms (`docs/parts/
vocabulary.json` + `vocabulary.seeds.json` + `proposed-vocab-entries.json`)
are browsed, reviewed, baked, and promoted. Mirrors the `/primitives`
chrome so a user fluent in one is fluent in the other.

## Layout (top → bottom, left → right)

```
┌───────────────────────────────┬────────────────────────────────────────────┐
│ Topology / Browse tabs        │ detail-head                                │
│ ├ Topology — Mermaid graph    │ ├ [kind] · h2 · inline bake-info · Bake · ✓ Promote · ⓘ Definition │
│ │  (vocabulary-graph.mmd)     ├───┬────────────────────────────────────────┤
│ │  click node → select term   │ I │  Inferred / Proposed tab body          │
│ │                              │ n ├────────────────────────────────────────┤
│ └ Browse — searchable term   │ f │ Proposed:                              │
│   list (54 entries = 13      │   │ ┌─ canvas (40%) ─┬─ Parameters ────┐  │
│   curated + 41 seeds)        │ P │ │                │   accordion      │  │
│                              │ r │ │   3D bake      ├──────────────────┤  │
│                              │ o │ │   (full col)   │   rule, def,    │  │
│                              │ p │ │                │   expects_bake,  │  │
│                              │   │ │                │   raw JSON       │  │
│                              │   │ └────────────────┴──────────────────┘  │
│                              │   │ Inferred:                              │
│                              │   │   2D drawing + Inferred 3D + polygon   │
│                              │   │   details + variants table             │
└───────────────────────────────┴───┴────────────────────────────────────────┘
   30 %                            70 %
```

- **Outer split 30/70** (draggable). Left = topology + browse. Right = active term work.
- **Left-pane tabs**: Topology (Mermaid) | Browse (54-row list).
- **Detail-head**: `[kind]` chip · `h2` term name · (Proposed tab only) `· Proposed 3D · <kind>` · `[Bake | retry | verts/z/r]` · `[✓ Promote]` · `ⓘ Definition & tags` popover.
- **Right-pane vertical rail** (Inferred · Proposed) — only for seeds. Curated terms get no rail, just the body.
- **Definition & tags popover** — 420 px panel; rich definition + chip groups (synonyms / function / form / variants / references). Closes on outside click via `svelte:window`.

## State model

- `selected: Term | null` — current term.
- `leftTab: 'topology' | 'browse'` — left pane.
- `detailTab: 'inferred' | 'proposed'` — vertical rail (seeds only).
  Effect: defaults to `'proposed'` on selection when a proposal exists,
  else `'inferred'`.
- `splitPct: number` (default 30) — outer column ratio.
- `infoPopoverOpen: boolean` — ⓘ Definition & tags popover.
- `paramsOpen: Record<Term, boolean>` — Parameters accordion per term.
- `inferCache: Record<Term, InferResult | 'loading' | error>` — `/api/vocab/infer` results.
- `proposedBakeCache: Record<Term, ProposedBake | 'loading' | error>` — `/api/vocab/bake-proposed` results.
- `paramOverrides: Record<Term, number[]>` — slider-edited args for the proposed bake (positional in `meta.params` order).
- `stableProposedArgs: $derived<number[]>` — **stable reference** for `PrimitiveDualCanvas` args. Critical: a fresh array every render makes the canvas re-mount → auto-fit loops infinitely (the bug fixed in commit `9ef94e9`).

## Layout contracts (don't break these — they bit me)

1. **`.bake-card.no-head` must give the canvas a defined height.**
   `display: block` + child `height: 100%` resolves to 0 → auto-fit feedback
   loop ("magnification keeps going indefinitely"). Use
   `display: flex; flex-direction: column;` on the card + `flex: 1 1 auto;
   min-height: 480px;` on `.bake-body`.

2. **`args` to `PrimitiveDualCanvas` must be a stable reference.** Use
   `$derived.by` (memoised by computed value identity), not an inline
   `?? defaultParams(...)` expression that builds a new array each render.

3. **`{@const}` placement is Svelte-5 strict.** It must be the immediate
   child of `{#if}` / `{:else if}` / `{:else}` / `{#each}` / etc. — NOT
   inside a plain `<div>`. Compute via `$derived` in the script when an
   inline `@const` doesn't fit.

4. **Diagram-pane grid is `auto 1fr`**, not the original `auto 1fr auto`.
   Removing the third row was needed for the Browse list to scroll
   properly (commit `909fd39`).

## Vertical-rail styling

Mirrors `/primitives` sidebar tabs (`prim-vrail` / `prim-vtab`):
`clip-path: polygon(0 14%, 100% 0, 100% 100%, 0 86%)` for the trapezoid,
`writing-mode: vertical-rl; transform: rotate(180deg)` for bottom-to-top
labels. Same colors (`#ececec` rail, `#444` idle, `#cc2222` active/hover,
`#fafafa` active background). When you restyle either page, restyle the
other to match.

## Layout backbones (CSS class anchors)

| Class | What it owns |
|---|---|
| `.vocab-root` | grid: header row + grid below |
| `.vocab-bar` | top bar — version, term counts, refresh-all |
| `.vocab-grid` | outer 30/70 grid (splitPct fr) + 7 px divider + 1fr |
| `.diagram-pane` | left pane (Topology + Browse tabs + content) |
| `.detail-pane` | right pane (flex column) |
| `.detail-head` | title row — kind chip + h2 + inline bake/promote + popover |
| `.vocab-tabs` | 28 px rail + tab body grid (seeds only) |
| `.vocab-vrail` + `.vocab-vtab` | vertical trapezoidal tabs |
| `.tab-body` | scrollable inner column (per Inferred / Proposed) |
| `.proposed-grid` | 4fr/6fr — canvas col + right col |
| `.proposed-canvas-col` | flex column, hosts `.bake-card.no-head` |
| `.proposed-right-col` | flex column with Parameters + rule-details |
| `.pg-acc-wrap` + `.pg-acc-head` + `.pg-acc-body` | Parameters accordion (matches `/primitives`) |
| `.info-popover-wrap` + `.info-pop-btn` + `.info-pop-panel` | Definition & tags popover |
| `.head-bake-info` + `.head-bake-stat` + `.head-promote` | inline title-row bake controls |

## Tab-body components (`_tabs/`, R8 modularize)

`+page.svelte` is the **shell**: data load (`+page.server.ts`), `selected` +
`leftTab` + `detailTab` state, the header bar, Topology (Mermaid) diagram, the
detail-head (kind chip · h2 · Definition&tags popover · Bake/Promote · Refresh ·
Graph-editor toggle), the seed Inferred/Proposed vertical rail + status lines,
the graph-editor iframe, and ALL bake/infer/promote `$state` + handlers
(`inferCache` / `proposedBakeCache` / `sceneCache` / `paramOverrides` etc. stay
in the shell so caches persist across rail toggles + seed↔curated navigation).

The four tab BODIES are extracted into `_tabs/` as presentational components
(state in, callbacks out — no own caches):

| Component | Renders | Key props |
|---|---|---|
| `BrowsePane.svelte` | left Browse list + search | `terms`, `bind:search`, `termFormat`, `cacheByExemplar`, `ruleSummary`, `onSelect` |
| `InferredTab.svelte` | seed Inferred body (2D ref + r_revolve bake + polygon/variants) | `entry`, `inf`, `PrimitiveDualCanvas`, `CompJsonSilhouette`, `promoteBusy`, `onInfer`, `onPromote` |
| `ProposedTab.svelte` | seed Proposed body (canvas + ParamGrid + composition tree) | `entry`(prop), `pb`, `pmap`, `paramsOpen`, `stableProposedArgs`, `onToggleParams`, `onParamUpdate` |
| `CuratedDetail.svelte` | non-seed stacked body (def + 2D/3D + params + rule blocks) | `entry`, `sc`, `lockEntry`, `PrimitiveDualCanvas`, `CompJsonSilhouette`, `ruleSummary` |

Each carries its OWN scoped CSS (atoms like `.bake-card`/`.block`/`.code` are
duplicated per component — self-contained by design). `ParamGrid` is imported
directly by `ProposedTab`; the lazy `PrimitiveDualCanvas`/`CompJsonSilhouette`
load once in the shell `onMount` and are passed down as props (do NOT fork them).

## Adding a new view-component

If you want to mount more chrome from `/primitives` in here (e.g. the
composition tree editor for a future asm-kind proposal), import the
`PrimitiveView` or `CompositionEditor` directly from `src/lib/shared/`.
Don't fork them — keep one source of truth so a fix lands in both UIs.
