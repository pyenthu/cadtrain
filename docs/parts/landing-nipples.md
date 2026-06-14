# Landing / Seating Nipples — Domain Reference

> Transformative technical reference written for cadtrain. Facts (definitions,
> nipple taxonomy, profile features) are drawn from public completion-equipment
> references; all prose here is original.
>
> Source attribution: drillingmanual.com, "Landing Nipple in Well Completion"
> — <https://www.drillingmanual.com/landing-nipple-in-well-completion/>
> (consulted for the factual taxonomy only; no text reproduced).

## What a landing / seating nipple is

A landing nipple (also called a seating nipple) is a short, heavy-wall tubular
sub spliced into the production tubing string. Externally it is just a coupling
with a box on one end and a pin on the other so it threads inline with the rest
of the tubing. Internally it is **precision-machined** to a known bore profile
that gives wireline- and slickline-run tools a defined place to *lock* and
*seal*.

Its job in a completion string:

- **Locate + lock.** An internal groove (or set of grooves) gives the keys of a
  lock mandrel a positive mechanical catch so a device run on wireline can be
  anchored at a known depth.
- **Seal.** A smooth bore section below the lock groove lets the device's seal
  stack pack off against the nipple ID, isolating pressure above from below.
- **Host a function.** Once a mandrel is locked and sealed, the nipple becomes a
  seat for whatever the mandrel carries: a plug (isolation / pressure test), a
  blanking device, a check / standing valve, a choke or flow bean (flow
  regulation), a bottomhole pressure/temperature gauge, or an emergency
  storm-choke style closure.

Nipples are placed at planned points in the string — commonly near the bottom of
the completion, above a packer, and at intervals where future intervention is
anticipated.

## Selective vs. non-selective (no-go) nipples

The taxonomy splits on **how a tool knows which nipple it has reached** when
several are run in one string.

### Selective nipples

A selective nipple has a lock profile but **no diameter restriction** — a tool
can pass through it. Selectivity is achieved by the running tool, not by a size
step, so you can install many *same-bore* nipples in one string and address each
one individually. Common mechanisms:

- **Profile-position selectivity** — a small family of distinct internal key
  profiles (typically 5–7) that must be run in sequence.
- **Setting-tool selectivity** — an effectively unlimited count of identical
  nipples, picked out by the configuration of the running mandrel.
- **Pre-spaced / mechanical selectivity** — a bounded set (about six) of
  identical nipples selected by pre-set spacing on the running string.

### Non-selective (no-go) nipples

A no-go nipple adds a **diameter restriction** — a shoulder whose ID is smaller
than the OD of the matching mandrel's no-go ring. The mandrel physically *cannot
pass*; it lands when it bottoms out on that shoulder. To stack several no-go
nipples in one string, the bores are stepped **progressively smaller with
depth**, so each tool stops at its own nipple and nothing falls past it.

The restriction can sit at either end of the profile:

- **Top no-go** — the restriction is *above* the lock groove and seal bore. The
  tool's no-go shoulder catches at the top of the nipple. (Baker Model "F".)
- **Bottom no-go** — the restriction is at the *bottom* of the nipple, below the
  seal bore. The tool passes the groove and seal section and lands on the lower
  shoulder. (Baker Model "R".)

## Internal profile features (the geometry that becomes our vocabulary)

These are the machined steps in the nipple ID. Each is a feature of the bore
half-section — an ID step, groove, or constant-diameter run — and each maps
cleanly to an (r, z) modification of a tube.

- **Lock profile / locking recess** — one or more internal grooves cut into the
  ID, bounded by up- and down-facing shoulders. The keys of a lock mandrel snap
  outward into this recess to anchor the device. Geometrically: a short local
  *increase* in bore radius (a notch in the wall) with a defined width and
  shoulder geometry.
- **No-go shoulder** — a step that *reduces* the ID over a short axial run,
  creating a restriction smaller than the matching tool's no-go ring. The tool
  bottoms on this shoulder. Geometrically: a single inward radial step (a
  reduced-r section) at the top or bottom of the profile.
- **Seal bore / polished bore** — a smooth, honed, constant-ID section where the
  device's seal stack packs off. It must be a clean cylinder with no steps over
  its length. Geometrically: a constant-r run of the bore, typically just below
  the lock groove.
- **Box / pin threads** — the threaded connections that splice the nipple inline
  (box on one end, pin on the other). **In cadtrain we do not render real
  threads yet** — these are represented as plain stepped OD/ID cylinders
  (smooth bore + a diameter step where the make-up shoulder would sit).
