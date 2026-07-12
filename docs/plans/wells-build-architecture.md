# /wells 3D-schematic — BUILD ARCHITECTURE (fast, multi-threaded, parametric-element-composed)

**Status:** DESIGN, 2026-07-04. Fleshes out `docs/plans/wells-ewells-gaps.md` **§A**
(A1 multi-threaded bake · A2 element libraries · A3 auto-scale). No feature code
in this doc — architecture + phased plan only.

Companion docs: `docs/plans/wells-ewells-gaps.md` (the gap list), `docs/plans/
well-schematic.md` (engine), `docs/plans/client-side-execution.md` (the bake
worker this rides on). Memories: `stack_cutaway_perf_root_cause`,
`client_side_execution`, `well_schematic_3d_first`.

> **The problem in one line.** ewells.app draws an *instant 2D SVG*. `/wells`
> builds *real watertight Manifold CSG shells + a half-section cutaway per
> element, synchronously, on the MAIN THREAD*, then bends each along the survey
> in a per-vertex JS loop. On a long/multi-string well the UI janks. The fix is
> not to abandon real geometry (it is cadtrain's differentiator — B4
> inspector-on-select needs true parametric parts) but to **move the build off
> the main thread, parallelize it per element, cache it, and render
> progressively** — exactly the pipeline the /primitives editor already ships
> (`client_side_execution`).

---

## 1 · Current build — what runs on the main thread, and why it janks

The whole 3D build lives in `src/lib/wells/WellSchematic3D.svelte` as a stack of
`$derived.by` blocks. Mounted by `WellViewPlaceholder.svelte` as
`<Canvas><WellSchematic3D {…settings} /></Canvas>`. Everything below runs on the
UI thread, synchronously, inside Svelte reactivity.

### 1a. The per-element CSG builders (the hot path)

`ohGeoms`, `chGeoms`, `cementGeoms`, `tubingGeom` each map WSON rows through
`cutCylinder` / `cutTube` (from `threeD/manifoldCut.ts`). For a **vertical**
well each element does:

```ts
// manifoldCut.ts cutTube — vertical fast path
const outer = Manifold.cylinder(len, outerR, outerR, 64);
const inner = Manifold.cylinder(len + 0.02, innerR, innerR, 64).translate([0,0,-0.01]);
const ring  = outer.subtract(inner).translate([0,0,top]);
const result = ring.subtract(cutterBox(cutAxis));   // ← half-space CSG cutaway
return manifoldToColoredGeo(result, cutAxis, mainColor, …);
```

`cutterBox` is a `Manifold.cube([1e5, 2e5, 2e5])` half-space; **subtracting it is
the CSG cutaway**, and it runs once *per element*. This is the super-linear cost
called out in memory `stack_cutaway_perf_root_cause` (cutaway CSG cost grows
faster than linearly in triangle count; the prescribed fix there is **per-part
cutaway**, which this design adopts and moves off-thread).

### 1b. Long-string blowup

`boreNDivisions(len) = Math.max(20, Math.ceil(len / 5))`. A 5000 m casing string
extrudes **1000 axial rings**; the deviated path (`Manifold.extrude(halfRingCs,
len, boreNDivisions(len))`) then feeds that into `warpGeometry`, whose per-vertex
parallel-transport loop touches *every* vertex:

```ts
for (let i = 0; i < pos.count; i++) { … rodrigues frame lerp … pos.setXYZ(i, …) }
pos.needsUpdate = true; geo.computeVertexNormals();
```

So a long deviated well = (big extrude) × (per-vertex JS warp) × (N strings), all
on the UI thread with no yield.

### 1c. Full-remount churn

