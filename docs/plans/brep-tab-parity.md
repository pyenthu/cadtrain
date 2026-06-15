# Plan — BREP tab parity with the 3D-bake chrome

> **Status:** PLAN ONLY (no `src/` changes in this commit).
> **Goal (user, verbatim):** "The BREP tab is not in the same format as the 3D
> bake system. We need the same canvas, controls and buttons and the badges."

The BREP tab must drop its bespoke raw-Three viewer and reuse the SAME scene /
canvas chrome as the 3D-bake tab: camera + lights + orbit, the ⚙ scale gear,
the SceneControls camera/lights popover (zScale · Cross-section · Edges · Ortho
· Z-light · Warp), the Z-pan slider, the tri/vert stats line, the 🔄 rebuild,
and the **cached / fresh(yellow)** badge.

---

## 1. Current state (verified 2026-06-15)

### The BREP tab today
- `src/lib/shared/PrimitiveBrepView.svelte` — a **bespoke raw-Three** viewer:
  its own `WebGLRenderer` + `PerspectiveCamera` + `OrbitControls` + RAF loop +
  three hand-rolled lights, a `.brep-tools` HUD (`✂ cut`, `🔄`), a `.brep-hud`
  stats line (`{tris} tris · {verts} verts · {ms}ms OCCT · {clientMs}ms
  round-trip`). It POSTs `{ source, paramValues, tolerance:0.05, cut }` to
  `/api/brep/preview` and builds a `THREE.BufferGeometry` from the response
  (`positions` / `index` / `normals`, + per-vertex `colors` when `cut`).
- Mounted in `src/lib/shared/GraphEditorPane.svelte` (~L7274) inside
  `.ge-glb-body class:hidden={rightTab !== 'brep'}`, lazy-loaded (~L2898), fed
  `source={bake.source}` + `paramValues={brepParamValues}` (the latter derived
  ~L2906 from `graph.params` order ↔ `bake.args`/`paramDefaults`).
- **Shares NOTHING** with the 3D-bake chrome — none of the gear, controls,
  badges, z-pan, view-scale, ortho, or the shared `scene` state.

### The 3D-bake chrome to match
- `src/lib/shared/PrimitiveDualCanvas.svelte` — owns the chrome: `<Canvas>` +
  `PrimitiveDualScene` + `SceneControls`, the **⚙ scale menu** (xScale/zScale),
  the **🔄 rebuild + `seg` segments** input, the **Z-pan vertical slider**, the
  tri/vert **stats** line, the **⬇ GLB** button, a module-scope `fetchCache`
  (survives tab unmount/remount). Fetches `/api/primitives/preview` (mesh →
  `{ full, cutVC, instanced }` via `deserializeComponentResult`) and
  `/api/primitives/bake-preview` (GLB blob). Gated by `bakeMesh` / `bakeGlb`
  props (the 3D tab passes `bakeGlb={false}`; the GLB tab `bakeMesh={false}`).
- `src/lib/shared/PrimitiveDualScene.svelte` — the Threlte scene. Renders from
  `geo = { full, cutVC, instanced }` (THREE `BufferGeometry` objects):
  - `instMesh` (instanced Stack/Repeat) → else
  - `showCutaway && cutVC` → vertex-coloured half-section, else
  - `full` → flat `#cc2222` (or vertexColors if the geo carries `color`).
  - `<Edges thresholdAngle={20}>` when `scene.showEdges`; lights / ambient /
    directional from shared `scene`; auto-fit + ortho frustum + Z-pan + the
    view-scale group `[xScale,xScale,zScale]`; writes `scene.partCenter` +
    `scene.partZExtent` (drives the Z-pan slider range and the Z-light strip).
  - GLB half loaded only when `glbUrl` is set.
- `src/lib/shared/SceneControls.svelte` — the camera/lights ⚙ popover. Writes
  shared `scene`: Cam xyz · `Z×` (zScale) · **Cross-section (`showCutaway`)** ·
  **Edges (`showEdges`)** · **Ortho (`cam3dOrtho`)** · **Z light** (`zDirLight`
  + intensity + bearing) · **Warp**.
- `src/lib/shared/scene-state.svelte.ts` — the shared `scene` runes object
  (`zScale`, `xScale`, `zFocus`, `showCutaway`, `showEdges`, `cam3dOrtho`,
  `zDirLight*`, `warp*`, `partCenter`, `partZExtent`, …). One global instance —
  **whatever drives the 3D tab already drives any BREP reuse for free.**
