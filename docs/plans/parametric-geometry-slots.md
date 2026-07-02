# Parametric geometry slots — spline / expression / profile as an overridable param

**Status:** planning (2026-07-02). User direction: let a part expose its internal
geometry (a **path spline**, a **cross-section expr/profile**) as a **typed
parameter with a DEFAULT**, so a caller can **override** it (wire in / pass a value)
while keeping the rest parametrized. Concrete driver: `s_tube` wants to **wire in the
path** of `sweep_tube_demo` while keeping the **cross-section parametrized by one
variable (`rad`)**. Rides the typed-output / dynamic-wiring spine
(`docs/plans/typed-expression-outputs.md` #20/#926, `spline-generic-source.md` #26,
typed ports).

## The two framings (user weighed both)
- **A. Typed geometry PARAM (RECOMMENDED).** Extend params beyond scalars: a param's
  type can be `spline` / `list<point2|3>` / `profile` / `expr<T>`, with a **default
  value** (today's inline spline/expr). The caller overrides by passing a literal,
  **wiring** a compatible expr/spline output into the param socket, or leaving the
  default.
- **B. Class/slot inheritance.** A base part defines overridable "slots" visible to a
  derived/parent part that overrides them. **Heavier** — the graph model isn't
  class-based; adds an OOP hierarchy.

**Recommendation: A.** In a graph, a "slot" IS just a **typed param with a default +
an override**. Option A delivers the whole "default profile, override the sub-profiles"
ask incrementally on machinery that already exists (wireable sockets #26, typed ports
#20/#926, `struct-type.ts` inference). Inheritance (B) can layer on LATER as sugar —
"a derived part = a part that fixes some params of a base part" is already expressible
as a wrapping call once params can carry geometry.

## Design (Option A)
1. **Param types beyond `number`.** A `meta.params` entry may declare a type from the
   port-type registry: `spline`, `list<point2>` / `list<point3>`, `profile`,
   `expr<T>`. Default value = the current inline literal (e.g. the S-curve control
   points, or the circle expr). Unset → default; the part bakes standalone as today.
2. **Override at the call site.** A `Call` node's arg for a geometry param can be:
   (a) a literal, (b) a **wired** output (an `expr`/`spline`/`profile` node → the
   param's typed input socket; type-checked, plain-language reject on mismatch),
   (c) omitted → the part's default. Same override model as scalar params, extended
   to typed geometry values.
3. **Emit.** The geom fn takes the geometry param with a default:
   `sweep_tube_demo({ rad, path = <default spline>, section = <default expr> })`.
   The composition-emit path already threads `ArgValue = literal | expr | param`;
   extend it so a param can resolve to a spline/expr block (reuse `emitSplineBlocks`
   / expr blocks, with the caller's override substituted, else the default).
4. **Editor.** The param chip renders a geometry param with a **default / overridden**
   badge + a wire socket (like the spline points-input from #26, but at the PARAM
   level). Wiring a spline/expr node into it overrides; an "reset to default"
   affordance clears the override.
5. **`s_tube` worked example.** `sweep_tube_demo` params: `rad:number` (default 0.6) +
   `path: spline` (default = the S-curve). `s_tube` builds one path spline and wires
   it into BOTH `A.path` and `B.path`, passing `rad:0.4` / `rad:0.25` — one shared
   path, two radii, no duplicated curve. (Bonus: a shared path also keeps the two
   operands' geometry consistent, relevant to the hollow-tube caps.)

## Relationship / sequencing
- This is the **PART-LEVEL** generalization of #26 (wire an expr into a *spline*) →
  now wire a spline/expr/profile into a *part's geometry param*. Every node's typed
  output wires into another's typed input — the "nodes feed nodes" substrate.
- Build after typed sockets + wire-checking (#926 Phase B/C) so geometry-param
  overrides are type-enforced, not guessed. Pairs with `spline-generic-source.md`
  (a spline is a typed point-source) and typed-ports (composite types).
- Then inheritance sugar (B) is optional: a "profile library" of default sections +
  a part that inherits a base part's params and overrides its `section`.

## Related
- `docs/plans/typed-expression-outputs.md` (the spine), `docs/plans/spline-generic-source.md`
  (#26 wire-into-spline, SHIPPED), typed-ports (port-type registry + composite types).
- Motivating case: `s_tube` hollow curved sweep + the cap-degeneracy investigation
  (`[[r_sweep_normals_and_twist]]`) — a shared wired path is one lever there.
