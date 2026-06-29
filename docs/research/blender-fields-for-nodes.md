# Blender Geometry-Nodes **FIELDS** — what we should borrow for our node graph

**Status:** research note (2026-06-29). Studies Blender's *Fields* model and maps it
onto our typed-socket / expression-output system. Cross-links
[`docs/plans/parametric-surface-solid.md`](../plans/parametric-surface-solid.md),
[`src/lib/cad/port-types.ts`](../../src/lib/cad/port-types.ts),
[`src/lib/cad/composition-graph-types.ts`](../../src/lib/cad/composition-graph-types.ts)
(`ExprOut`), and the `r_surface` / `r_helical_surface` engines.

> **Headline:** our parametric surface `fn(u,v)` already *is* a **field over the uv
> domain**; our `list<point>` / uv-grid is the **materialised (captured)** form of
> one. A single new abstraction — a **field SOCKET** (a wireable function-over-a-
> domain) plus a **Capture/Bake node** (field → concrete grid/list) — unifies
> surface + list + displacement AND fixes the `r_surface(fn)`-isn't-wireable problem
> cleanly. Recommend adopting the field *socket + capture* mechanic and explicitly
> **avoiding** Blender's implicit field *inference*.

---

## 1. The Fields model (cited)

Blender reworked Geometry Nodes in 2021 around **fields** + **anonymous attributes**.
Sources: the [official Fields manual](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/fields.html),
the developers' [Attributes and Fields](https://code.blender.org/2021/08/attributes-and-fields/)
design post and the [Fields & Anonymous Attributes proposal](https://devtalk.blender.org/t/fields-and-anonymous-attributes-proposal/19450),
plus community explainers ([Artisticrender](https://artisticrender.com/blender-geometry-nodes-fundamentals-guide/),
[Sullins / Medium](https://medium.com/@samuelsullins/last-year-blender-totally-revised-geometry-nodes-da055d7af226),
[Blender Artists](https://blenderartists.org/t/help-clarify-geometry-nodes-fields-attributes/1528204)).

- **A field is a function, not data.** *"Fundamentally, a field is a function: a set
  of instructions that can transform an arbitrary number of inputs into a single
  output… calculated many times with different input data"* (Artisticrender). It is
  evaluated **per element of a geometry domain**, **lazily** — there is no explicit
  array of values flowing down the wire, only the recipe.

- **Geometry DOMAINS.** A mesh has domains **point / edge / face / face-corner**;
  curves add **spline/curve**; and there is an **instance** domain. A field is
  ultimately evaluated *on* one domain — "for mesh objects, position fields reference
  each vertex individually" (Artisticrender). Blender's win: *"artists don't need to
  worry about attribute domains… and are free to change the topology of the geometry
  while the function flow still works"* (Shahrabi).

- **Field sockets (diamond) vs single-value sockets (circle).** *"Fields are
  represented by a little diamond node socket"*; round sockets are single values, and
  *"you can't connect a Field to a single-value round socket"* (Sullins). A **diamond
  with a dot** = a field-capable input currently fed a constant (Artisticrender). This
  is a first-class **socket-type distinction in the wire system**, exactly analogous to
  our `card: 'one' | 'list'` and `elem` in `port-types.ts`.

- **Built from primitive field nodes.** **Position**, **Normal**, **Index** output a
  field (e.g. *"Position node: outputs vertex coordinates as a field"*); math/vector
  nodes compose them into a derived field — `sin(index)`, `position + normal*h`, etc.

- **Consumed by domain-evaluating nodes.** **Set Position** *"consumes position fields
  to transform geometry"*; the field is evaluated once per point of the geometry it
  receives.

- **Capture Attribute = the materialisation step.** *"The Capture Attribute node
  evaluates a field, copying the result to an anonymous attribute on the geometry"*
  (search snippet / manual) — i.e. it **freezes** the lazy function into a concrete
  per-element attribute *at that point in the graph*, before later nodes change the
  topology. This is the field → data boundary.

- **Named vs anonymous attributes.** *Named* attributes are addressed by string
  (`position`, a user `myAttr`). **Anonymous attributes** *"allow working with geometry
  attributes without having to worry about name conflicts"* and are *"created via the
  Capture Attribute node"* — they are the unnamed, wire-carried result of capturing a
  field. The whole point was to replace error-prone **typed attribute-name strings**
  with **wires**.

- **Field inference / implicit context** — and its documented pain. A field has **no
  domain of its own** until it reaches a consumer; *"execution flows along geometry
  connections, where Blender backtracks to evaluate non-geometry inputs at each node…
  the geometry passed determines the domain"* (Artisticrender). This implicitness is
  the single most-cited learnability problem:
  - *"a common misunderstanding [is] that the same field node tree used in multiple
    places will output the same data, when in reality the field node tree will be
    evaluated for every data-flow node, potentially retrieving data from a different
    or changed geometry"* (Blender Artists).
  - *"The terminology of domain and fields, geometry and components can get very
    confusing very fast"* (Artisticrender).
  - Capture Attribute itself is *"particularly confusing… the intuitive understanding
    doesn't match how it actually works"* (Shahrabi).

  **Takeaway:** the *field-socket + capture-node* mechanic is the good part; the
  *implicit, geometry-backtracked domain inference* is the part everyone trips on.

---

## 2. Mapping to OUR system

Our editor already has most of the pieces under different names.

| Blender Fields | Our system (today) | File |
|---|---|---|
| Field = per-element function, lazy | Expression `fn(u,v)`→`[x,y,z]` passed to `r_surface`; a `map(range(N), f(i)=…)` formula | `r_surface.ts`, `graph-exprs.ts` |
| Single-value socket (circle) | `PT_SCALAR` (`card:'one'`) | `port-types.ts` |
| Field socket (diamond) | **— no equivalent.** Closest is `list<point>` (`PT_LIST_POINT`) but that is *materialised data*, not a function | `port-types.ts` |
| Domain (point/edge/face/instance) | our **implicit** domains: uv-surface grid · polygon-point list · repeat-instance list | `expr-imperative.ts` (grid loop), `parametric-surface-solid.md` |
| Position / Index field-input nodes | loop vars `i` / `u,v` inside an `ExprDef` body | `expr-imperative.ts` |
| Capture Attribute (field→attribute) | the **imperative loop itself**: `for u,v { surf.append(fn(u,v)) }` materialises the grid; `compileListFormula` lowers a `map` to a concrete JS array | `expr-imperative.ts`, `graph-exprs.ts` |
| Anonymous attribute (wire-carried result) | the `list<point>` / `shape:'surface'` **grid** output socket | `composition-graph-types.ts` (`ExprOut`), `parametric-surface-solid.md` |
| Named attribute (string-addressed) | `meta.params` keys; the (reserved) composite **record** types (`defineRecordType`) | `port-types.ts` |

### The precise correspondence (the key insight)

A parametric surface in our engine is literally
`fn(u,v) → [x,y,z]` for `u,v ∈ [0,1]` (`r_surface.ts` header). That is **exactly a
field over a 2-D uv domain** — a function evaluated per uv-element, lazily.

Our **expression-list** output (`shape:'list'`, `elem:'point'`) and the planned
**`shape:'surface'`** uv-**grid** are the **materialised / captured** form of that same
field: the loop `for u { for v { surf.append(fn(u,v)) } }` (`expr-imperative.ts`,
`ImpLoop.loopVar2`) is the **Capture Attribute step** — it runs the field over an
explicit Nu×Nv sampling and freezes it into concrete data.

So our two existing representations are the two ends of Blender's spectrum:

```
  FIELD (lazy fn)              CAPTURE             DATA (materialised)
  r_surface(fn)        ──[for u,v: append]──▶   uv grid  /  list<point>
  fn(u,v)→[x,y,z]                               (shape:'surface' / list<point>)
```

We currently have the **data** end fully wireable (`list<point>` is a first-class
PortType, drag-to-wire into a polygon) but the **field** end is **not wireable at
all**: `r_surface`'s first arg is a raw JS closure, which is *"not a GUI dial"* and
*not* a graph value (`r_surface.ts` header; `parametric-surface-solid.md` §2 calls this
out — *"this is what `r_surface(fn)` got wrong; a grid is wireable"*). The cost is
visible in history: commit `0f1a3f0` had to convert **`p_sq_grove` from a bake-only
`r_surface(fn)` into a graph-editable revolve** precisely because the closure form
couldn't live in the graph.

---

## 3. Enhancement recommendations (ranked, minimal-first)

### R1 — Adopt a **field SOCKET** PortType, and make `r_surface`/`r_solid` take it (HIGH value, LOW risk)
Add an `ElemShape: 'field'` (or a `PT_FIELD_UV` core type) to `port-types.ts`. A field
socket carries a **reference to an `ExprDef` + its domain** (`'uv' | 'point-list' |
'instance'`), **not** a JS closure and **not** a materialised array. An `ExprDef` whose
output is `shape:'surface'` *unmaterialised* becomes a wireable diamond output; a
`fn(u,v)` engine arg becomes a typed field **input slot**.

Why first: it is the smallest change that makes the function form a first-class graph
citizen, and it directly fixes the `r_surface(fn)`-isn't-wireable problem that already
forced a part rewrite (`0f1a3f0`). `canFeed` already models `one→list` broadcast; a
field is just a third cardinality-like distinction the same registry can carry.

### R2 — Add ONE explicit **Capture / Bake node** (field → grid/list) (HIGH value, LOW risk)
A visible node `Capture(field, Nu, Nv) → grid` (and `Capture(field, N) → list<point>`).
This is Blender's Capture Attribute **made explicit and eager** — it is also exactly the
planned `r_surface(grid)` consumer in `parametric-surface-solid.md` piece 2/3. Keeping
capture an **explicit node** (not implicit, see R5) means: the user *sees* where
sampling/resolution happens (Rule 25: segmentation at build time), the grid is
inspectable (the surface mini-visualiser in the plan), and a field can be wired into
**either** a capture node **or** directly into an engine that samples it itself.

Together R1+R2 give the unifying picture the plan is reaching for:

```
  ExprDef(shape:surface, lazy)  ◇──field──▶  Capture(Nu,Nv) ──grid──▶ r_surface / r_solid
                                  └──────────field──────────────────▶ (engine samples directly)
```

### R3 — Name our three **domains** explicitly on field/list types (MEDIUM)
We already have three implicit domains; make them an enum on the type, not folklore:
- **uv-surface** domain → `shape:'surface'` grid (Nu×Nv).
- **polygon-point** domain → `list<point>` (the profile loop).
- **repeat-instance** domain → `list<transform>` (the #11 part-repeat target).

A field declares the domain it is *written against* (`fn(u,v)` ⇒ uv; `f(i)→[r,z]` ⇒
point; `f(i)→transform` ⇒ instance). `canFeed` then rejects a uv-field wired into a
point-list slot — the typed-socket check we already do for `elem` mismatch
(`ExprOutElem`), lifted to the field level. This is the *good* half of Blender domains
(topology-independent reuse) without the *bad* half (R5).

### R4 — Let the imperative loop builder emit **either** a field **or** captured data (MEDIUM)
`expr-imperative.ts` already compiles the same loop two ways conceptually. Add a toggle
on the output: **"lazy (field)"** vs **"materialise N now"**. Lazy keeps the `ExprDef`
as the recipe (wire it as a field, R1); materialise runs the existing
`compileImperative` IIFE (today's behaviour, byte-identical). One UI affordance, reuses
the whole compiler.

### R5 — **AVOID** implicit field *inference* / geometry-backtracking (explicit decision)
Do **not** copy Blender's "the field has no domain until a downstream geometry node
decides it, by backtracking the graph." It is the single most-cited source of confusion
(*"the same field node tree… evaluated for every data-flow node… potentially retrieving
data from a different geometry"*, Blender Artists; *"domain and fields… very confusing
very fast"*, Artisticrender; Capture Attribute *"doesn't match how it actually works"*,
Shahrabi). Our model should keep the domain **explicit and declared on the socket**
(R3) and capture **explicit** (R2). This is consistent with our existing nominal,
declared typing (`port-types.ts`: *"don't start with deep structural/tree typing"*,
*"flat lists, no data trees"*) and with the research decisions already locked in TODO
#11/#13.

### R6 — Defer field *broadcasting* across domains (LOW / later)
Blender auto-resamples a face field onto points etc. Powerful but exactly the implicit
magic R5 warns against. Skip until a concrete need; if added, make it an **explicit
resample node**, never an automatic socket coercion.

---

## 4. Net answer to the three framing questions

1. **Should expression outputs be FIELDS as well as explicit lists/grids?** Yes — add a
   *lazy* field form alongside the existing materialised one (R1, R4), but keep
   materialisation **explicit** (R2). Trade-off: the explicit-data model is simple and
   *already wireable as data*; the field form's payoff is purely (a) wiring a
   *function* (fixes `r_surface(fn)`), (b) deferring resolution to build time (Rule 25),
   and (c) reuse of one recipe at several resolutions. Adopt fields **additively**, not
   as a replacement.

2. **Does a single "field socket + capture node" unify surface / list / displacement?**
   Yes. A displacement surface (`r_helical_surface`'s `r(θ,z)`), a parametric surface
   (`r_surface`'s `fn(u,v)`) and a profile (`f(i)→[r,z]`) are all **fields over a
   domain**; capturing samples each into the grid/list our engines already consume. One
   field-socket type + one capture node subsumes all three, and `r_solid`'s *two
   surfaces* become *two fields → two captures → weld* — no new mechanism.

3. **Borrow vs avoid.** BORROW the **diamond field socket** distinction, the **explicit
   Capture node** (field→data), and **named domains**. AVOID **implicit field inference
   / geometry-backtracked context** and **automatic cross-domain resampling** — keep
   domain + capture explicit and declared.

---

## 5. Pitfalls / notes
- Keep it **additive + minimal-first**: R1+R2 alone deliver the wireable-function win and
  the `r_surface(grid)` consumer the surface plan already needs. R3–R6 are follow-ons.
- A field socket must carry a **reference** (defId + domain), never a live JS closure —
  closures don't serialise into `meta.graph` and aren't inspectable (the `r_surface(fn)`
  lesson). The recipe is the `ExprDef`; the wire carries its id + domain.
- Resolution (Nu/Nv/N) lives on the **Capture node**, never as a post-bake mesh rewrite
  (Rule 25 — subdividing a baked Manifold corrupts the WASM singleton).
- This dovetails with TODO **#11** (expression-as-builder), **#13** (typed ports) and the
  **parametric-surface-solid** plan; it is the typed-ports registry (`port-types.ts`)
  growing one more first-class type, exactly the "register a PortType, not a 4-layer
  sweep" design intent.

## Sources
- [Fields — Blender manual](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/fields.html)
- [Attributes and Fields — Blender Developers blog](https://code.blender.org/2021/08/attributes-and-fields/)
- [Fields and Anonymous Attributes (proposal) — devtalk](https://devtalk.blender.org/t/fields-and-anonymous-attributes-proposal/19450)
- [Geometry Nodes fundamentals — Artisticrender](https://artisticrender.com/blender-geometry-nodes-fundamentals-guide/)
- [Last year Blender totally revised Geometry Nodes — Sullins / Medium](https://medium.com/@samuelsullins/last-year-blender-totally-revised-geometry-nodes-da055d7af226)
- [Help clarify Fields & Attributes — Blender Artists](https://blenderartists.org/t/help-clarify-geometry-nodes-fields-attributes/1528204)
- [Create stylized scenes (fields confusion notes) — Shahrabi / Medium](https://shahriyarshahrabi.medium.com/blender-geometry-nodes-create-stylized-scenes-e336967c7f84)
