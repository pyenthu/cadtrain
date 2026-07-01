# Visual expression editor — for + if/then, no code required

**Status:** planning (2026-07-01, user). Finish the multi-line expr-OUTPUT editor so a
NON-programmer builds a `list<point>` (or other) output VISUALLY with just **for loops**
and **if/then** — no JS/TS, no variable declarations. Extends the imperative builder that
was started (#11) but never finished for full visual output editing.

## What exists (the foundation)
- `src/lib/cad/expr-imperative.ts` — the IMPERATIVE accumulator model for list outputs:
  `poly = []` / `for i = 0 to N { point = [x,y]; poly.append(point) }` / return poly.
  Parses ↔ serializes ↔ compiles to a JS IIFE (real for-loop + push). Statements TODAY:
  **assign** + **append**; blocks: **for** (with an optional 2nd iterator). Body exprs are
  lowered via the functional list compiler (`compileListFormula`/`parseAndValidateBare`), so
  cos/sin/loop-vars/params resolve identically.
- `ExprCodeEditor` (CodeMirror 6, text) + `ExprImperativeBlocks` (visual for-blocks, started).
- Type inference: `struct-type.ts` infers the output type from the accumulated shape (#20).
- Related plans: `expression-list-builder.md`, `loop-builder.md`, `expression-builder.md`,
  `expressions-tab.md` — this focuses + finishes them into the visual for/if editor.

## The gap (what "was never finished")
- Editing a full multi-line output body VISUALLY end-to-end isn't complete — for-blocks exist,
  but multiple loops + intermediate assigns + the accumulator aren't fully editable as blocks.
- **No if/then** — `ImpStatement` is only assign/append; there's no conditional.
- The syntax is JS-ish (`[x,y]`, `poly.append`) and variable declarations leak — not friendly
  for users who don't know JS/TS.

## The ask (refined by the user)
1. **for loops** (have) + **if/then** (NEW) — the only two control structures needed.
2. **Visual, in the editor** — a block palette: `for i = 0..N`, `if <cond> then …` (else optional),
   `set <name> = <expr>`, `add point [x,y,z]` (append) — add/nest/reorder blocks. Extend
   `ExprImperativeBlocks` with if/then and make blocks the PRIMARY path. Live output preview
   (the sampled points) beside the blocks.
3. **No variable declarations** — the builder OWNS the vars (accumulator `poly`, loop var `i`,
   intermediate `set`s). The user names them in blocks; `let/const` never appears — declarations
   are implicit/managed.
4. **Friendly (CoffeeScript-ish) text mirror** — for those who want text: implicit returns,
   `for i in 0..N`, `if … then …`, no braces/semicolons/var-decls. NOTE: full CoffeeScript is
   heavy/dated — DON'T ship the real CoffeeScript compiler; use a SMALL friendly DSL = the block
   model's text form, compiled to the SAME JS IIFE. Blocks are primary; text is a readable mirror.

## Approach
- **Model:** extend `ImpStatement` with `if` `{ cond, then: ImpStatement[], else?: ImpStatement[] }`.
  Keep assign/append/for. Accumulator + loop vars stay builder-managed.
- **Compile (`expr-imperative.ts`):** lower `if` to a JS `if` inside the IIFE; condition lowered
  via the existing functional compiler so params/loop-vars resolve identically. struct-type still
  infers the output shape from what's accumulated.
- **Visual (`ExprImperativeBlocks`):** a nestable block list — for / if-then(-else) / set / add-point;
  each block's small expressions edited inline (ƒ popover for complex ones); live sampled-point preview.
- **Text mirror:** the CoffeeScript-ish DSL ↔ blocks (round-trip), compiled to the same IIFE.

## Sequencing / ties
- Extends #11 (expression-as-builder) + #20 (typed outputs) + `expr-imperative.ts`. Independent of
  the AI master plan.
- **P1:** if/then in the model + compile (text works). **P2:** the visual block editor (for/if/set/
  add) + live preview, no var-decls. **P3:** the friendly DSL text mirror.
