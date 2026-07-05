# TODO — TF_WASM tab (C++→WASM part builders, for concealment)

Idea (user, 2026-07-05): add a **TF_WASM** right-pane tab alongside the current
**TF** tab. Where TF builds a part by executing the graph→TF **JS recipe**
(`executeTfRecipe`, readable JS/JSON on the client), TF_WASM would build the
SAME part from a **C++ builder compiled to WASM** — so the geometry construction
logic ships as an opaque `.wasm` blob instead of inspectable JavaScript. Goal is
**IP concealment**: the part's build steps aren't trivially readable in devtools.

## Why it's plausible here
- TrueForm is a WASM kernel already; the recipe→build step (`buildInstr` in
  `src/lib/shared/tf_examples/execute.ts`) is the only JS-visible part. Moving
  that into compiled C++ hides the op sequence.
- There's already a referenced (unbuilt) sibling endpoint: `/api/tf/compile-wasm`
  (#49) — noted in `src/routes/api/tf/compile/+server.ts`'s header as "the
  lightweight counterpart" that would emit a WASM form vs the JS recipe. This
  TODO is essentially standing that up + a UI tab.

## Sketch of the work
- **Compile path:** graph → C++ source (a codegen from the same recipe IR) →
  emcc/clang → `.wasm` (+ a tiny JS shim exposing `build(params) → mesh`).
  Server-side, cached by scriptHash like the JS compile. Likely a build-time or
  on-demand toolchain (emscripten) — NOT in the request hot path.
- **Tab:** `RightPane.svelte` — a `backend="tf-wasm"` `PrimitiveDualCanvas`
  mount, `{#if rightTab === 'tf-wasm'}` (unmounts when hidden, like TF/BREP).
- **Client exec:** instantiate the compiled module, call `build(params)`, feed
  the returned mesh to `tfMeshToGeo` (same adapter as TF). Same native-only,
  no-Manifold-fallback rule as the TF tab.
- **Concealment caveat:** WASM is decompilable (wasm2wat / Ghidra), so this is
  *obfuscation*, not real protection — set expectations. Real IP protection is
  server-side execution (never ship the builder). Worth stating in the tab's
  tooltip so it's not oversold.

## Open questions
- Toolchain in the Docker/Railway build (emscripten adds image weight) — or
  precompile a fixed set of part builders vs per-graph codegen?
- Per-graph C++ codegen is a big lift; a first cut could compile the fixed
  `bw_*`/`g_*` engine builders to WASM and keep composition in JS.
- Does it share the COOP/COEP + pthread setup TrueForm already needs?

Status: parked idea. Revisit after the TF tab + perf follow-ups
(`tf-compile-perf.md`) settle.
