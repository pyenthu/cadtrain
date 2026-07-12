# `src/lib/engines/trueform/` — `@polydera/trueform` exact-mesh kernel

Client-side alternate kernel (main thread, `trueform-client.ts`); client **and**
server are the eventual goal. Files: `graph-to-tf` (graph → TF program),
`trueform-{adapter,client}`, `tf-{bake-client,worker,worker-core}`,
`crease-normals`, and `tf_examples/` (executable kernel demos).

- **Needs cross-origin isolation.** TF's WASM is built with pthreads: `tf.init()`
  transfers a `SharedArrayBuffer` to its worker pool, which throws
  `DataCloneError` unless `self.crossOriginIsolated === true`. Every response
  carries `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` (prod: `hooks.server.ts`
  `applyCrossOriginIsolation`; dev: vite middleware `crossOriginIsolation()`).
  There is no single-threaded fallback. Full invariant (and what COEP forbids —
  every subresource must be same-origin or CORP/CORS-opted-in) →
  `docs/architecture/geometry-engines.md`.
- The BORE-EXTEND fix for hollow swept tubes (coincident tilted caps → phantom
  handles in the TF *and* Manifold mesh boolean) lives in `tf_examples/execute.ts`;
  documented in `../manifold/CLAUDE.md` (`## Manifold gotchas` → r_sweep).
- **A wired section formula is evaluated with LIVE params** (`55636f1`):
  `graph-to-tf`'s `sectionRadiusOf` evaluates a wired ExprDef's `pts` formula
  (`evalWiredSectionPoints`, reusing `compileImperative`/`compileListFormula`), so
  editing the section (circle→ellipse) changes the recipe (`op:'sweep'` vs
  `op:'sweep_section'`) rather than reusing a stale binding-radius. Fail-safe fallback
  to the binding radius.
- Engine-layer overview + dependency rule → `../CLAUDE.md`.