- **The cached/fresh badge lives in `GraphEditorPane`, NOT the canvas**
  (~L7163–L7196, `.ge-bake-meta`): reads `bake.bake` meta (`cached`,
  `cacheHash`, `_t` timings, `cutawaySkipped`) → green `✓ cached · N ms`,
  yellow `fresh · N ms`, or red `cutaway off (perf)` + `Load`. The 🔄 fresh-bake
  was moved INTO the canvas; this row is now just the badge + status.

### BREP server (`/api/brep/preview` + `src/lib/server/brep-occt.ts`)
- Endpoint returns `200 + { supported, positions, index?, normals?, colors?,
  cut, meta:{ tris, verts, ms, tolerance } }`. **Isolation contract:** never
  500s — every failure is `200 + { supported:false, reason }`.
- `cut:true` re-bakes a NON-INDEXED **per-vertex-coloured** half-section
  (red outer / grey bore) — i.e. server-side cutaway, unlike the 3D tab's
  client-side Manifold `cutVC`.
- **No mesh cache.** `brep-occt.ts` caches only the OCCT module init
  (`_ocReady`); there is no per-request bake cache and the endpoint has no
  `cacheHash`. (Confirmed: zero `bake-cache` / `cacheHash` / `Map` refs.)

---

## 2. Reuse-vs-adapt decision

**Decision: REUSE — teach `PrimitiveDualCanvas` to source its geometry from the
BREP backend, and mount THAT in the BREP tab.** Retire
`PrimitiveBrepView.svelte`.

Rationale:
- Genuine parity ("same canvas, controls, buttons, badges") requires the **whole
  chrome stack**, and most of it (⚙ scale, 🔄, Z-pan, stats, the SceneControls
  mount) lives in `PrimitiveDualCanvas`, *not* in `PrimitiveDualScene`. Reusing
  only the scene would still force re-implementing the gear / z-pan / stats —
  i.e. duplication. So the reuse boundary is the **canvas**, not the scene.
- `PrimitiveDualScene` already renders exactly the two shapes BREP produces:
  a plain `full` mesh and a vertex-coloured cut mesh. The adapter is small:
  build a `THREE.BufferGeometry` from the BREP response and hand the scene
  `{ full }` (no-cut) or `{ cutVC }` (cut) — the SAME wrapper shape the
  Manifold path deserializes into.
- The shared `scene` runes object means lights / orbit / zScale / showEdges /
  ortho / Z-pan are wired the instant the same scene component mounts — no new
  state.
- **K.65 monolith risk** (`docs/plans/modularize.md`): one shared canvas is the
  single source of truth; duplicating chrome into `PrimitiveBrepView` is exactly
  the divergence the modularize plan warns against. (See also the
  cutaway-drift note in `todo_cutaway_unify`.)

**The adapter (BREP response → scene `geo`):**
| BREP response | → scene `geo` | scene render branch |
|---|---|---|
| no-cut: `positions`+`index`+`normals` | `{ full: <indexed BufferGeometry, normals kept> }` | `full` branch, flat `#cc2222` (or smooth — see note) |
| cut: `positions`+`colors`(+`normals`) | `{ cutVC: <non-indexed BufferGeometry, vertexColors> }` | `showCutaway && cutVC` branch |
| — | `instanced` always `undefined` | instanced path never triggers (N/A for BREP) |

Notes:
- BREP carries **exact-surface normals** — the whole point of the kernel. The
  scene flat-shades unless `smoothShade`. Pass **`smoothShade=true` in BREP
  mode** so the OCCT normals are used (the scene keeps `full`'s normals; it only
  strips normals for the GLB). The cut mesh is faceted regardless.
- BREP solid colour: scene `full`-no-color renders `#cc2222`; today's bespoke
  view used `#c0613a`. Accept `#cc2222` for parity (same red as the 3D tab).

---

## 3. Cutaway reconciliation (the one real semantic difference)

The shared **Cross-section** checkbox is `scene.showCutaway`.
- **Manifold (3D tab):** client-side — `showCutaway` just picks the already-
  fetched `cutVC` geometry (with a >15k-tri server auto-skip + lazy `Load`).
