# `/wells` 3D renders EMPTY — root cause + fix

**Symptom (confirmed on prod):** `/wells` → 3D → the well is blank/near-empty,
timing badge reads `7 strings · 0 CSG · 0 tris`. Nothing visible.

**Verdict:** The hypothesis in the brief is **CONFIRMED**. cadtrain deliberately
renders `null` for every string while Manifold is initialising (`cutPending`),
which turns a *slow or failed* WASM init into a **fully blank scene**. SVTC does
the opposite — it renders the plain (un-cut) shells until Manifold is ready, so
it is **never blank**. cadtrain inverted SVTC's fallback.

Two things combine to produce the blank:
1. **The `cutPending → null` design** (`WellSchematic3D.svelte`) — a blank scene
   whenever `manifoldReady` is false, by construction.
2. **`manifoldReady` never flips true on prod** — the shared-singleton Manifold
   init almost certainly throws under the app-wide `COEP: require-corp` header,
   because the main-thread `manifold.wasm` fetch is a cross-origin-embedder
   subresource that must carry a CORP header.

This is **not** a Svelte reactivity bug (analysis below rules it out).

---

## 1. Root cause

### 1a. The badge numbers prove we are in the `cutPending` (pre-ready) state

`WellSchematic3D.svelte`:

- `manifoldReady = $state(false)` set to `true` only after `initManifold()`
  resolves; on throw it is **left false** and the error is swallowed to
  `console.error` (`WellSchematic3D.svelte:88-92`).
- `cutActive = $derived(cutaway && manifoldReady)` (`:109`)
- `cutPending = $derived(cutaway && !manifoldReady)` (`:116`)

`cutaway` **defaults to `true`** (prop default `:50`; the route passes
`view.cutaway`, whose default is `true` — `routes/wells/view-settings.ts:61`).
So until Manifold is ready, `cutActive=false` **and** `cutPending=true`.

Every layer's geometry is chosen by this ternary (`buildBundle`, `:225-305`):

```js
const geom = cutActive
  ? safe(() => cutTube(...))     // needs Manifold
  : cutPending ? null            // ← BLANK while (or if) Manifold isn't ready
  : shellForRange(...);          // plain THREE, no Manifold — but UNREACHABLE when cutaway=true
```

Because `cutaway=true`, the `: shellForRange(...)` fallback is **unreachable** —
the branch is always `cutActive ? cut : null`. So with Manifold not ready, `oh`,
`ch`, `cement`, `tubing`, and completion geoms are all `null`, and the arrays
`.filter(g => g.geom)` down to empty → **0 triangles**.

The badge still reads **7 strings** because `strings` is counted from the WSON
directly, not from built geometry: `compCount` is
`(wson.completions ?? []).filter(...).length` (`:294-295`) and `strings =
oh.length + ch.length + cement.length + (tubing?1:0) + perfs.length + compCount`
(`:296`). With all geom arrays empty, `strings` collapses to `compCount` — i.e.
the WSON has 7 completions. `0 CSG` (no `cutTube`/`cutCylinder` ran) and `0 tris`
(nothing built) confirm we never left the pre-ready state. The completion
markers are also gated: `displayCompMarkers` returns `geom: null` when
`!cutActive` (`WellSchematic3D.svelte:393`), and the parametric build effect
early-returns `if (!manifoldReady) return` (`:369-370`), so even the fallback
cylinders never appear.

### 1b. Why `manifoldReady` never flips: the Manifold init throws under COEP

`threeD/manifoldCut.ts:86-93` delegates init to cadtrain's shared singleton:

```ts
export async function initManifold(): Promise<any> {
  if (_wasm) return _wasm;
  await cadInitManifold();                       // $lib/cad/manifold-helpers
  _wasm = (globalThis as any).__cadtrain_manifold__?.wasm ?? null;
  if (!_wasm) throw new Error('...singleton unavailable...');
  return _wasm;
}
```

`cadInitManifold` (`manifold-helpers.ts:192-212`) calls emscripten
`Module(...)` with **default** wasm resolution (`new URL('manifold.wasm',
import.meta.url)`, `:199-204`) on the **main thread**.

The whole app — including the `/wells` document — is served with
`Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy:
same-origin`, applied to **every** response in `hooks.server.ts`
(`applyCrossOriginIsolation`, `:147-152`; wired into `handle` at `:254`; dev
parity via the `crossOriginIsolation()` plugin, `vite.config.js:56-57`). These
headers were added for TrueForm's pthreads/SharedArrayBuffer (`hooks.server.ts`
comment `:135-145`), **not** for Manifold — the manifold-3d default build is
single-threaded and does **not** need cross-origin isolation.

