# WASM-compiled primitive sources — feasibility + plan (2026-05-23)

> Status: RESEARCH / FUTURE. Idea: a primitive's geometry source compiled to
> WASM (source.ts → source.c / C++ / Rust / **AssemblyScript**), pre-compiled or
> dynamic, params driven reactively via observables.
> **PRIMARY motivation: code concealment + good interactivity** (perf is
> secondary).

## Lead motivation — concealment (reframes the verdict)
The user's goal is **hiding the geometry IP** (ship opaque bytecode, not readable
`source.ts`) while keeping live param interactivity. So judge this on
concealment, not speed.

- **WASM raises the bar but is NOT secure.** WASM bytecode is decompilable; a
  determined attacker recovers the algorithm. It defeats casual copy-paste
  exfiltration, not reverse engineering.
- **KEY INSIGHT — server-side rendering already conceals.** The app's
  `renderMode: 'server'` path (Rule 17, `component-loader.ts`) sandbox-executes
  `source.ts` **on the server** and ships only the serialized mesh to the
  client — the client never sees the source. **For concealment of
  client-delivered primitives, server-side rendering already achieves most of
  the goal today**, with zero new toolchain. WASM only adds concealment value
  for the case where you want the primitive to run **client-side** (offline /
  no server round-trip) yet still hidden.
- So the real decision: do we need **client-side, concealed, interactive**
  primitives? If server-round-trip rendering is acceptable, the simpler win is
  to keep source server-only (already the case) and never expose `source.ts`
  via the source endpoint for IP-sensitive parts.

## Technical findings (from the deep-dive)

### The boundary is ALREADY WASM
ManifoldCAD is C++→WASM (`node_modules/manifold-3d/manifold.wasm`, embind JS
binding). A primitive's `source.ts` is **thin JS glue** that calls into that
native engine. Build flow: `preview/+server.ts:78` → `buildPrimitiveGeom`
(`primitive-loader.ts:61`: strip imports → esbuild TS→CJS → resolve `meta.uses`
→ `new Function(...SANDBOX_ARG_NAMES, body)`) → sandbox scope from
`primitive-sandbox.ts` (`M` Proxy, `gridPatch/weldAndBuild`, `G`) →
`finalizeManifold` → `mesh-serial` to the client.

### Reactive re-run already exists
`applied` (`$state`) → `appliedArgs` (`$derived`) → `<PrimitiveDualCanvas>` POSTs
`/api/primitives/preview`. "Params via observable re-run the geom" **is the
current architecture** — the only question is whether the re-run function is
JS-glue or WASM.

### Where time goes (NOT the glue)
Per `memory/todo_primitive_open_perf.md`: WASM geom ~10ms even for
`r_thread_full`. The dominant cost is **cutaway CSG ~850ms = `Manifold.subtract`,
already native WASM**. Compiling the 10ms glue saves ~nothing.

### manifold-3d ships NO C/C++ API to link against
The npm package has only `manifold.js` + `manifold.wasm` + `.d.ts` (no headers/
sources). Manifold is reachable **only through its embind JS surface**. So you
cannot compile `primitive.c` linked against libmanifold without vendoring +
building the whole Manifold C++ tree yourself (and two Manifold instances can't
interoperate — embind class identity, the reason for the `__cadtrain_manifold__`
singleton Proxy).

### Toolchain verdict
| Option | CSG access | Verdict |
|---|---|---|
| Emscripten C++ linking libmanifold | only by vendoring+building Manifold | rebuilds the engine you already ship — not worth it |
| Emscripten/AS **glue-only** (emit triangle buffer, JS does CSG via existing engine) | none (JS handles CSG) | the only sane native path |
| **AssemblyScript glue-only** | none | lowest authoring friction (looks like the TS authors write) — recommended IF pursued |
| Rust+wasm-bindgen glue-only | none | heaviest toolchain, wrong fit |

### Pre-compile vs dynamic (Docker = `oven/bun:1`, no compiler toolchain)
- Build-time compile → **breaks the runtime/LLM authoring model** (Rule 17: new
  primitives are volume data authored at runtime, no redeploy). Non-starter as
  default.
- Server-side `emcc`/`asc` per save → heavy; prod has no toolchain (same reason
  `WELLS_BACKEND=cli` is local-only).
- **In-browser `asc` compile** (AssemblyScript's compiler runs as JS/WASM) →
  the only dynamic option that preserves the volume model: compile client-side,
  upload `.wasm` to the volume like `source.ts` today. Recommended if built.

### Security
WASM-exec is **safer** than today's `new Function` in the host realm (a
glue-only module needs ~zero host imports). The risk moves to the compile step
→ client-side `asc` keeps it off the server; still validate uploaded `.wasm`
(`WebAssembly.validate`, size + import allowlist) + cap output vertex/tri counts.

## Honest verdict
- **For perf: not worth it** — the heavy work is already native WASM CSG.
- **For concealment (the real goal):** WASM is a *partial* win and **server-side
  rendering already conceals source today**. WASM's marginal value is
  *client-side concealed interactive* primitives. Decide whether that scenario
  is needed before investing.
- **Narrow case where native genuinely helps:** primitives that are heavy
  procedural vertex generation in tight JS loops (dense sweeps/lattices/voronoi/
  heightfields, tens–hundreds of k verts where the JS `weldAndBuild` hash-weld
  is hot), and as a **portable artifact** (a `.wasm` runs anywhere). That's a
  packaging/portability argument, not perf.

## Phased roadmap (only if pursued — scope to glue-only AS, client-compiled)
- **P0 — prove the premise:** instrument the heaviest raw-mesh primitive's JS
  vertex-gen + weld (the `_t` field exists). If glue < ~50ms, stop.
- **P1 — glue-only AS spike (hand-compiled):** AS `geom` emits a triangle
  buffer; `WebAssembly.instantiate`; marshal params in / mesh out; feed to the
  existing `weldAndBuild`; verify parity by bbox/volume.
- **P2 — sandbox integration:** a `source.wasm` (+ `source.as.ts`) artifact kind
  on the volume; `primitive-loader` detects + instantiates it; server-side
  `.wasm` validation + vertex caps.
- **P3 — in-browser compile:** `asc`-in-browser at save → preserves the
  runtime/LLM authoring loop.

## Param/mesh marshalling (if built)
Observable layer unchanged. Numbers → WASM args; polygons → linear memory
(`malloc` + `Float64Array`, pass `(ptr,len)`); output interleaved
`vertProperties`(f32)+`triVerts`(u32) → read views → existing `weldAndBuild` →
`finalizeManifold` (unchanged). Keep `weldAndBuild`'s orientation
self-correction as the ABI-winding safety net.

## Risks / open questions
- Two-engine identity (linked libmanifold can't interop with the JS engine) —
  glue-only avoids it.
- Build-time compile regresses runtime authoring (Rule 17) — must be client-side.
- Toolchain weight; marshalling winding/stride bugs.
- **The decisive open question:** is the goal concealment, perf, or portable
  artifacts? Concealment is largely met by server-side rendering today; only
  *client-side concealed interactive* primitives justify the WASM build.

### Critical files
`primitive-loader.ts` · `primitive-sandbox.ts` · `manifold-mesh.ts` ·
`api/primitives/preview/+server.ts` · `PrimitiveView.svelte`.