- **Shoulder (generic)** — any ID or OD step in the half-section. Two senses by
  the direction the step faces along the (Z-down) axis:
  - **up-facing shoulder** — supports load from below (e.g. a no-go that a tool
    lands *down* onto).
  - **down-facing shoulder** — supports load from above.
  Every one of the features above is built from shoulders plus constant-r runs.

## The three Baker BFC models in the figure

The shared figure shows the Baker non-selective ("no-go") nipple family. The
three items differ purely in geometry:

| Item | What it is | Distinguishing geometry |
|---|---|---|
| **BFC Model "F" Non-Ported Seating Nipple** | Top no-go seating nipple | Lock groove + seal bore with the **no-go restriction above** the profile — the tool catches at the top. "Non-ported" = solid wall, no side ports. |
| **BFC Model "R" Bottom-NoGo Non-Ported Seating Nipple** | Bottom no-go seating nipple | Same lock groove + **honed seal bore**, but the **no-go restriction is at the bottom** — the tool passes the profile and lands on the lower shoulder. |
| **BFC Flow Coupling** | Plain heavy-wall flow sub | **No internal profile at all** — just a thick-wall tube. Placed adjacent to a nipple to absorb the turbulence/erosion ("fluid hammer") that occurs where flow accelerates past a restriction. Geometrically a constant-ID, thick-OD pipe. |

So F and R are the same kit of features (lock groove + seal bore + a no-go
shoulder) with the no-go at opposite ends; the Flow Coupling is the *absence* of
the profile — pure tube.

## How this maps to cadtrain

Every one of these parts is a **revolve of a closed (r, z) half-section** — i.e.
an `r_revolve` (`stdstale/r_revolve`, still resolvable) of a polygon, exactly
like `g_collar`. Z-down convention applies: **top of the part = lower z**, and
`+z` runs down-hole.

The half-section is walked as a closed loop:

1. start at the OD wall and run **down** the outside (constant large r),
2. across the **base** (bottom face, inward in r),
3. back **up the ID bore** — and this is where the features live: the bore is
   *not* a straight cylinder but a sequence of r-steps:
   - constant-r runs (plain bore, **seal bore**),
   - a short outward notch (**lock groove / locking recess**),
   - a short inward step (**no-go shoulder**) at the top (Model F) or bottom
     (Model R),
4. close across the **top** face back to the OD start vertex.

```
   bore(stepped ID)        OD
        │                  │ r = od/2
  top ──┤ no-go (Model F)  │   ← inward ID step near top
        │                  │
        │═ lock groove ═   │   ← short OUTWARD notch (keys engage)
        │                  │
        │  seal bore       │   ← constant-r honed run
        │                  │
  base ─┴──────────────────┘   ← bottom face
        ↑ axis (r = 0)         (Model R: no-go step sits here, at base)
```

Because the features are **ID modifications of a base tube**, these parts are a
natural fit for the **`boolean_modify`** rule kind (see
`proposed-vocab-entries.json` / the `mule_shoe` exemplar): a base body (the
revolved tube) plus an ordered list of modifiers. Two ways to realize a feature:

- **Inline in the polygon** — add the step vertices directly into the (r, z)
  half-section before revolving (preferred for monotonic ID steps like a no-go
  shoulder or a seal-bore step).
- **As a CSG modifier** — revolve a clean tube, then `subtract` a thin revolved
  ring to cut the **lock groove**, or `subtract` a counterbore to form a
  restriction. This keeps the base tube reusable and the feature list explicit.

The **Flow Coupling** needs no profile at all — it is just `tube` (or a stepped
`tube` for the upset OD), with no modifiers.

## Feature taxonomy (one-line summary)

- **shoulder** — an ID or OD step in the half-section; up-facing (loads from
  below) or down-facing.
- **no-go shoulder** — an *inward* ID step that stops an oversized tool;
  no_go_top (above the profile) or no_go_bottom (below the seal bore).
- **lock profile / locking recess** — an *outward* groove in the bore that lock
  keys engage.
- **seal bore / polished bore** — a constant-ID honed run where seals pack off.
- **seating nipple** — whole part: tube + lock groove + seal bore + a no-go
  (Model F top / Model R bottom).
- **flow coupling** — whole part: a plain heavy-wall tube, no internal profile.

## References

- Source taxonomy: <https://www.drillingmanual.com/landing-nipple-in-well-completion/>
- Vocabulary proposal: [`landing-nipples-vocab-proposal.md`](landing-nipples-vocab-proposal.md)
- Geometry pattern / revolve exemplar: [`g_collar`](g_collar.md)
- `boolean_modify` rule kind + body/modifiers pattern:
  [`proposed-vocab-entries.json`](proposed-vocab-entries.json) (`mule_shoe`)