The side effect: **`COEP: require-corp` blocks any cross-origin-embedder
subresource that does not carry a `Cross-Origin-Resource-Policy` (or CORS)
header.** The emscripten main-thread `manifold.wasm` fetch is exactly such a
subresource. The 2026-07-02 client-bake fix added CORP/asset headers so the
**Web Worker** bake path loads `manifold.wasm` — but the client bake runs in a
**worker with its own `locateFile`** (`manifold-helpers.ts:199-204`), while
`/wells` inits Manifold on the **main thread with default resolution**. That
main-thread path is effectively the **only** un-exercised Manifold consumer
under COEP: `/api/primitives/preview` bakes on the **server** (Node, no COEP),
and client-bake is the **worker**. So `/wells` is the first place the
main-thread default-resolution wasm fetch meets `COEP: require-corp` — and it
fails, `cadInitManifold` rejects, the `onMount` catch logs `[WellSchematic3D]
manifold init failed`, `manifoldReady` stays `false`, and the scene stays in the
permanent `cutPending → null` blank.

> To confirm on prod in one step: open `/wells`, switch to 3D, and check the
> console for `[WellSchematic3D] manifold init failed` and the Network tab for a
> blocked/`(failed) net::ERR_BLOCKED_BY_RESPONSE` on `manifold.wasm`
> (NotSameOriginAfterDefaultedToSameOriginByCoep). Presence of that log =
> init-failure branch; absence but still-blank = pure slow-init, which the fix
> below also covers.

### 1c. It is NOT a Svelte reactivity bug

`manifoldReady` is `$state`; `cutActive`/`cutPending` are `$derived` on it;
`buildBundle` is `$derived.by` that reads `cutActive`/`cutPending`
(`WellSchematic3D.svelte:225-233`). In Svelte 5 that chain re-fires correctly
when `manifoldReady` flips. So *if* init succeeded, the geometry would appear —
the persistence of the blank is evidence that init is failing (1b), not that a
successful init fails to propagate.

---

## 2. How SVTC avoids it

SVTC's `Wson3DScene.svelte` uses the **same** `manifoldReady` flag and the
**same** `cutActive = cutaway && manifoldReady` derived (`:24-28`, `:156`) — but
its display geoms **fall back to the plain shells**, never to `null`:

```js
// Wson3DScene.svelte:404-411
const displayOhGeoms = $derived(
  cutActive
    ? (wson.oh).map(oh => ({ geom: safe(() => cutCylinder(...)) }))...   // CSG
    : ohGeoms                                                            // plain shells
);
```

`ohGeoms` / `chGeoms` / `cementGeoms` / `tubingGeom` are built by
`solidTubeForRange` / `shellForRange` (`Wson3DScene.svelte:213-304`) — pure
`THREE.CylinderGeometry` / `ExtrudeGeometry` + `warpGeometry`, **needing no
Manifold at all**. The intent is stated in the component header
(`Wson3DScene.svelte:21-23`):

> "Manifold-3d loads async (WASM). **Until ready, we render raw shells with no
> cutaway so the user sees something immediately**; once ready, the `$derived`
> display geoms switch to CSG-cut vertex-colored versions."

So SVTC **always shows something** — a solid, un-cut well immediately, upgraded
to the half-section once (and only if) Manifold loads. If Manifold never loads,
SVTC still shows the solid well; cadtrain shows a blank canvas.

SVTC also inits Manifold with its **own** `manifold-3d` `Module()`
(`SVTC .../manifoldCut.js:19-31`) and runs **without** app-wide COEP, so it
never hit the require-corp subresource block. (cadtrain intentionally shares one
WASM singleton — `manifold-helpers.ts` / Rule 17 — which is correct; the COEP
interaction is the new variable, not the singleton design.)

