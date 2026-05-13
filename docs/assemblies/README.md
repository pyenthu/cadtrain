# Assembly recipes

This directory holds **named multi-primitive recipes** — when the user
asks for a recognised real-world assembly (e.g. "build a tubing hanger
spool stack", "give me an HF-1 production packer", "show me a
4-valve Christmas tree"), the corresponding `.md` here documents:

1. Which **primitives** compose the assembly (one to N entries from
   `src/lib/components/runes/`).
2. A **starter `AuthoredComponent` spec** — JSON with `parts` +
   `transform` so any session can paste it into `/author` (or feed it
   into `buildAuthored()`) and get a working render.
3. Z-axis **stack diagram** and key dimensions so proportions are
   recognisable on first render — no "tall thin string" surprises.
4. **Catalog / KB references** — which `static/kb/api/*.json` rows
   feed the part param defaults, plus any vendor catalog URLs.
5. **Variations** — common-size / common-pressure-class variants
   (e.g. 2K / 5K / 10K spool variants of the same recipe).

## Why this exists

Each session, an assistant re-discovers what's been built by reading
the codebase. That's fine for primitives (one file, clear shape). For
assemblies it's lossy — the *recipe* (which primitives, in what
order, with which params) lives only in conversation history and
evaporates. Writing it down here lets the next session start from
"a working spec for this assembly already exists" instead of from
scratch.

## How recipes get used

- **By a future Claude session** — when the user says "build X", first
  check `docs/assemblies/` for an existing recipe. Found → start from
  the spec, adjust params for the specific size/class the user wants.
  Not found → ask the user which primitives compose it, then write
  the recipe as you build so the next session has it.
- **By the user** — single source of truth for what's been modelled.
  Open the .md, copy the `AuthoredComponent` JSON, paste into
  `/author`, render, tweak.
- **By the `/api/author/*` endpoints** — eventually, the
  authored-context preamble can include this directory wholesale so
  Claude tool-calls during authoring have first-class access.

## When to write a new recipe

- **First time the user asks for a multi-primitive assembly by name** —
  scaffold the recipe as you build it. Even if incomplete, the *name +
  primitives used* line is the seed.
- **When you build an assembly that doesn't have a recipe yet** —
  write it before committing. Future-you will read it.

## When NOT to write a recipe

- **One-off / experimental shapes** that aren't a named real-world
  thing. The recipe directory is for things the user (or industry)
  has a noun for, not for every CSG composition.
- **Single-primitive renders** — those are documented in the
  primitive's own `.md` (see `docs/PRIMITIVE_TEMPLATE.md`).

## Recipe template — copy `_TEMPLATE.md` to `<assembly_id>.md` and fill in

See `_TEMPLATE.md` in this directory. First worked example:
[`tubing_hanger_spool_stack.md`](./tubing_hanger_spool_stack.md).

## Index of recipes

| Recipe | Real-world thing | Primitives used |
|---|---|---|
| [tubing_hanger_spool_stack](./tubing_hanger_spool_stack.md) | Wellhead spool that suspends production tubing + lands BPV | `tubing_hanger_spool` + `tubing_hanger_coupling` |

Add new rows here when you write a new recipe.
