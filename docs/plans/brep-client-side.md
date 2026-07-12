# Plan — BREP (OCCT) client-side execution (#39)

> **Status:** PLAN (expanded 2026-07-07) + safe scaffold. Default OFF, zero
> behaviour change. The working server path (`/api/brep/preview` →
> `src/lib/server/brep-occt.ts`) is untouched.
> **Supersedes** the 2026-07-02 planning stub (folded in below).
> **Goal:** move the OCCT/BREP kernel OFF the server and INTO a browser Web
> Worker, mirroring the Manifold client-exec split that already shipped
> (`docs/plans/client-side-execution.md` PR1–3, memory `client_side_execution`).
> This is that plan's **PR5** ("OCCT in the client worker"), fleshed out.
> **Cross-ref:** the COOP/COEP + static-asset headers that unblock
> SharedArrayBuffer / cross-origin isolation already shipped **2026-07-02** — the
> same prerequisite Manifold-client needed. No new header work. Also aligns with
> the data-residency constraint (memory `ai_data_residency_local_first` — keep
> geometry local).

---

## 0. Go / no-go verdict — **GO** (medium risk, gated, fallback intact)

**Yes — the SAME OCCT WASM runs in a browser Web Worker.** The binding is
**`replicad` + `replicad-opencascadejs`** (already in `package.json`:
`replicad@^0.23.1`, `replicad-opencascadejs@^0.23.0`). replicad is a
**browser-first** library — [replicad.xyz](https://replicad.xyz) is a pure
client-side app that runs exactly this OCCT build in a Web Worker. So
client-side OCCT is not speculative; it is replicad's *primary* deployment
target. This materially de-risks the port.

**The binding + size (measured on this volume):**

| Fact | Value |
|---|---|
| OCCT WASM binding | `replicad-opencascadejs/src/replicad_single.js` (emscripten MODULARIZE factory) + `replicad_single.wasm` |
| `replicad_single.wasm` size | **10 MB** (measured; `_with_exceptions` variant also 10 MB) |
| `manifold.wasm` (for contrast) | ~1 MB — why Manifold went client-first |
| Cold init | multiple seconds (emscripten instantiate + OCCT static data) |
| Package shape | `replicad-opencascadejs` has `main: src/replicad_single.js`, **no `browser`/`exports` map** → we import the emscripten factory directly and control the WASM locate ourselves (same as the server does) |
| `replicad` | `module: ./dist/replicad.js` (ESM) — bundles cleanly for the browser |

**The only real go/no-go blockers (all mitigable):**

1. **10 MB WASM lazy-load.** Must never enter the initial bundle — dynamic-import
   the factory only when a BREP part is opened, warm-singleton it in the worker.
   **A constraint, not a blocker.**
2. **Emscripten `__dirname`/`__filename` free-vars.** The server shims these on
   `globalThis` (`brep-occt.ts` `ensureOC`) because Vite's SSR ESM context lacks
   them. **In a browser Worker they are also absent** — the worker must provide
   the same shims (harmless empty strings) OR confirm the emscripten build only
   reads them under `locateFile` (replicad.xyz proves the browser path works; the
   shim is cheap insurance). **Verify in the P0 spike.**
3. **WASM locate under a Vite worker chunk.** Manifold solved the identical
   problem with `import wasmUrl from 'manifold-3d/manifold.wasm?url'` +
   `locateFile: p => p.endsWith('.wasm') ? wasmUrl : p` (`bake-worker.ts`). The
   OCCT worker does the same with `replicad-opencascadejs/src/replicad_single.wasm?url`.
   **The ONE gotcha to confirm on a real build+browser; proven pattern, low
   uncertainty.**
4. **Cross-origin isolation.** COOP `same-origin` + COEP `require-corp` already
   shipped 2026-07-02 for Manifold-client, so **the environment is already
   isolated**. Just confirm the served `.wasm` carries the CORP header (static
   assets already do since 2026-07-02).

**Why "medium" not "low":** OCCT booleans are ~40–100× slower than Manifold
(exact kernel), the WASM is 10× larger, and cold-init is seconds — so weak/mobile
clients need the server-builder fallback kept reachable. But the *feasibility* is
settled: replicad runs OCCT in a browser worker in production elsewhere.

---

## 1. Current server BREP path — what we're mirroring

```
BREP tab (RightPane) → PrimitiveDualCanvas backend="brep" (rebuildBrep, ~L456)
   → POST /api/brep/preview { source, paramValues, tolerance, cut }
   → src/lib/server/brep-occt.ts
        ensureOC()            — lazy factory + wasmBinary (Node readFileSync)
        brepFromSource(...)   — graph→OCCT executor (the portable logic)
        meshBrepSolid(...)    — .mesh(tol,ang) → BrepMesh (+ .cut() half-section)
   → { supported, positions, index?, normals?, colors?, cut, meta }
   → brep-adapter.ts brepResponseToGeo → { full } | { cutVC }
   → PrimitiveDualScene renders (SAME scene chrome as Manifold)
```

**Key file map (read before touching):**

| Piece | Path |
|---|---|
| OCCT executor + tessellate + cutaway | `src/lib/server/brep-occt.ts` (this task's prompt mislabels it `src/lib/graph/…`) |
| Server endpoint (never-500 isolation contract) | `src/routes/api/brep/preview/+server.ts` |
| Response → THREE geo adapter | `src/lib/shared/brep-adapter.ts` (**already client-side, kernel-neutral — reuse verbatim**) |
| Canvas BREP dispatch | `src/lib/shared/PrimitiveDualCanvas.svelte` `rebuildBrep()` (~L456) |
| BREP tab UI | `src/lib/shared/graph-editor/RightPane.svelte` (`rightTab==='brep'`) |
| Manifold client precedent | `src/lib/graph/bake-worker.ts` + `bake-worker-core.ts` + `bake-client.ts` |
| Client-exec flag precedent | `scene.clientBake` in `src/lib/shared/scene-state.svelte.ts` |

**The split point inside `brep-occt.ts`:** the file already separates cleanly.

- **PORTABLE (runs anywhere OCCT is loaded)** — `brepFromSource`,
  `meshBrepSolid`, `extractRevolveProfile`, `revolveBrep`, and the whole engine
  bank (`r_revolve`/`r_extrude`/`r_weld_extrude`/`r_loft`/`r_cuboid`/`r_sweep`,
  the `wrap()` Manifold-method→replicad-method proxy, `stackOcct`/`compoundOf`,
  the `.cut()` half-section red/grey classifier). **All pure replicad + JS math —
  no Node built-ins except the two below.**
- **NODE-ONLY (must be replaced client-side)** — exactly two things:
  1. `ensureOC()`'s WASM bootstrap: `readFileSync` of the `.wasm` +
     `createRequire`/`__dirname` shims + `import(replicad_single.js)`. Client
     replaces this with the `?url` + `locateFile` pattern.
  2. `getDepSource()`/`collectDeps` dependency fetching (`readFile`, `findPrim`,
     the `/api/primitives/source` fetch). Client **doesn't need it** — the
     compiler inlines deps (§2), so the client executor never resolves dep source.
     A net *simplification*.

So the port is: **keep the executor, swap the bootstrap, drop the dep-fetch.**

---

## 2. Target architecture — compiler / executor (mirror the Manifold split)

```
┌───────────── SERVER (the compiler) ─────────────┐
│  graph JSON + transitive meta.uses               │
│    → composition-emit + INLINE resolved deps     │
│    → ONE self-contained dep-inlined part source  │
│    → { script, scriptHash, kernel:'occt', ... }  │
│  /api/primitives/compile already exists; add the │
│  kernel:'occt' tag (the inlined source is kernel- │
│  neutral — the SAME emit both kernels consume).  │
│                                                  │
│  server-builder (RETAINED): brep-occt.ts stays   │
│  callable for batch / low-power / parity oracle. │
└───────────────────────┬──────────────────────────┘
                        │ GET/POST dep-inlined source (+ kernel tag)
                        ▼
┌───────────── CLIENT (the executor) ─────────────┐
│  brep-worker.ts — warm OCCT singleton (lazy,     │
│    replicad_single, 10 MB, ?url locate)          │
│    → run source through the SAME engine bank as  │
│      brep-occt.ts (ported executor)              │
│    → meshBrepSolid → transferable BrepMesh       │
│  brep-client.ts — main-thread API (one worker,   │
│    latest-wins cancel, IndexedDB cache)          │
│  brep-adapter.ts brepResponseToGeo (UNCHANGED)   │
│    → { full } | { cutVC } → PrimitiveDualScene   │
└──────────────────────────────────────────────────┘
```

**Two viable executor-transport designs — pick (B):**

- **(A) Compiler emits an OCCT-flavoured script string**, worker `new Function()`s
  it with the engine bank bound (how the Manifold worker runs its script). Maximal
  symmetry with the Manifold path; the compiler must grow an OCCT emit. More work.
- **(B) Worker imports the ported executor + receives `{ source, paramValues }`**
  (the *emitted, dep-inlined part source*), runs
  `brepFromSourceClient(source, params, opts)`. **This reuses `brepFromSource`
  almost verbatim** — the executor already takes `(source, paramValues, opts,
  fetchFn?)` and parses the body itself. Drop `fetchFn` (deps inlined) and swap
  the bootstrap. **Least new code, highest parity, lowest risk → recommended.**

Under (B) the "script" is just the dep-inlined emitted source; `scriptHash`
still keys the IndexedDB cache and still makes the deja-vu stale-dep bug
impossible (the inlined deps are in the hash). Note: today `rebuildBrep` posts the
*non-inlined* `brepSource` and lets the server resolve deps via `fetchFn`; the
client path needs the compiler's inlined output instead (reuse `/api/primitives/
compile`, which already inlines).

**The ⚡client/☁server toggle (also wanted by #48/#49):** add a
`scene.clientBrep` flag (mirror `scene.clientBake`, `localStorage
'cad-client-brep'`, **default OFF** during rollout — the inverse of `clientBake`,
which is default ON). `rebuildBrep()` branches: flag ON + worker available →
`brepClient.run(...)`; else the current `fetch('/api/brep/preview')`. The badge
gets a `⚡client OCCT` / `☁server OCCT` variant next to the existing
`fresh · N ms OCCT`.

**Cutaway on the client:** `meshBrepSolid`'s `.cut()` + face-group red/grey
classifier is pure replicad + JS — it ports as-is. `scene.showCutaway` drives a
worker re-run instead of a server fetch. Keep the endpoint's graceful "retry
uncut on cut-throw" degradation (swept-boolean solids' tilted coincident caps
throw un-tessellably — known `r_sweep` defect-2).

**Scene shape is preserved** → `PrimitiveDualScene`, `SceneControls`,
`brep-adapter` need **zero** edits (same win as the Manifold path). Per the
prompt's guardrails, `PrimitiveDualScene.svelte` is not touched by this plan.

---

## 3. Phased plan (each phase shippable; gate + risk per phase)

### P0 — Feasibility spike (browser, throwaway) — **GATE: one revolve renders client-side**
Stand up a minimal `brep-worker.ts`: lazy dynamic-import the replicad factory,
`import wasmUrl from 'replicad-opencascadejs/src/replicad_single.wasm?url'`,
`setOC(await factory({ locateFile: p => p.endsWith('.wasm') ? wasmUrl : p }))`,
run `revolveBrep([[0,0],[2,0],[2,4],[0,4]])`, postMessage the mesh. Wire a
throwaway button on `/primitives` (never a new route — memory
`feedback_demos_under_primitives`) behind the OFF flag.
- **Verify:** worker loads the 10 MB WASM, produces a mesh, no `__dirname` crash,
  `.wasm` served with the CORP header. **Requires a real browser** (Rule 26 —
  genuinely visual/WASM → dev-server + browser, or verify inline on live `:3333`).
  **Cannot be judged headless.**
- **Risk:** the `?url` import of a 10 MB asset + the emscripten free-vars. If the
  `__dirname` shim is needed, add it in the worker before the factory call.
- **Kill criterion:** if the emscripten glue can't be coaxed to load in a Vite
  worker chunk after the shim + `?url` locate, fall back to hosting the WASM as a
  `/static/` asset and `fetch()` → `wasmBinary` in the worker (the server's exact
  approach, minus `readFileSync`). One of these two WILL work — replicad.xyz is
  the existence proof.

### P1 — Client executor behind the flag (server fallback intact) — **GATE: build green + BREP parts render client-side, flag ON**
- Create `src/lib/graph/brep-executor.ts` exporting
  `brepFromSourceClient(source, params, opts, occ)` — **copied** from
  `brep-occt.ts`'s `brepFromSource` with the two Node-only pieces removed
  (bootstrap → injected `occ`; `getDepSource`/`collectDeps` → deleted, deps are
  inlined). Keep `brep-occt.ts` **unchanged** so the server path stays byte-stable
  (do NOT refactor the server to share it yet — a later cleanup can DRY them once
  the client path is proven; premature sharing risks the working server bake).
- `brep-worker.ts` (worker) imports `brep-executor.ts` + the `?url` WASM + holds
  the warm OCCT singleton.
- `brep-client.ts` (main thread): one worker, latest-wins cancellation,
  IndexedDB cache keyed on `scriptHash + params + cut` (KERNEL_VERSION in the key
  so a replicad bump busts it). **Structural copy of `bake-client.ts`** — the
  scaffold on this branch is its stub (§7).
- `scene.clientBrep` flag (default OFF) + `rebuildBrep()` branch + badge variant.
- **Gate:** `bun run build` clean; the flag-OFF path is byte-identical to today.
- **Risk:** mesh divergence client vs server — but BREP output is a plain
  `{positions,index,normals,colors}` (not welded like Manifold), so divergence
  risk is lower than the Manifold vert-weld reconciliation. Parity-check the g_*
  revolve/CSG corpus against the retained server oracle.

### P2 — Cutaway on the client — **GATE: half-section red/grey matches server**
The `.cut()` + classifier is already in `brep-executor.ts` if P1 copies the whole
`meshBrepSolid`. `showCutaway` → worker re-run. Keep the "retry uncut on
cut-throw" degradation.
- **Risk:** swept-boolean cut throws (known `r_sweep` defect-2) — same graceful
  fallback as the server; accept the uncut solid. Revolve/extrude/loft cut fine.

### P3 — Display-mesh tessellation / T-junction handling — **GATE: no visible cracks; correct counts; timings acceptable**
OCCT's `.mesh(tol, ang)` per-face tessellation produces **T-junctions** between
adjacent faces (documented BREP-display artifact, `todo_brep_cutaway`; also the
source of the bogus ~1.8e9 count on the sweep BREP — see §8). Fold in the
non-manifold-cleanup weld (position-weld the OCCT display mesh so it reads
watertight + the count is correct) — applies to BOTH server + client. Expose the
`tolerance`/`angularTolerance` dials (already plumbed as `effTol`); consider a
coarse→fine progressive bake so the first frame is fast.

### (No default-flip phase.) Unlike Manifold, BREP-client likely stays **opt-in
indefinitely** — it's the comparison/exact-kernel surface, not the hot path. The
server-builder BREP path is retained permanently for batch/STEP-export/low-power
(mirrors `client-side-execution.md` §6).

---

## 4. Files (by phase)

- **P0:** throwaway `brep-worker.ts` spike + a hidden `/primitives` button.
- **P1:** `src/lib/graph/brep-executor.ts` (portable, copied from `brep-occt.ts`);
  `src/lib/graph/brep-worker.ts`; `src/lib/graph/brep-client.ts` (this branch ships
  the stub); `src/lib/shared/scene-state.svelte.ts` (`clientBrep` flag);
  `src/lib/shared/PrimitiveDualCanvas.svelte` (`rebuildBrep` branch + badge);
  optionally `/api/primitives/compile` `kernel:'occt'` tag.
- **P2:** `brep-executor.ts` (cut path already included); canvas re-run on
  `showCutaway`.
- **P3:** display-mesh weld (server + client); tolerance dials; progressive bake.
- **Not touched (prompt guardrails + scene-shape reuse):**
  `PrimitiveDualScene.svelte`, `tf-weld.ts`, `graph-to-tf.ts`, `NodeCard.svelte`,
  `composition-graph-mutate.ts`, `brep-adapter.ts`, `SceneControls.svelte`,
  `brep-occt.ts` server path (kept byte-stable).

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 10 MB WASM in the initial bundle | Dynamic-import the factory only when a BREP part opens; warm singleton; `?url` asset stays a separate chunk. |
| Emscripten `__dirname`/`__filename` free-vars in a worker | Shim on `globalThis` before the factory (server already does this); verify in P0. |
| `?url` locate fails in the worker chunk | Fallback: host `.wasm` under `/static`, `fetch()` → `wasmBinary` (the server's exact approach). replicad.xyz proves one path works. |
| OCCT booleans slow on weak clients (~40–100× vs Manifold) | Keep BREP opt-in (default OFF); retain server-builder fallback + rate-limit it; it's a desktop comparison surface. |
| Cold init seconds blocks UI | Worker is mandatory; show a one-time "loading CAD kernel" affordance; Manifold path stays unblocked. |
| Mesh divergence client vs server | Parity-check g_* corpus against the retained server oracle; BREP output isn't welded so lower risk than Manifold. |
| OCCT heap grows over long sessions | Reuse the singleton; consider periodic teardown for OCCT only (`_ocReady = null` equivalent). |
| Cutaway throws on swept-boolean solids | Retain the endpoint's "retry uncut" fallback in the worker (known `r_sweep` defect-2). |
| Emitted OCCT source leaks part/engine source in DevTools | Same acceptance as `client-side-execution.md` §7 — `serverOnly` deps forced down the server path; the vocabulary is the moat. |

---

## 6. Open questions
1. Design (A) OCCT-script-emit vs (B) worker-imports-executor — **(B) recommended**
   (least code, highest parity). Confirm in P1.
2. Cold-init budget before we *ever* auto-select BREP-client (likely never — stays
   opt-in).
3. Does DRY-ing `brep-occt.ts` ↔ `brep-executor.ts` (share the engine bank) pay
   off, or does the duplication protect the working server path? Defer to a
   cleanup after P1 proves the client path.
4. `_with_exceptions` build (surfaces OCCT errors, also 10 MB) — worth it for
   client-side error messages, or ship `single` (no-exceptions) first? Start
   `single`.

---

## 7. What was scaffolded on this branch (safe, default-OFF)

Per the task's "safe scaffold only if low-risk + non-breaking" clause, and Rule
26 (a real P0 spike needs a browser + can't be judged headless), this branch
lands **only the zero-risk, headless-verifiable pieces** and STOPS before the
worker that imports the 10 MB emscripten binding (that build+browser step is P0):

- `src/lib/graph/brep-client.ts` — the main-thread client API **stub + protocol
  types**, structurally following `bake-client.ts`. It does **not** import
  replicad and does **not** instantiate a worker (so Vite never bundles the
  emscripten glue → zero build risk). `brepClientEnabled()` reads the
  `cad-client-brep` flag (default OFF); `runBrepClient()` currently throws
  `BREP_CLIENT_NOT_READY` until P1 wires the real worker. **Nothing imports it on
  the hot path → zero behaviour change.**
- `src/lib/graph/brep-client.test.ts` — asserts the flag defaults OFF and the stub
  contract, so the scaffold is unit-verified headless (`bun run test`).

This mirrors the exact precedent: `bake-client.ts` shipped in PR2 "NOT wired
into any canvas — that's PR3." The next session picks up at **P0** (browser
spike) → **P1** (swap the stub for the real worker + `brep-executor.ts`).

---

## 8. Related BREP TODOs (carried from the 2026-07-02 stub)

Independent of the client move, but they touch the same code and P3 folds them in:

- **Color parts in BREP** (user): the BREP tab renders monochrome; respect the
  per-part `colorOuter`/`colorInner` + the #86 subpart colors (the PROPERTIES
  color table exists but BREP ignores it). Route OCCT faceGroups → vertex colors
  like the Manifold path.
- **Smooth BREP** (user): apply crease-aware smooth normals to the OCCT
  tessellation like the Manifold `creaseAwareCornerNormals` fix, so BREP surfaces
  read smooth (they carry exact-surface normals — surface them; cut faces stay
  faceted).
- **Bogus count bug**: the BREP badge shows a garbage ~1.8e9 tri/vert count on
  the sweep BREP (T-junction display mesh / an unsigned-overflow misread) — fix in
  the count path, tied to the P3 display-mesh weld.
- **Server BREP r_sweep** shipped (`brep-occt.ts`; memory
  `r_sweep_normals_and_twist`); the annular-section durable fix is the
  engine-agnostic cleanup (`docs/plans/annular-csg2d-section-sweep.md`).
