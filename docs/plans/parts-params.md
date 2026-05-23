# Parts tab — configurable params linked to functions (2026-05-23)

> Status: PLANNING. Bring the `/components` Inspector **Parts → Properties**
> param UI (named param + unit + value + ƒ function-link + `+` add) into the
> `/primitives` **Parts** tab.

## Reference UI (`/components`, `src/routes/components/+page.svelte`)
- The "🔗 link icon" is the **ƒ button** (`.pr-fx`) — there is no separate link
  icon; ƒ *is* the expression/link picker.
- Arg data model: `PartArg = {kind:'literal'|'paramRef'|'unknown', raw, value?, name?}`
  (`:1903`); `PartInstance` has positional `args[]` + keyed `argsObj` (`:1918`).
- Parse: `.ts` → `parsePartInstances` (balanced-paren scan + byte offsets,
  `:2017`); JSON recipe → `parseRecipeInstances` (`:2134`).
- Prop card (`:7698-7830`): head (name + unit) + ƒ button + `.pr-num drag`
  input (literals) + `.pi-fx-badge` (expressions).
- ƒ-popup: `formulaEdit` state (`:353`), `openFormulaEdit` (`:4547`),
  FloatingPanel + typeahead (`formulaCandidates` `:4913` = `p.<param>` +
  `<INST>.<prop>`), `applyFormulaEdit` splices the expr into source (`:4873`).
- Persistence: source/JSON is source of truth; splice → `applyDraft` → save.
  Cross-instance refs left un-substituted on disk; `expandInstancePropRefs`
  (`component-loader.ts`) substitutes them to literals before transpile.

## Current `/primitives` Parts (`src/lib/shared/PrimitiveView.svelte`)
- Recognition (NOT a recipe): `loadRecognition` POSTs source to
  `/api/primitives/recognize` → `recognizeComposite` (acorn AST).
- `RecognizedInstance` (`recognize-composite.ts:46`): args are a single opaque
  `argsText` string + byte offsets — NO per-arg structure, NO PartArg kinds.
- Render (`:945-1006`): one `.pv-part-edit` text input per instance bound to
  `argsText`; Enter → `spliceSource`. `resolvedArgs` is a client-side live
  preview via `new Function(...)`. Scalar params handled separately by
  `ParamGrid`. No ƒ-popup exists.
- Round-trip: edits → `editedSource` → re-recognize `$effect` → Save →
  `/api/primitives/save` writes the volume `source.ts`.

## Gap → reuse vs build
- Missing: per-arg cards, per-arg ƒ picker w/ typeahead, add/remove param.
- Reuse: Tier-1 grammar (`part-recipe.ts:179 evalExpr`, `:125 MATH_WHITELIST`)
  — already runs for the recipe path; top-chain placement (`part-recipe.ts:476`).
- The parsing/splice layers (`PartArg` vs `RecognizedInstance`) are too
  divergent to share — keep separate. The **ƒ-popup UI is shareable**: extract
  it to a new `src/lib/shared/FormulaPopup.svelte`.

## Phases
- **P0** — extend `RecognizedInstance` with `args: RecognizedArg[]`
  (`{raw,start,end,kind,value?,name?}`) from the AST arg nodes; keep `argsText`.
  Label cards via each leaf `call`'s `meta.params` (lazy fetch + cache, like
  `leafProfileCache`).
- **P1** — extract `FormulaPopup.svelte` (FloatingPanel + `wordAtCaret`/
  `replaceWordAtCaret` typeahead) from `components/+page.svelte:6161-6234`.
- **P2** — per-arg prop cards in PrimitiveView (mirror `ParamGrid` `.pr-card`),
  literal → drag input, expr → badge, ƒ button → FormulaPopup; candidates =
  `p.<param>` + `<INST>.<argName>`. Splice per-arg spans.
- **P3 (load-bearing)** — make `<INST>.<arg>` refs resolve at exec: **port
  `expandInstancePropRefs` into `primitive-loader.ts:buildPrimitiveGeom`**
  (Option A, recommended) so the source-.ts composite path behaves like
  components. (Option B: route composites through the recipe engine.)
- **P4** — add/remove param `+` (splice `meta.params` via
  `recognize-composite.ts` `paramsInsertPos`/`defaultStart/End`/`sigInsertPos`).
- **P5** — e2e; respect runes, Z-down, source-of-truth = `source.ts`.

## Risks
- **Cross-instance refs don't resolve in the primitives source path today**
  (biggest gap) — `A.length` errors unless P3 lands. `p.<param>` already works
  (params in scope).
- Offset drift on multi-edit — apply one splice per commit (re-recognize
  between), high-offset→low-offset.
- Editing requires `recognized.editable === true` (no TS type annotations).
- Live link `p.<name>` vs snapshot — match components (live).

## Critical files
`PrimitiveView.svelte` · `recognize-composite.ts` · `primitive-loader.ts` (P3) ·
`part-recipe.ts` (grammar ref) · `components/+page.svelte` (ƒ-popup to extract:
`:4547,4873,4913,6161-6234`).
