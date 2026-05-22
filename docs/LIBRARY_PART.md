# Library `part.json` — the active library-part recipe schema

The library (Rule 18) is directory-per-part under
`<volume>/library/<category>/<id>/`. Each part's geometry is a declarative
`part.json` recipe interpreted by `src/lib/server/part-recipe.ts:buildRecipe`.
This is the **active** schema for library parts.

The behavioral rules — three-layer model, name-collision convention,
`renderMode` — stay in root `CLAUDE.md` Rule 17. This file is the full shape.

## Shape

```jsonc
{
  "meta": {
    "id": "<id>", "name": "...", "description": "...", "tags": [...],
    "family": "drillstring|wellhead_xt|...",
    "params": { "od": { "label":"OD", "min":1, "max":10, "step":0.125, "default":4.5, "unit":"in" } }
  },
  "instances": [
    { "name": "A", "call": "<helper or component id>",
      "args": { "<argName>": { "lit": 4.5 }, "<other>": { "expr": "p.foo * 2" } },
      "transforms": [ { "op": "mv", "args": [{"lit":0},{"lit":0},{"expr":"A.length"}] } ]
    }
  ],
  "composition": [
    { "op": "add",      "of": "A" },
    { "op": "subtract", "of": "B" }
  ]
}
```

## Args

- `{ "lit": <n> }` — numeric literal.
- `{ "expr": "<tier-1>" }` — Tier 1 = arithmetic + `p.<param>` +
  `<INST>.<argName>` cross-instance refs + `Math.*` whitelist (`abs`, `sign`,
  `floor`, `ceil`, `round`, `trunc`, `sqrt`, `cbrt`, `pow`, `exp`, `log`,
  `log2`, `log10`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `min`,
  `max`, `PI`, `E`). **No conditionals, no loops.**

## Transforms

- `mv` and `rot` take three scalar args (x, y, z) — the recipe expresses vec3s
  as three Tier-1 expressions, not a single nested array.
- Implicit translation: an instance with a `top` arg AND non-zero resolved value
  gets `mv(0, 0, top)` prepended before user transforms.

## Composition

- Order matters for `subtract` / `intersect`. The interpreter walks
  left-to-right and folds through one `GeomAcc`.

## Name resolution

- Helpers + operators (`cyl`, `tube`, `mv`, `rot`) are the canonical namespace
  and **win on collision** — never name a library part `tube` or `cyl`.
  Convention: suffix library parts with `_part` when the natural name would
  collide.

## Authoring + AI

- The inspector Builder tab routes JSON parts to a `lang=json` editor; the Parts
  tab shows an "edit instances in Builder" banner (form-driven JSON Parts editor
  is a follow-up).
- The refine endpoint (`/api/components/refine`) accepts either `source`
  (legacy .ts) or `recipe` (JSON) and emits the matching shape — schema
  validator + 1-shot retry on bad output.

## Legacy .ts loader path

`loadGeomFromSource`, `parseImports`, `enforceSplitGrammar`,
`expandInstancePropRefs` are still kept so the Builder tab can preview in-flight
edits to bundle primitives in `src/lib/cad/components/*.ts`. No library part uses
it any more — every `library/<cat>/<id>/` now has a `part.json`. Plan:
`~/.claude/plans/grammar-split-init-compose.md` (which describes the intermediate
split-grammar TS shape; the JSON pivot supersedes Stage G onward).