The scene wraps every mesh in `{#key geomKey}` where
`geomKey = cutActive|cutAxis|diaScale|directional|cutAzimuth|profileFingerprint`.
Any dial change (Dia×, Depth×, cut azimuth, cutaway toggle) changes the key →
Svelte tears down and **rebuilds all meshes** → every `$derived.by` above
re-runs → **all CSG re-executes from scratch**. This is the same anti-pattern the
editor already fixed (`graph_editor_drag_bake_perf`: "canvas remount on re-bake →
4× bake churn — keep it mounted").

### 1d. What's already off the synchronous path (the seed)

Only **completions** defer: `compMarkers` → `getBuilder(tool_comp)` →
`buildCached(builder, params)` returns a Promise into a `$state` map
(`parametricGeoms`). But `buildCached` still runs Manifold on the **main thread**
(a microtask, not a worker) — it de-janks nothing, it just reorders. It is,
however, the right *shape*: a keyed async cache feeding a `$state` map the scene
reads. Phase 2 turns that shape into a real worker pool for *all* elements.

### 1e. Hot-spot summary

| Cost | Location | Scales with |
|---|---|---|
| Half-space cutaway subtract | `cutTube`/`cutCylinder`/`cutSphere` (`manifoldCut.ts`) | N elements |
| Long-string extrude | `boreNDivisions` → `Manifold.extrude` | string length / 5 |
| Per-vertex warp | `warpGeometry` loop | total vertex count |
| Full rebuild on any dial | `{#key geomKey}` in `WellSchematic3D.svelte` | every interaction |
| Main-thread singleton contention | all builders share `globalThis.__cadtrain_manifold__` | serialized, no parallelism |

Everything is serialized through the ONE shared Manifold singleton
(`initManifold()` in `manifoldCut.ts` delegates to
`$lib/graph/manifold-helpers`), so there is zero parallelism even across cores.

---

## 2 · A2 · Element library — every string/component is a parametric part

**Goal:** OH · casing · cement · tubing · completion · perforation become
first-class **parametric elements** with an explicit `ParamSpec`, resolved
through a registry, and the engine builds a well by *calling* them with row
params — not by branching inline in `WellSchematic3D`.

### 2a. Two kinds of element (keep both — they serve different needs)

| Element | Geometry | Home | Bake path |
|---|---|---|---|
| OH (open hole) | translucent cylinder (bore) | **procedural shell** | wells worker pool (§3) |
| Casing | steel annular tube | **procedural shell** | wells worker pool |
| Cement | beige speckled annulus | **procedural shell** | wells worker pool |
| Tubing | gold annular tube | **procedural shell** | wells worker pool |
| Perforation | sphere marker | **procedural shell** | wells worker pool |
| Completion (packer/nipple/mandrel/…) | detailed jewelry | **`g_*` volume part** | compile→worker (§3c) |

- A **procedural shell** is a tube/cylinder/sphere fully described by numbers
  (`top,bot,innerR,outerR,color,style`). It does not deserve a hand-authored
  volume part; it *is* its ParamSpec. The builders already exist verbatim in
  `manifoldCut.ts` — we relocate them into a worker, not rewrite them.
- A **library part** is the detailed downhole tool. These are the existing `g_*`
  parts (`g_packer_baker_permanent`, `g_nipple_r_landing`, `g_gas_lift_mandrel`,
  …) already mapped in `src/lib/wells/registry.ts` (`resolveComponent`). They
  bake through the SAME `/api/primitives/compile` + worker pipeline the editor
  uses, so a completion in a well and the same part in `/primitives` share one
  compiled script + cache entry.

### 2b. The element descriptor + ParamSpec

Introduce one pure module `src/lib/wells/elements.ts` — a function
`wellElements(wson, remap, diaScale) → WellElement[]` that lifts the inline
decisions currently scattered across `ohGeoms`/`chGeoms`/`cementGeoms`/… into
one typed list:

```ts
export type WellElementKind = 'oh'|'casing'|'cement'|'tubing'|'perf'|'completion';

export interface WellElement {
  id: string;                 // STABLE across rebuilds → scene keys off it (§3d)
  kind: WellElementKind;
  top: number; bot: number;   // display depth (already through remap())
  spec: ShellSpec | PartSpec; // shell numbers OR a resolved g_* part+params
  color: number[];            // 0..1 rgb
  style?: { cutColor?: number[]; cutVariance?: number };
}

export interface ShellSpec { form: 'tube'|'cylinder'|'sphere'; innerR: number; outerR: number; }
export interface PartSpec  { partId: string; params: Record<string, number|string>; }
```

Each `WellElementKind` advertises a `ParamSpec[]` (reusing the existing
`ParamSpec` interface from `threeD/parametric/ParametricComponent.ts` — `{key,
label, min, max, step, default, description}`). Example for casing:

```ts
export const CASING_SPEC: ParamSpec[] = [
  { key:'od',    label:'OD',    min:2.375, max:36, step:0.125, default:9.625, description:'Casing OD (in.)' },
  { key:'id',    label:'ID',    min:1.9,   max:34, step:0.125, default:8.681, description:'Casing ID (in.)' },
  { key:'top',   label:'Top',   min:0,     max:40000, step:1,  default:0,     description:'MD top (m)' },
  { key:'bot',   label:'Bottom',min:0,     max:40000, step:1,  default:1000,  description:'MD bottom (m)' },
  { key:'grade', label:'Grade', min:0, max:0, step:0, default:0 },            // enum-ish, UI-only
];
```

This `ParamSpec` is exactly what **B4 inspector-on-select** and **B5 popovers**
render — one source of truth for "what can I edit on this element."

### 2c. The registry — fold in `registry.ts` + the parametric registry + `g_*` jewelry

Today there are **two** registries that both key off `tool_comp`:

- `src/lib/wells/registry.ts` → `resolveComponent(c, lengthM)` → `{partId, params,
  category}` (the `g_*` VOLUME-part path — server/worker baked).
- `src/lib/wells/threeD/parametric/index.ts` → `getBuilder(tool_comp)` →
  `ParametricComponent` (the CLIENT builder path — currently only `bakerPacker`).

**Recommendation: `registry.ts` becomes the single dispatcher.** `resolveComponent`
already falls back category → generic. Extend `ResolvedComponent` with a
`buildKind: 'part' | 'client-builder'` so a completion resolves to *either* a
compiled `g_*` script OR a client `ParametricComponent`, and the engine treats
both as a `WellElement` of kind `completion`. `bakerPacker` and friends stay as
the client-builder fallback for parts that don't yet have a `g_*` twin; the
**standing NEXT item — register `g_*` jewelry into the registry** — is just
adding rows to `EXACT`/`CATEGORY` (already stubbed: `g_packer_baker_permanent`,
`g_nipple_*`, `g_gas_lift_mandrel`, …). Shells never touch either registry —
they are produced directly by `wellElements()`.

### 2d. What stays procedural vs library — the rule

> **Library part** iff the geometry is a *named, reusable, detailed tool* a user
> would open in `/primitives` (completions). **Procedural shell** iff it is a
> plain tube/cylinder/sphere defined by 2–4 numbers (the strings + perfs).
> Shells get a ParamSpec for the inspector but no volume file.

---

## 3 · A1 · Multi-threaded build — route element builds through a worker pool

### 3a. Bake unit = **per element** (not per string, not whole-well)

- **Per element** maximises cache reuse (an unchanged casing keeps its mesh when
  you edit a completion), enables **progressive render** (strings pop in as they
  finish), gives natural **per-part cutaway** (each element cut independently,
  off-thread — the `stack_cutaway_perf_root_cause` fix), and parallelizes
  cleanly across workers.
- Not whole-well: one giant job can't stream and re-bakes everything on any edit.
- Not per-string-batched: coarser cache, worse streaming. (A future optimisation
  can *coalesce* tiny adjacent shells into one job if job overhead dominates, but
  start at one-element-one-job.)

### 3b. The pool — `WellBakePool` (new), NOT the editor's single worker

The editor's `bake-client.ts` owns **one** worker with **latest-wins
cancellation** (a param drag supersedes the previous bake). That is *wrong* for
wells: we want *all* elements built concurrently, none superseded. So add a
sibling module `src/lib/wells/well-bake-pool.ts`:

- Spawns `N = clamp(navigator.hardwareConcurrency-1, 1, 4)` workers.
- FIFO/priority queue that **keeps all jobs** (cancel only on well-switch or when
  an element's key changes — the superseded element's job is dropped, siblings
  are not).
- Each worker holds its **own** Manifold WASM instance (`ensureInit` in the
  worker), so N workers = **true parallelism** with **no shared-singleton
  contention** — and a worker crash respawns only that worker, leaving the main
  thread's geometry core untouched (kills the singleton-corruption class of bug).
- Reuses `bake-worker-core.ts`'s `packTransferable` / `mesh-serial` so results
  come back as zero-copy transferable `{positions, normals, colors, index}`.

Two job types flow through the same pool + queue + cache + progressive sink:

```ts
type WellBakeJob =
  | { type:'shell'; id:string; form:'tube'|'cylinder'|'sphere';
      top:number; bot:number; innerR:number; outerR:number;
      cutAxis:string; cutAzimuthDeg:number; color:number[]; style:any;
      survey: SurveySample[] | null; cutaway:boolean }
  | { type:'part'; id:string; script:string; scriptHash:string;
      params:(number|string)[]; options:BakeOptions; survey: SurveySample[] | null };
```

### 3c. The wells worker — `wells-bake-worker.ts` (new)

A thin worker that:

1. `type:'shell'` → imports the **existing** `manifoldCut.ts` builders
   (`cutTube`/`cutCylinder`/`cutSphere`) + `warpGeometry` **verbatim** and runs
   them in the worker. The builders are pure (Manifold + THREE math, no DOM), so
   they lift into a worker unchanged. The **cutaway (`subtract(cutterBox)`) and
   the warp now run off-main-thread and in parallel.**
2. `type:'part'` → runs the compiled `g_*` script exactly like `bake-worker.ts`
   (`runCompiledManifold`), then optionally warps the returned geometry along the
   survey.

**Warp in the worker.** `warpGeometry` needs the centerline; today it calls
`wellDir.getInterNode(md)` (a class with `@math.gl` quaternions — not trivially
cloneable). Fix: the **main thread pre-samples** the centerline once
(`sampleCentreline` / a stride of `getInterNode`) into a plain array
`SurveySample[] = {md, pt:[x,y,z]}[]` and passes it in the job message. Port the
warp's frame-building (finite-difference tangents + Rodrigues parallel transport
— already pure, lines 155–248 of `manifoldCut.ts`) to consume that array instead
of the `WellDirection` object. Result: warp is parallel + off-thread, and the
survey math (min-curvature, `WellDirection`) stays on the main thread where it's
cheap and shared.

