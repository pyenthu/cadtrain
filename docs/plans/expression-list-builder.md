# Expression-as-builder — structured + list outputs, loops, wired everywhere

**Status:** idea / research, captured 2026-06-26 (from the spiral exploration —
g_spiral / g_spiral_sketch / g_spiral_repeat showed the same loop+bindings
pattern re-implemented in THREE places: poly_repeat, sketch_repeat, part-repeat).

## The idea

Today the expression builder (`ExprDef`, §v3.10) outputs **scalars** — a number
wired into a single arg/coord. Enhance it so an OUTPUT can carry a **data
structure**: a scalar, an **object**, or a **list** — and let the expression
contain a **loop** (map over a range). The output SOCKET then carries that
structured value and wires into any consumer that wants it:

- list of `[r,z]` → a polygon's points (replaces `poly_repeat`)
- list of sketch ops `{op,mode,r,z}` → a sketch's ops (replaces `sketch_repeat`)
- list of transforms / placed parts → a `repeat` / `place([...])` (replaces the
  part-level repeat's bindings+modifiers)
- object → a structured arg; scalar → a single arg (today)

One generic mechanism subsumes all three repeat node types. The spiral collapses
to ONE expression with a `map` inside:

```
spiral_out = map(range(NPts), i => {
  theta = i*turns*tau/NPts;
  R = r0 + growth*i/NPts;
  return [R*cos(theta), R*sin(theta)];   // a list of [r,z] points
})
```

…wired straight into a polygon/extrude. A second output (or a concat) gives the
inner edge. This is the substrate for a **"builder" app**: expressions are the
generators, and you wire structured data (points, ops, transforms, parts)
between them — a functional dataflow on top of the existing graph.

## Case 1 (canonical first example) — list of points → profile

The spiral outline as ONE expression output (`shape: list<point>`), two maps
concatenated:

```
profile_pts =
  [ ...map(range(NPts), i => {            // outer edge, forward
        theta = i*turns*tau/NPts; R = r0 + growth*i/NPts;
        return [R*cos(theta), R*sin(theta)];
      }),
    ...map(range(NPts), j => {            // inner edge, reversed
        idx = NPts-1-j; theta = idx*turns*tau/NPts; R = r0 + growth*idx/NPts - width;
        return [R*cos(theta), R*sin(theta)];
      }) ]
```

**Wire it BOTH ways (decided — support both):**
- **(a) → a polygon / sketch node's `points` slot.** Preferred for authoring:
  the profile node renders the **2D sketch preview** (the numbered-point view) so
  you can SEE and debug the generated outline before it extrudes.
- **(b) → directly into `r_weld_extrude` / `r_revolve`'s `profile` arg.** The
  reductive case — the expression IS the profile, no node in between (the extrude
  already accepts a raw point list via `__POLY__`).

Both are valid drop targets because the socket carries `list<point>`; any slot
typed to accept a point list takes it. (a) is the default demo because the 2D
preview is the payoff.

**Element-shape typing.** A `list<point>`, a `list<op>` (sketch ops), and a
`list<transform>` are DIFFERENT element shapes — the wiring rules must reject a
point-list into a transform slot, etc. So the output's type is `list<E>` where
`E ∈ {point | op | transform | scalar | object}`, not just "a list".

## Why it's plausible (engine already supports it)

The expression engine is **mathjs** (already wired, `parseAndValidateBare`).
mathjs natively supports **arrays, objects/records, `map`, `range`, and inline
function definitions** — so the math layer can already evaluate a list-of-objects
output. The work is mostly MODEL + UI + WIRING + EMIT, not a new evaluator:

1. **Model** — an `ExprOutput` gains a `shape: 'scalar' | 'object' | 'list'`
   (and for list, an element shape). Validation allows non-scalar results.
2. **Loop affordance** — a `map(range(N), v => …)` builder (or just allow it in
   the formula textarea) with a loop var in scope, mirroring the repeat bindings.
3. **Typed output sockets** — the socket advertises its shape; wiring rules only
   allow a list output into a list-shaped slot (polygon points / sketch ops /
   repeat), an object into an object slot, a scalar into a scalar slot.
4. **Emit** — splice the list/object into the consumer's slot (the consumers
   already accept arrays — polygon `points[]`, sketch `ops[]`, `place([...])`).
5. **Migration / coexistence** — keep poly_repeat/sketch_repeat/part-repeat
   working; the expression-list path is an additive, more general option. Later,
   the repeat nodes could become sugar that *emit* an expression-list under the
   hood.