- **BREP:** server-side — `cut:true` must be added to the `/api/brep/preview`
  body so OCCT re-bakes the coloured half-section.

Reconciliation: in BREP mode the canvas **includes `scene.showCutaway` in the
fetch key** (it already does for the Manifold cutaway), so toggling the checkbox
re-fetches with `cut: scene.showCutaway`. The response then carries EITHER
`full` (cut off) OR `cutVC` (cut on) — never both. The scene's
`showCutaway && cutVC ? cutVC : full` rule renders the right one in both cases
(when `cutVC` is null it falls through to `full`, even with `showCutaway` true),
so **the same checkbox drives both tabs** — only the cost model differs (BREP
pays a server re-bake on toggle; that's inherent to server-side sectioning).

---

## 4. Control / button / badge mapping (3D-bake → BREP)

| 3D-bake affordance | Where it lives | BREP equivalent |
|---|---|---|
| Orbit / zoom / pan (OrbitControls) | PrimitiveDualScene | **Reuse** ✓ |
| Lights (zDirLight + ∠ + i, ambient) | scene-state / scene | **Reuse** ✓ (shared `scene`) |
| ⚙ **scale** menu (xScale / zScale / 1:1) | PrimitiveDualCanvas | **Reuse** ✓ (view-only group scale, geo-agnostic) |
| **Z-pan** vertical slider + ⊙ reset | PrimitiveDualCanvas | **Reuse** ✓ (range from `partZExtent`, written by scene from bbox) |
| SceneControls ⚙: Cam / **Z×** | SceneControls | **Reuse** ✓ |
| SceneControls: **Cross-section** | SceneControls | **Reuse** ✓ — drives a server re-bake (§3) |
| SceneControls: **Edges** | SceneControls | **Reuse** ✓ (works on indexed `full`; noisier on non-indexed cut but functional) |
| SceneControls: **Ortho** | SceneControls | **Reuse** ✓ |
| SceneControls: **Z light** | SceneControls | **Reuse** ✓ |
| SceneControls: **Warp** | SceneControls | **Reuse** ✓ (geometry subdivide — harmless; experimental) |
| 🔄 **Rebuild** | PrimitiveDualCanvas | **Reuse** → busts client fetch-cache (+ server cache in PR3); re-runs OCCT |
| **`seg`** segments input | PrimitiveDualCanvas | **Repurpose → `tol`** (OCCT linear deflection; default 0.05). OCCT has no segment count; per "expose dials, don't hide" we keep a visible dial, just relabelled in BREP mode |
| tri / vert **stats** line | PrimitiveDualCanvas | **Reuse + extend** → append `· {ms}ms OCCT` from `meta` |
| ⬇ **GLB** download | PrimitiveDualCanvas | **N/A** (no GLB in BREP) — hidden in BREP mode (STEP/mesh export = future, out of scope) |
| GLB **cut** label-toggle | PrimitiveDualCanvas | **N/A** (no GLB half) |
| GPU **instancing** | scene `instMesh` | **N/A** (`instanced` undefined → path never triggers) |
| `✓ cached` / `fresh · N ms` **badge** | GraphEditorPane `.ge-bake-meta` | **Parity** → `✓ cached` / `fresh · N ms OCCT` (PR2 wiring; PR3 server cache makes "cached" durable) |
| `cutaway off (perf)` skip badge + Load | GraphEditorPane | **N/A** (BREP always computes the cut server-side; no >15k auto-skip) |
| drift ⚠ badge | GraphEditorPane (graph-level) | Unchanged (tab-independent) |

---

## 5. Risk-sequenced steps (smallest-first; each `bun run build` green)

### PR1 — Backend switch in `PrimitiveDualCanvas` (no wiring; default unchanged)
Smallest, fully backward-compatible.
- Add props: `backend?: 'manifold' | 'brep'` (default `'manifold'`),
  `brepSource?: string`, `brepParams?: Record<string, number>`,
  `tolerance?: number` (default 0.05).
- In `rebuildMesh`, branch on `backend`:
  - `'manifold'` → unchanged.
  - `'brep'` → POST `/api/brep/preview` with `{ source: brepSource, paramValues:
    brepParams, tolerance, cut: scene.showCutaway || undefined }`; build a
    `THREE.BufferGeometry` from the response; set `geo = { full }` (no-cut) or
    `{ cutVC }` (cut). On `{ supported:false }` set an `err`/empty state with the
    `reason`.
- Reuse the module-scope `fetchCache` (include `backend` + `tolerance` + `cut`
  in the key) → a cache hit is the "cached" signal.
- Force `bakeGlb=false` when `backend==='brep'`; relabel `seg`→`tol`
  (number input bound to `tolerance`); hide ⬇ GLB + GLB-cut toggle in BREP mode;
  pass `smoothShade` through for BREP `full`.
- Surface bake meta upward: add `onBakeMeta?: (m:{ cached:boolean; ms:number;
  tris:number; verts:number; supported:boolean; reason?:string }) => void`
  (called after each BREP fetch) so the parent can render the badge in PR2.
- **No GraphEditorPane change** → 3D + GLB tabs untouched, build green.
- Unit-test the response→BufferGeometry adapter (`tests/`).

### PR2 — Point the BREP tab at the shared canvas; wire the badge
- In `GraphEditorPane`, replace the `PrimitiveBrepView` mount (~L7274) with
  `PrimitiveDualCanvas backend="brep" brepSource={bake.source}
  brepParams={brepParamValues} … showControls showLabels={false}`.
- Add a `.ge-bake-meta` row for the BREP tab fed by `onBakeMeta`: green
  `✓ cached` / yellow `fresh · {ms} ms OCCT` (mirror the existing markup +
  `.ge-cache-badge` classes). `supported:false` → show the `reason` line
  (same "no BREP path" message, but inside the shared chrome).
- Remove the now-dead lazy import of `PrimitiveBrepView` (~L2898) and the
  `PrimitiveBrepView` state; **`git mv` `PrimitiveBrepView.svelte` →
  `archive/src/lib/shared/`** (revivable; matches the 2026-06-12 archive
  pattern) rather than deleting.
- e2e: BREP tab on a revolve part (e.g. a `g_*`) shows the shared gear +
  controls + badge and renders; a non-revolve/CSG-only part shows the `reason`
  inside the chrome (Rule 11/12 — record the run).

### PR3 — BREP server bake cache (makes the cached/fresh badge durable)
Mirror `src/lib/server/bake-cache.ts`.
- Add a keyed cache in `brep-occt.ts` (or the endpoint) on
  `hash(source + JSON(paramValues) + tolerance + cut)` → return `cached:true` +
  `cacheHash` + the cached mesh; otherwise compute, store, return `cached:false`.
- Now the canvas's `onBakeMeta.cached` reflects a real server cache (not only
  the client fetch-cache), and 🔄 (`?bust=1`-equivalent) forces a fresh OCCT
  bake → yellow `fresh` badge, exactly like the Manifold tab.
