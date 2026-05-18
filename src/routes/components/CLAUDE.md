# `/components` — the CAD product UI

The active CAD route (the legacy `/cad` stub is gone — navbar and
landing both point here). Single-page Svelte 5 app with a sidebar of
component classes, a centre canvas (`ComponentScene.svelte`), and a
right-pane inspector. Backed by `/api/components/*` and `/api/kb/*`.

## Sidebar — two-axis classification (tab → group → entry)

The sidebar uses a consistent pattern for every tab that lists
components. New components are placed by editing ONE central map; the
UI auto-groups, filters, and collapses based on it.

- **Tab** (rail entry) — top-level scope: **Basic** · **Parts** ·
  **Assemblies** · **KB** · **Operator**.
- **Group** — secondary axis per tab. Parts groups by **Family**
  (8 families: casing_tubing, drillstring, wellhead_xt, packers,
  fishing, artificial_lift, flow_control, plus a basic catch-all).
  Basic groups by **Level** (1 = atomic shapes, 2 = with features).
  KB-DB groups by Family.
- **Entry** — the actual component / KB row / source / operator.

**Source of truth**: `src/lib/cad/components/families.ts`:

- `FAMILY_BY_ID: Record<string, Family>` — family per component id
- `LEVEL_BY_ID: Record<string, Level>` — level per basic-family id

When you add a new component, edit only this map; the sidebar
auto-discovers the file via `import.meta.glob` and renders it in the
appropriate group. Components missing from a map fall back to safe
defaults (`familyOf` → `'basic'`, `levelOf` → `1`) so the entry stays
visible until classified — no silent disappearance.

**Don't** hard-code `family` / `level` per component file —
per-file annotations drift, the central map doesn't. Don't introduce
a new axis without a corresponding `<map>_BY_ID` in `families.ts`.

## Sidebar UI contract

Mirror this when adding a new group axis:

- **Funnel filter button** inline with the sidebar search input, shown
  only when the active tab uses this axis
  (`{#if sidebarTab === 'components'}` / `{#if sidebarTab === 'basic'}`).
- **FloatingPanel popup** anchored to the funnel via
  `getBoundingClientRect`. 2-column card grid, Select-all /
  Unselect-all / Done action row pinned at the top,
  click-outside-to-close.
- **Persistent filter state** via localStorage. One key per axis:
  `cad:enabledFamilies`, `cad:enabledBasicLevels`. Load in `onMount`;
  save on every toggle.
- **Collapsible group headers** in the list. State in
  `collapsedFamilies` (a Set keyed by `<ctx>:<groupId>`). The ctx
  string (`'components'`, `'basic'`, …) namespaces collapse state per
  tab so the same group id across tabs doesn't collide.
- **Default state** in the helper: `defaultEnabledFamilies()` (every
  non-basic family on), `defaultEnabledLevels()` (every level on).

## KB rail tab

Two inside-tabs (`kbSubTab` state):

- **Sources** — raw documents from `<volume>/kb-sources/`, via
  `/api/kb/sources`. Clicking a row opens an embedded viewer in a
  main tab. PDFs use `<embed type="application/pdf">` (Chrome's PDF
  viewer; sandboxed iframes block it). URLs use `<iframe>` with no
  sandbox + header fallback link for hosts that refuse iframing.
- **DB** — structured KB tables from `<volume>/kb/index.json`, via
  `/api/volume?path=kb/index.json`. Re-extracted by `scripts/kb/*.ts`
  then re-uploaded to the volume.

## Inspector — Parts tab conventions

Order of inspector tabs: **⚙ Settings → Parts → Builder → AI**. The
gear is leftmost; AI sits to the right of Builder. Settings holds
per-part name + id rename + autoTranslate toggle + per-instance
viewer colour controls.

### Instance accordions

- Each instance is its own row with an accordion head. Body caps at
  `220px` overflow-y:auto (`.pg-acc-body`) — keeps long parts
  scrollable without exploding the inspector.
- Inside overflow:auto containers, tooltips MUST use the `floatingTip`
  Svelte action (body-portaled, position:fixed, mirrors `data-tip`
  style). Native `title` is too slow; CSS `::after` gets clipped by
  the overflow.