## Open questions

- Type system depth: just `scalar|object|list`, or a richer shape (named record
  fields, list-of-record with known keys)? Start minimal.
- Where does the loop live — inside the formula (mathjs `map`) or as a structured
  "for each" UI block? mathjs-in-the-textarea is the cheapest first cut.
- Validation/cycle rules for list outputs feeding list consumers.
- Performance: a 720-point spiral as a mathjs map vs the current emitted
  `Array.from` — bench before committing to the math path for hot loops.
- Does the WELD/extrude path stay the consumer (clean ribbon), or do we also want
  the "loft between list items" mode (the swept-solid feature noted in
  g_spiral_repeat.md)? Likely complementary.

## Research findings (deep-research pass, 2026-06-26) — DESIGN DECISIONS

A 104-agent deep-research pass (Grasshopper, Dynamo, Geometry Nodes/Fields,
Houdini, CadQuery, OpenSCAD, socket type systems) lands on these concrete calls:

- **Start FLAT — a typed `list<element>`, one element-shape per socket, NO nested
  data trees.** Grasshopper's universal path-indexed *data tree* is powerful but
  its own vendor docs name tree-matching the dominant usability burden ("a small
  change in structure can have big impact"; the Path Mapper is "the least
  intuitive… can cause a loss of data"). **Do NOT ship graft/flatten/path-map
  early.** Keep structure flat + explicit; add nesting only if a real case needs it.
- **Default lacing = longest-list "repeat-last" broadcast** when one output feeds
  a multi-input consumer (GH's default; a single item broadcasts across a list,
  two lists pair index-wise). Cheap, predictable, matches user expectation.
- **Structural element-shape typing, surfaced via socket APPEARANCE** (Blender's
  field sockets use distinct shapes; it consolidates many geometry-ish kinds onto
  ONE geometry socket). So: a small fixed set of element shapes
  (point / op / transform / scalar / object), each a visually distinct socket;
  wiring allowed only when shapes match. Nominal-ish (named kinds) + visual cue,
  not a deep structural type system.
- **One generic `map(range(N), i=>element)` replaces the three repeat nodes** —
  this is exactly CadQuery's one-mechanism model (`pushPoints` → any construction
  op fans out per point) and OpenSCAD list comprehensions. Strong external
  precedent for the unification.
- **Fields (deferred per-element functions) vs explicit lists**: Blender/Houdini
  defer evaluation (a function over a domain) rather than materialize a list.
  For us, the emitted `Array.from` IS the materialized list — fine for our sizes;
  revisit a deferred/field model only if hot loops or huge counts demand it.

**Net first-cut spec:** flat `list<element>` sockets, 5 element shapes with
distinct socket visuals, longest-repeat-last broadcast, NO data trees / path
tools. Grows toward nesting + richer lacing only on demand.

## Prior art (sources surveyed)

- **Grasshopper (Rhino)** — the canonical visual dataflow CAD; its **data trees**
  (nested lists) + list-management components (graft/flatten/shift/cross-ref) are
  the reference design for "wire lists of objects." Study its tree model + the
  pain points (tree matching) before copying.
- **Dynamo (Revit)** — list-lacing rules (shortest/longest/cross-product) — how
  it pairs lists across inputs.
- **Blender Geometry Nodes / Sverchok** — fields + attributes; "everything is a
  field over a domain" is an alternative to explicit lists.
- **OpenSCAD list comprehensions** (`[for (i=[0:n]) f(i)]`) — text-generative,
  the closest to our `map` idea.
- **CadQuery / replicad** — `eachpoint`, workplane arrays — functional placement
  over a point set (our repeat-as-sweep cousin).
- **Houdini** (VEX/attribute wrangle) — the gold standard for per-element data
  flow; overkill but instructive on copy-to-points / sweeps.
- **mathjs** docs — confirm `map`/`range`/object support + perf for our sizes.

A focused deep-research pass (the `deep-research` skill) on "visual dataflow CAD
list/tree models + list-lacing" would de-risk the type/wiring design before any
code.

## Payoff

- One generic generator instead of three repeat node types.
- A "builder" surface: wire points → profiles, ops → sketches, transforms →
  placements, all from typed expression outputs.
- Sets up data-driven parts (a list output can come from a param table / CSV /
  the RAG layer) — heterogeneous repeats fall out for free.