The worker returns serialized geometry; `manifoldToColoredGeo`'s vertex-colour
cut face is preserved (it's just a Float32 `color` attribute in the transfer).

### 3d. Composing results into the Threlte scene (progressive, no remount)

Replace the `{#key geomKey}` full-remount with a **stable keyed `$state` map**,
mirroring today's `parametricGeoms` pattern but for *all* elements:

```ts
const built = $state<Record<string, { geometry: THREE.BufferGeometry }>>({});
// scene:
{#each elements as el (el.id)}                 // el.id STABLE across rebuilds
  {#if built[el.id]}
    <T.Mesh geometry={built[el.id].geometry} …><Edges/></T.Mesh>
  {/if}
{/each}
```

- Meshes stay mounted; only the `geometry` swaps when a fresh bake lands → no
  teardown storm, `<Edges>` rebuilds once per element (not per frame).
- Elements appear **as their worker jobs finish** (progressive render) — the well
  paints top-down instead of blocking on the slowest string.
- Keyed by `el.id` (stable) — NOT a fresh array per render (memory
  `fresh_array_props_effect_loops` / `graph_editor_drag_bake_perf`: pass stable
  references, never reassign the collection each frame).
- A dial that only affects a *view* transform (e.g. camera) touches nothing that
  re-bakes; a dial that changes geometry (Dia×, cut azimuth, cutaway) changes
  only the affected elements' keys → only those re-bake (see cache key below).

### 3e. Cache keying

- **Shells:** `key = KERNEL_VERSION | 'shell' | form | top | bot | innerR |
  outerR | cutAxis | cutAzimuth | color | cutaway | surveyFingerprint`. The
  `surveyFingerprint` is a hash of the sampled centerline (so a survey edit busts
  warped meshes but a completion edit does not).
- **Parts:** reuse the editor's key — `bakeCacheKey(scriptHash, params, options)`
  from `bake-worker-core.ts` — so a completion shares its cache entry with the
  same part in `/primitives`.
- Both persist to the **existing IndexedDB store** (`cadtrain-bake-cache`,
  `bake-client.ts`) → survives reload; `KERNEL_VERSION` busts across a WASM
  upgrade. In-memory LRU on top (like `parametric/index.ts`'s 64-entry `_cache`)
  for the hot path.

### 3f. Where the cutaway happens

**Per element, inside the worker.** Shells: `subtract(cutterBox)` (vertical) or
the half-annulus 2D-extrude strategy (deviated) — both already in
`manifoldCut.ts`, both move to the worker. Parts: `finalizeManifold`'s
half-section (already runs in `runCompiledManifold` inside the worker). This is
the memory-prescribed **per-part cutaway** made concurrent — no whole-well
boolean, ever.

### 3g. Shared-singleton + worker constraints (explicit)

- Each worker inits its OWN Manifold WASM (the `?url` `locateFile` trick from
  `bake-worker.ts` — proven under both dev and prod build). N instances cost ~tens
  of MB each → **cap the pool at 4**.
- The main thread stops building shell geometry, so `manifoldCut.initManifold()`
  on the main thread is only needed for any residual main-thread build during
  migration; end state, the main thread holds no Manifold build load.
- Params/options must be structured-clone-safe — JSON round-trip them before
  postMessage (bake-client already does this; `SurveySample[]` is plain arrays).

---

## 4 · A3 · Auto-scale (fit-to-view + default exaggeration)

A real well is a sliver: TVD ~3000 m vs OD ~0.24 m ⇒ ~12000:1. Two levers, both
already present as *manual* dials (`view-settings.ts`: `diaScale` default 6,
`zScale` default 1) — make them **auto with override**.

### 4a. Default radial exaggeration

Compute from the WSON on load / data change:

```
maxOD_in   = max over oh.bitSize, ch.od, cement, tubing        // inches
tvd_disp   = remap(rawTd)                                      // display depth units
diaScale_auto = clamp( TARGET_ASPECT * tvd_disp / (maxOD_in), DIA_MIN, DIA_MAX )
```

with `TARGET_ASPECT ≈ 1/30` (well reads ~30:1 tall — legible, still
recognisable), `DIA_MIN≈3`, `DIA_MAX≈40`. `diaScale` remains a *view dial*
(radial exaggeration is NOT baked — depths true in metres, diameters true in
inches × diaScale, per `WellSchematic3D`'s scale-pipeline contract), so changing
it re-bakes shells (radius changes geometry) but is cheap and cached.

### 4b. Depth: DTX + optional stretch

DTX (`dtx.ts` `autoNodes`/`lerpDTX`) already expands cluttered zones and
compresses empty runs — keep it as the default depth transform. `zScale`
(Depth×) stays a post-DTX multiplier, defaulting to 1 (auto), user-overridable.

### 4c. Fit-to-view

The camera framing already derives from the centerline bbox
(`cameraTarget`/`cameraDistance` in `WellSchematic3D`). Promote this to an
explicit **fit-on-load / fit-on-data-change**: after the centerline is sampled,
compute the bbox of *all element extents* (radius-inclusive), set OrbitControls
target + camera distance to frame it with a margin, and expose a **Fit-view**
toolbar action (gap doc D2/D4). Auto-fit fires on load + on WSON change; manual
orbit/zoom thereafter is untouched until the next data change or explicit Fit.

### 4d. Override semantics

Dials show the *auto* value as their baseline; the user's explicit Dia×/Depth×
multiplies it (never silently discards user intent — memory
`feedback_expose_dont_hide`: the slider IS the product). A "reset to auto" affordance
returns to the computed baseline.

---

## 5 · Phased plan (small, shippable) + risks + what stays main-thread

Each phase is independently shippable and e2e-verifiable (headless build/test for
geometry; browser only for the visual progressive-render check — Rule 26).

| Phase | Scope | Gap §A | Ships |
|---|---|---|---|
| **P0 · Measure** | Add opt-in timings around the `$derived.by` builders (reuse `cad-bake-timings` flag). Confirm the §1e hot spots on a long multi-string sample. | — | a baseline number to beat |
| **P1 · A2 element model** | Extract `src/lib/wells/elements.ts` = pure `wellElements(wson, remap, diaScale) → WellElement[]` + per-kind `ParamSpec`. `WellSchematic3D` consumes the list instead of inline `ohGeoms/chGeoms/…`. No perf change; shells still main-thread. Unit-test element extraction (pure). | A2 | testable element list; unblocks B4/B5 |
| **P2 · A1 shells off-thread** | `well-bake-pool.ts` + `wells-bake-worker.ts` (imports `manifoldCut` builders + ported warp). Route `kind:'shell'` elements through the pool. Replace `{#key geomKey}` with the stable-keyed `$state` map + progressive render. IndexedDB + LRU cache. | A1 (bake unit, parallelize, progressive, per-part cutaway) | the janky→smooth win |
| **P3 · A1 completions unified** | Route `kind:'completion'` through the same pool: `resolveComponent` → `g_*` compile (`/api/primitives/compile`) → `type:'part'` job, or client-builder fallback. Register the `g_*` jewelry rows into `registry.ts` (the standing NEXT item). Fold `buildCached` into the pool. | A2 (register g_*), A1 | one pipeline for all elements |
| **P4 · A3 auto-scale** | `diaScale_auto` + fit-on-load/change + Fit-view action; dials override the auto baseline. | A3 | no more invisible slivers |
| **P5 · Harden** | Survey-fingerprint keying, well-switch cancellation, pool sizing, cache eviction, worker-crash respawn, Edges/normals polish. | A1 | production-ready |

### Risks

- **Warp fidelity in the worker.** The frame math must be byte-identical to the
  main-thread `warpGeometry`; port it as a shared pure function consuming
  `SurveySample[]`, and pin it with the existing `schematic3d.test.ts` (frame
  orthonormal/right-handed, TVD monotonic) run against the worker path.
- **N WASM instances = memory.** Cap the pool at 4; each worker ~tens of MB.
- **Progressive render reactivity.** Must key off stable `el.id` and swap
  `geometry` in place — a fresh array/object per frame re-mounts and can loop
  auto-fit (`fresh_array_props_effect_loops`, `canvas_height_contract`).
- **Cutaway plane across the warp.** The deviated half-annulus-extrude strategy
  bakes the cut into local geometry *before* warp — keep that ordering in the
  worker; do not try to CSG a world half-space against warped geometry.
- **Cache-key completeness.** Omitting a geometry-affecting input (cut azimuth,
  survey) from the shell key = stale mesh (the "deja-vu" class the editor
  already solved with scriptHash). Enumerate every geometry input in the key.
- **Job-overhead vs shell size.** One tiny sphere per perf could be dominated by
  transfer overhead; P5 may coalesce trivial shells if measured to matter.

### What stays on the main thread (by design)

- Survey math: min-curvature `WellProfile`, `WellDirection` sampling → produces
  the `SurveySample[]` polyline handed to workers. Cheap, shared, hard to clone.
- DTX remap (`dtx.ts`) — pure JS, microseconds.
- Camera framing / fit-to-view, OrbitControls, lights, the centerline `Line`,
  the depth ruler + labels, layer toggles, and all Threlte scene-graph assembly.
- Geometry deserialize (transferable → `THREE.BufferGeometry`) + `<Edges>` — one
  small pass per finished element, unavoidable on the main thread.

---

## Appendix · Files this design touches

- **New:** `src/lib/wells/elements.ts` (element model + ParamSpecs),
  `src/lib/wells/well-bake-pool.ts` (worker pool), `src/lib/wells/threeD/
  wells-bake-worker.ts` (worker entry), a shared pure `warpSamples.ts` (warp
  consuming `SurveySample[]`).
- **Refactor:** `src/lib/wells/WellSchematic3D.svelte` (consume `elements` +
  pool + progressive `$state` map; drop `{#key geomKey}` remount),
  `src/lib/wells/registry.ts` (single dispatcher, `buildKind`, register `g_*`).
- **Reuse unchanged:** `manifoldCut.ts` builders (relocated into the worker),
  `bake-worker-core.ts` (`packTransferable`/`bakeCacheKey`/`mesh-serial`),
  `/api/primitives/compile`, `dtx.ts`, `threeD/direction.ts`, `view-settings.ts`.
</content>