Why cadtrain diverged: commit `967a908` ("deviated + cutaway must show its
cross-section, not a solid tube") and the re-applied `df12a15` deliberately
replaced the solid fallback with `null` during `cutPending`, to avoid a heavy
deviated well flashing a throwaway solid that "looks like a broken cutaway"
(rationale inlined at `WellSchematic3D.svelte:110-115`). That reasoning is sound
for a *fast, reliable* init, but it converts a *failed/slow* init into a blank —
the regression we see.

---

## 3. The fix

Two independent edits. **(A) is the guaranteed, must-do fix** (never blank,
regardless of init outcome, and matches SVTC). **(B) makes the cutaway itself
work on prod** by letting the main-thread wasm load under COEP.

### (A) Never render `null` on `cutPending` — fall back to the solid shells

Restore SVTC's behaviour: while Manifold is initialising (or if it fails),
render the plain non-Manifold solids that **already exist** in the file
(`solidTubeForRange` `:184-192`, `shellForRange` `:193-205`, both pure THREE +
`warpGeometry`). This is a mechanical change of each layer's ternary in
`buildBundle` (`WellSchematic3D.svelte:225-305`): drop the `cutPending ? null :`
middle branch so the else always builds the solid.

Exact edits (four layers), e.g. open-hole (`:231-233`):

```js
// before
const geom = cutActive
  ? safe(() => cutCylinder(top, bot, r, cutAxis, COL_OH, {}, wellDir, cutAzimuth))
  : cutPending ? null : solidTubeForRange(top, bot, r);
// after
const geom = cutActive
  ? safe(() => cutCylinder(top, bot, r, cutAxis, COL_OH, {}, wellDir, cutAzimuth))
  : solidTubeForRange(top, bot, r);
```

Apply the identical `cutPending ? null : X` → `X` collapse to:
- casing (`:242-244`) → `shellForRange(top, bot, innerR, outerR)`
- cement (`:255-257`) → `shellForRange(top, bot, innerR, outerR)`
- tubing (`:270-272`) → `shellForRange(top, bot, innerR, outerR)`

`cutPending` (`:116`) then becomes dead and can be deleted along with the
`:110-115` comment. `warpGeometry` is pure JS, so the deviated-well fallback is
also correct (this is exactly what SVTC ships). Once `manifoldReady` flips
(after fix B), `cutActive` becomes true and the shells upgrade to the CSG
half-section as before — same reactive path, no behaviour change on the happy
path. The only visible change is the pre-ready / init-failed state now shows a
solid well instead of nothing.

Optional polish to also show completions pre-ready: in `displayCompMarkers`
(`:388-398`), the `if (!cutActive) return { ...m, geom: null }` (`:393`) can keep
returning `null` (the template already has a plain-cylinder `{:else}` fallback at
`:511-518` that renders from `m.radius`/`m.height` with no Manifold), so
completions already draw as fallback cylinders once (A) is applied — no extra
edit strictly required, but worth verifying visually.

### (B) Let the main-thread `manifold.wasm` load under `COEP: require-corp`

So the cutaway (not just the solid) actually renders on prod. Pick one:

- **Serve `manifold.wasm` (and the manifold JS glue) with
  `Cross-Origin-Resource-Policy: same-origin`** (or `cross-origin`) — the same
  static-asset header treatment that unblocked the client-bake worker on
  2026-07-02 (`server.js` header block, `:8-19`). Confirm the prod static
  handler applies CORP to `*.wasm` for the **default** emscripten fetch URL, not
  only the worker's `locateFile` URL. This is the cleanest fix: it keeps COEP
  on and simply makes the asset COEP-compatible.
- **Or** pass an explicit `locateFile` on the wells init so the main thread
  loads the wasm from the same known-good asset URL the worker uses:
  `cadInitManifold({ locateFile })` (`manifold-helpers.ts:192-204` already
  supports `opts.locateFile`; `threeD/manifoldCut.ts:88` calls
  `cadInitManifold()` with no args — thread the option through).

Do **not** drop COEP app-wide to fix this — TrueForm's pthreads need it
(`hooks.server.ts:135-145`).

### Verification (headless-first)

- **Reproduce/confirm 1b:** on prod, 3D view, console for `[WellSchematic3D]
  manifold init failed` + Network for a COEP-blocked `manifold.wasm`.
- **After (A):** 3D view shows a solid (un-cut) well immediately even before/if
  Manifold loads — never blank. Badge shows `strings > 0`, `tris > 0`, `CSG 0`
  until ready.
- **After (B):** badge flips to `CSG > 0` and the half-section cutaway renders;
  `manifold init failed` no longer logs. The shared-singleton reuse means the
  graph-editor client bake continues to work (same `__cadtrain_manifold__`).

---

## File/line index

**cadtrain**
- `src/lib/wells/WellSchematic3D.svelte:88-92` — `manifoldReady` + `onMount` init + swallowed catch
- `…:109` `cutActive`; `…:116` `cutPending`; `…:110-115` the "don't fall back to solid" rationale
- `…:184-205` `solidTubeForRange` / `shellForRange` (pure THREE + warp, no Manifold — the fallback to use)
- `…:225-305` `buildBundle` — the `cutActive ? cut : cutPending ? null : solid` ternaries (the null branch = the blank)
- `…:294-296` `compCount`/`strings` counted from WSON, not geometry (why badge says "7 strings" with 0 tris)
- `…:369-370` parametric build effect gated on `manifoldReady`; `…:393` comps `null` when `!cutActive`
- `src/lib/wells/threeD/manifoldCut.ts:86-93` — `initManifold` delegates to shared singleton, throws if wasm null
- `src/lib/cad/manifold-helpers.ts:192-212` — shared `initManifold`; default wasm resolution at `:199-204`
- `src/hooks.server.ts:147-152,254` — app-wide `COOP:same-origin` + `COEP:require-corp`; `:135-145` = it's for TrueForm, not Manifold
- `vite.config.js:56-57` — dev COOP/COEP parity
- `server.js:8-19` — prod cross-origin-isolation + static-asset header note
- `src/routes/wells/view-settings.ts:61` — `cutaway` default `true`
- `src/routes/wells/WellViewPlaceholder.svelte:112-128` — lazy 3D mount, passes `cutaway={view.cutaway}`
- git: `967a908` + `df12a15` introduced/re-applied the `cutPending → null` behaviour

**SVTC**
- `src/lib/apps/wson/Wson3DScene.svelte:21-28` — "render raw shells until ready" intent + `manifoldReady`
- `…:156` `cutActive = cutaway && manifoldReady`
- `…:213-304` `solidTubeForRange`/`shellForRange` (plain THREE fallback geoms)
- `…:404-437` `displayOhGeoms`/`displayChGeoms`/`displayCementGeoms` = `cutActive ? cut : <plain shells>` (fallback, never null)
- `src/lib/apps/wson/threeD/manifoldCut.js:19-31` — SVTC's own `Module()` init (single-threaded, no COEP dependency)