- Keep the isolation contract: cache failures degrade to a normal fresh bake.

### PR4 — polish (optional, only if the user wants it)
- Tolerance dial UX (sensible min/max/step; show the effective deflection).
- Edges on the non-indexed cut mesh (index it server-side, or skip edges when
  cut) for a cleaner overlay.
- Consider folding the BREP `reason`/empty state into the shared error chrome.

---

## 6. Smallest-first PR (the one to start with)

**PR1** — add the `backend:'brep'` switch + response→`BufferGeometry` adapter to
`PrimitiveDualCanvas`, default `'manifold'`, **no GraphEditorPane wiring**. It is
self-contained, leaves every existing call site (3D + GLB tabs, typed builders)
byte-identical, ships with a unit test for the adapter, and keeps `bun run build`
green — establishing the shared-canvas reuse boundary before any user-visible
swap in PR2.

---

## 7. Files touched (by PR)

- **PR1:** `src/lib/shared/PrimitiveDualCanvas.svelte` (+ a small adapter test in
  `tests/`).
- **PR2:** `src/lib/shared/GraphEditorPane.svelte`; `git mv`
  `src/lib/shared/PrimitiveBrepView.svelte` → `archive/src/lib/shared/`;
  `tests/e2e/graph-editor.spec.ts`.
- **PR3:** `src/lib/server/brep-occt.ts` and/or
  `src/routes/api/brep/preview/+server.ts` (+ reference `bake-cache.ts`).
- **Not touched:** `PrimitiveDualScene.svelte`, `SceneControls.svelte`,
  `scene-state.svelte.ts` — reused as-is (the win of the reuse decision).
