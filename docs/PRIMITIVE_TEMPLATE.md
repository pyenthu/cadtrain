# Per-primitive `.md` template

Each runes primitive at `src/lib/cad/parts/<id>.ts` SHOULD have a
sibling `<id>.md` next to it. The AI-Refine endpoint loads this file as
the slow-evolving spec for the primitive (sent alongside every refinement
prompt), and any future Claude session reads it before touching the geom
so the same primitive doesn't regress to first-principles each visit.

Strong example: `src/lib/cad/parts/conn_box.md`. Sparse example
that needs filling: `src/lib/cad/parts/enhanced_box.md`.

## Template — copy this into `<id>.md` and fill in

```markdown
# <id> — <Real-World Name>

## What this represents

One paragraph: which real-world component the primitive models, where
in the wellbore / drillstring / completion it sits, what its defining
geometric features are. Reference the relevant KB row(s) if known
(e.g. `static/kb/api/tubing-hanger.json` row `THS-7x2.5625-2k`).

## Coordinate convention

Confirm Z-down (top = lower z, bottom = higher z). Spell out where z=0
sits relative to the real component (e.g. "z=0 is the top of the
upset flange; the body extends down to z=length"). Any future edit
must preserve this.

## Composition

Bullet list of the sub-primitives or helpers used, with one-line
explanations. Note any non-obvious tricks (e.g. `+0.01" overlap at
CSG seams to avoid hair-thin gaps`, `blocker radius × 50 for
near-straight cuts`).

## Parameters

Table of all `meta.params` with: name, default, range, what it
controls. Group by physical sub-component if the primitive has more
than ~6 params (e.g. "Top flange" / "Body" / "Bottom flange").

For lookup params (`choices`), list the option names and what each
geometrically means.

## Derived params

If the primitive has `meta.derived`: table of derived names, formula,
why-derived. Rule: when a value is a pure function of other params,
prefer `derived` over a literal in `geom`.

## Vocabulary

If you renamed a param from a generic name (e.g. `gap` → `split`,
`cut_region` → `groove_band`) to match real-world terminology, record
it here so the next session doesn't drift back to the generic.

## Validation rules

What `meta.validate` checks. Each rule: condition → user-facing
error message → why-it-matters. Validation surfaces in the Inspector
as inline errors mid-drag, not as exceptions.

## Geometry contract for AI refinement

Anything the AI refine pass MUST NOT break:
- `meta` and `geom` must remain separate named exports.
- `meta.id` must stay `<id>`.
- Helper imports stay scoped (manifold-helpers + sibling runes only).
- Geom returns a single Manifold — composed via `.add()` / `.subtract()`
  / `.intersect()` with `mv()` / `rot()` for positioning.

## Planned features (out of scope today)

Signposts for the AI / future sessions: features known to be valuable
but deferred. Write these as one-liners with enough context that a
future session can pick them up cold.

## References

- `docs/assemblies/<recipe>.md` — any assembly recipe that uses this
  primitive as a part.
- `static/kb/<path>.json` — KB rows feeding the param defaults.
- External: vendor catalog page, API spec, etc. — URL + accessed date.
```

## When to write or update this file

- **At creation** — a new primitive ships with at least the *What this
  represents* + *Parameters* sections. Other sections can be sparse.
- **On terminology fix** — if a param is renamed (gap → split,
  cut_region → groove_band), add a *Vocabulary* note so the rename
  sticks across sessions.
- **On geometry change** — if the composition pattern changes
  (added a counterbore, switched from CSG-subtract to CSG-add),
  update *Composition*.
- **When a related assembly recipe lands** in `docs/assemblies/` —
  add a back-link under *References*.

## File-on-disk note

The AI-Refine endpoint reads `<id>.md` via the runes API
(`/api/components/list` surfaces `instructions: <md content>`). Editing the
.md and saving is enough — no rebuild needed.