- Clicking ⚙ / ↳ / ✎ on a head auto-opens the body — the intent of
  those icons is always to edit.

### Prop cards

Single-row layout via `display: contents` on head/value wrappers +
`order: 2` on the ƒ chip. Grid `minmax(200px, …)`. The explicit ƒ
button next to each input is a KEEP — replacing it with
input-background tinting was rejected as too subtle.

### Apply input on Enter

Prop inputs commit on **Enter only**, not on keystroke. Enter
triggers `/api/components/geom` to refresh mesh + GLB. (Live
keystroke rebuilds were too jittery.)

### Popups over inline editors

`+` / `✎` open SVTC-style FloatingPanel popups anchored to the
trigger button. The unified Excel-style prop cell was tried and
rejected as "unwieldy". Exception: the chain-op popup uses inline
typeahead.

### Per-instance viewer colour (Phase A — UI only)

`meta.instanceColors?: Record<string, string>` maps instance name
(`A`, `B`, …) → `#rrggbb` hex on a library part's `meta.json`. The
inspector renders a 14×14 swatch in each instance accordion head + a
4px coloured left-border stripe; clicking the swatch opens a
FloatingPanel with the 12-stop palette
(`src/lib/shared/instance-colors.ts` → `INSTANCE_PALETTE`). Unset
instances fall back to `colorForInstance(name)` — an FNV-1a hash into
the palette, deterministic + distinct without user action.

`setInstanceColor` POSTs the COMMITTED source (not `sourceDraft`) so
an in-flight inspector edit doesn't get committed alongside the
colour change.

**Phase A is UI only** — the scene + GLB still render the existing
red-outer / grey-bore vertex-colour convention. The geometry tint
(Phase B) requires a `GeomAcc.add(part, name?)` segment refactor +
loader AST rewrite + per-segment cutaway — deferred to its own plan.

## Canvas controls

- The shared scene lives in `src/lib/shared/ComponentScene.svelte`.
- **Z× compression slider** is in the canvas SceneControls gear
  (NOT the stage header). Backing state is `scene.zScale` in
  `src/lib/shared/scene-state.svelte.ts`; the builder reads it via
  `setRenderZScale()`.
- **MeshPhongMaterial** is intentional — `MeshPhysicalMaterial`
  washes out on Mac GPUs.
- `preserveDrawingBuffer: true` so the canvas is capture-able for
  thumbnails.
- Camera: `position={[6, 0, 0]}` looking at origin, `up={[0, 0, -1]}`
  (Z-down convention — see `src/lib/cad/CLAUDE.md`).

## Save flow gotchas

- **Bundle file clobber risk**: `/api/components/save` on a bundle
  primitive (`src/lib/cad/components/<id>.ts`) rewrites the source on
  disk. If the arity changes from `(p)` to `(p, geom)` with an early
  return → the file becomes an empty-cube fallback and composite e2e
  tests fail. Always read back the file after a save on a bundle id.
- **`top` model + auto-translate**: parts that declare a `top`
  meta.params field stack by setting `top: PREV.top + PREV.length` in
  the call args and using `mv(ME, [0, 0, ME.top])`. The `+ Add` flow
  auto-emits this when `autoTranslate` (in `meta.json`, defaults
  true) is on. The Settings "Recalculate chain offsets" button walks
  every non-first instance, overwriting `ME.top` arg + the mv vec3
  to the canonical expression — useful after manual reordering or
  formula drift. Helpers (no `top` param) fall back to inlining
  `[0, 0, PREV.top + PREV.length]` in their mv.
- **Live cross-instance refs**: source like `B.top = A.top + A.length`
  is preserved on disk; the loader's `expandInstancePropRefs` (in
  `src/lib/server/component-loader.ts`) substitutes at exec time
  with a fixpoint loop (max 8 iterations) so chains cascade to
  literals before transpile. Editing A's `length` cascades
  automatically on the next preview/save.

## FloatingPanel z-index

`fixed: 1000` / `contained: 100` are tuned to clear sticky accordion
headers + the tab strip. Don't try to fight overflow clipping with
z-index — portal to body via `floatingTip` instead.
