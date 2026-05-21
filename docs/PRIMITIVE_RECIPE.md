# Primitive Recipes — the dual-control composition layer

> ⚠️ **SUPERSEDED (2026-05-22).** The composite representation is now
> **source.ts, NOT recipe.json** — the user wants programmatic control
> (`return A.add(B)`, loops/conditionals/locals) and source.ts is more
> controllable AND less code (a composite is just `source.ts` with
> `meta.params` + `meta.uses`; the existing `/primitives` view already
> renders the params as sliders). **The recipe layer below is PARKED** —
> dormant, revivable for AI-structured output or a visual builder.
>
> **Live direction (source.ts composites):**
> - GUI introspects the source — `src/lib/server/recognize-composite.ts` +
>   `POST /api/primitives/recognize` (acorn AST) → instances + composition +
>   uses. PrimitiveView has a **Parts tab** listing recognized instances.
> - **Option A reactive runes (client-generated):** PrimitiveView resolves
>   each part's arg expression against the live `pending` params (a
>   `$derived`), so dragging a param re-links the parts instantly (green
>   "→ resolved" lines) and re-bakes the geometry server-side. Worked
>   example: `docs/examples/t_bolt_driven.ts` (on the volume at
>   `primitives/tests/t_bolt_driven`).
> - Split: recognition + geometry = server; runes + GUI = client.
> - NEXT: editable Parts rows (round-trip → source) + "Load primitive →
>   import params + scaffold instance".
>
> Everything below describes the parked recipe layer.

## The model: leaf = code, composite = recipe

Primitives are becoming a two-layer system that gives **both source control
and JSON control** — the differentiator over the library/components model
(where a code leaf must be a git-tracked bundle component, not volume-authored):

- **Leaf = code.** Real geometry — helices, revolves, swept profiles — needs
  loops/trig, so a leaf is authored as `primitives/<id>/source.ts` and runs in
  the sandbox with the weld toolkit (`gridPatch`/`capFan`/`weldAndBuild`/
  `revolveProfile`) + `CrossSection`. The `r_*` primitives.
- **Composite = recipe.** Combining leaves needs *expression binding*, not
  code — so a composite is a declarative `recipe.json`: instances that `call:`
  leaves with args bound to literals or Tier-1 expressions, then a composition
  list (`add`/`subtract`/`intersect`). Safe, form-editable, params drive parts.

A part in the (eventual) unified store is **one or the other**, discriminated
by file presence: `source.ts` ⇒ code leaf, `recipe.json` ⇒ composite.

## Reuses the library engine — no fork

The recipe interpreter is shared with library parts:
`src/lib/server/part-recipe.ts` (`buildRecipe` + `evalExpr`). The ONLY
difference is the dependency resolver:

- library recipes → `createResolveDep` (call targets = bundle/library components)
- primitive recipes → `createPrimitiveResolveDep` (call targets = volume `r_*`
  primitives, resolved async via `primitive-loader`, + the `mv`/`rot` operators)

Orchestration: `src/lib/server/primitive-recipe.ts` (`buildPrimitiveRecipe`)
pre-resolves each distinct primitive call (read `source.ts` off the volume →
`extractMetaFromSource` for the positional param order → `buildPrimitiveGeom`
for the geom fn), then hands a sync lookup map to `buildRecipe`.

Render endpoint: `POST /api/primitives/recipe-preview { recipe, params?, zScale? }`
→ serialized `{ full, cutVC }` mesh. Local compute (NOT proxied); the leaves are
read off the volume via the proxy-aware `event.fetch`.

## recipe.json shape

```jsonc
{
  "meta": {
    "id": "...", "name": "...", "description": "...", "tags": [...],
    "params": { "shaft_od": { "label":"...", "min":0.5, "max":4, "step":0.1, "default":1.6 } },
    "material": { "outer": {...}, "inner": {...} }   // optional, baked into render
  },
  "instances": [
    { "name": "A", "call": "<volume primitive id>",
      "args": { "<argName>": <RecipeArg>, ... },
      "transforms": [ { "op": "mv", "args": [<RecipeArg>, <RecipeArg>, <RecipeArg>] } ] }
  ],
  "composition": [ { "op": "add", "of": "A" }, { "op": "subtract", "of": "B" } ]
}
```

**Arg shapes** (`RecipeArg`):
- `{ "lit": 4.5 }` — numeric literal.
- `{ "expr": "p.shaft_od * 2" }` — Tier-1 expression: arithmetic, `p.<param>`,
  `<INST>.<argName>` cross-instance refs, `Math.*` whitelist. No conditionals/loops.
- `{ "val": [[r,z],...] }` — **verbatim pass-through**, NOT evaluated. For the
  non-scalar args a polygon leaf takes (`r_revolve`/`r_extrude` `profile`,
  enum index, JSON contour).

**Call targets**: a volume primitive id (positional args, ordered by its
`meta.params`) or an operator (`mv`/`rot`, three scalar args). Args are matched
to the leaf's param order by name.

**Composition**: walked left-to-right, folded through one accumulator. Order
matters for `subtract`/`intersect`.

## Worked example — `t_bolt_hexhead` (see `docs/examples/t_bolt_hexhead.recipe.json`)

A bolt: round shaft (`r_cylinder`) + hex head (`r_extrude`). The composite
params `shaft_od` / `shaft_len` / `head_thick` drive the leaves, and the head's
placement **cross-references** the shaft length:

```
mv(B, [0, 0, -(p.shaft_len/2) - p.head_thick])
```

so the head always sits on the shaft's top face regardless of `shaft_len`.
Verified: at defaults bbox `z[-3.55,2.25]` (matches the hardcoded
`t_bolt_hexhead`); `shaft_len 6` → head follows to `z=-4.30`; `+head_thick 2`
→ `z=-5.00`. The polygon `profile` passes through as `{val}`.
