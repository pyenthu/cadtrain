<!-- research-group: Wells -->
# Automatically detecting & building the cement annulus in a well schematic (CAD/CSG)

## Headline

Cement is **not a geometric primitive** — it is a **derived annular void that gets
filled**. The effective way to build it in a CSG pipeline is to treat every
casing/liner string and every open-hole section as a boundary at a known radius over a
known depth interval, then, for each cemented string, find the **next boundary radially
outward that overlaps it in depth** (either the open-hole wall = bit size, or the inner
wall = ID of the casing it laps into), and emit the cement solid as
**`outerBoundary − innerCasing`, clipped axially to `[Top-Of-Cement, shoe]`**.

Because the outer boundary can change with depth (open hole below the previous shoe,
then the previous casing's ID up in the lap zone), the robust implementation **segments
the cemented interval at every tubular/hole breakpoint** and builds one concentric
annulus per segment, unioned. This matches how the well-integrity domain reasons about
**annuli (A/B/C…) and Top-Of-Cement (TOC)** under NORSOK D-010's Well Barrier Schematic
model, and how commercial well-schematic tools auto-derive TOC and annular fluids from
the casing/hole program.

## The CSG formulation

A well is a set of nested concentric tubulars run into a set of drilled hole sections.
Each element is described by a radius and a depth span:

- **Casing / liner / tubing string** `S`: outer radius `OD/2`, inner radius `ID/2`, over
  measured-depth `[top_S, shoe_S]`.
- **Open-hole section** `H`: wall radius `bitSize/2` (the borehole wall as cut by the
  bit), over `[top_H, bot_H]`.

The **cement for string `S`** occupies the annular space *outside* `S` up to the first
solid boundary encountered going radially outward, over the depth interval that was
actually cemented, `[TOC_S, shoe_S]` (TOC = the shallowest point of set cement).
Geometrically:

```
cement_S  ≈  ( outerBoundarySolid  −  casingSolid_S )   ∩   slab[TOC_S , shoe_S]
```

where `casingSolid_S` is the solid cylinder of radius `OD_S/2` and `outerBoundarySolid`
is whatever bounds the annulus on the outside at each depth — the open-hole rock face
(`bitSize/2`) below the previous casing shoe, or the **inner wall (`ID/2`) of the
next-larger casing** where `S` overlaps it (the liner lap / cased-hole annulus). This is
the standard annular-volume geometry `V = (π/4)(D_outer² − D_inner²)·L`, with `D_outer`
= hole or outer-casing ID and `D_inner` = casing OD; an open-hole section and a cased
section over the same string must be computed as **separate** annular profiles.

Cement is therefore a **relationship between two other parts**, not an authored
`{od, id}` part. Its OD is *not* a property of the cement — it is inherited from the
outer boundary, and it can vary with depth. Modeling it as a fixed tube loses this;
deriving it via CSG keeps it correct when the casing program changes.

## Domain grounding

**NORSOK D-010 — Well Barrier Schematic (WBS) & Well Barrier Elements (WBE).** NORSOK
D-010 ("Well integrity in drilling and well operations", the Norwegian petroleum
standard) formalizes the **well barrier envelope**: the physical system preventing
unintended flow from a formation to another formation or the environment, built from a
**primary** envelope (elements in direct contact with well pressure) and a redundant
**secondary** envelope. Barriers are drawn on a **Well Barrier Schematic**, a static
illustration marking every primary and secondary WBE, colour-coded: **primary elements
blue, secondary red**. **Casing/annular cement is itself a WBE** listed in both
envelopes across the well lifecycle; its failure is a leak path along or across the
annulus. NORSOK provides a library of standardized WBEs each with **Element Acceptance
Criteria (EAC)** — annular cement has its own acceptance table, and each WBE carries
verification requirements (a commonly-cited figure: a cement barrier ≈ 50 m verified by
displacement calculation or ≈ 30 m verified by bond logs — see the verification flag
below).

*Design implication:* a `bw_cement` element should carry a **role tag**
(primary / secondary / none) so it can be coloured blue/red like a real WBS, and it is
defined by an *interval* (shoe → TOC) with a verification status, not just a shape.

**Annulus A/B/C naming (radial-outward numbering).** The industry names annuli
sequentially from the inside out: the **"A" annulus** is the void between the production
tubing and the innermost (production) casing; **"B"** and **"C"** are the voids between
successive outer casing strings. This is precisely a **radial nesting order** — the same
ordering the detection algorithm must reconstruct. Each annulus is fluid-filled or
cement-filled (or split at the TOC). **Top-Of-Cement (TOC)** is the shallowest point of
set cement in an annulus; whether the TOC sits above or below the previous casing shoe
determines whether trapped fluid can exist above the cement.

**SLB / commercial well-integrity & schematic tooling.** SLB's well-integrity services
reason explicitly about **A- and B-annuli** and diagnose **sustained casing pressure
(SCP)** as a barrier breach, evaluating cement-to-casing bond (CBL / ultrasonic) to
confirm zonal isolation. On the schematic-authoring side, tools already auto-derive the
annulus/cement picture from the tubular program (StrinGnosis reports its schematic
"actively updates as the wellbore is defined", showing derived TOC, cross-over depth and
each annulus's fluid; WellPlan Pro, wellVizion, WellSchematic.com are peers). The
dedicated NORSOK WBS authoring tool is **Wellbarrier's Illustration Tool** (element
library + blue/red convention). The interchange data model behind these is **WITSML**,
whose `wbGeometry`, `tubular`, and `cementJob`/`cementJobDesign` objects carry casing
OD/ID, hole size, and cement placement so tools can compute annular volume.

*Takeaway:* inputs are `(OD, ID, top, bottom)` tubulars + hole sizes + a cement interval;
the annulus, its A/B/C identity, and its fill are **derived**, not authored; TOC is the
axial clip; the output should be classifiable into a barrier envelope.

## Detection algorithm (recommended)

Work in **measured depth** (axial) and **radius** (radial), kept in separate unit
systems. Inputs per the cadtrain WSON: `ch[] = {od, id, top, bot}` (inches / metres) and
`oh[] = {bitSize, top, bot}`, plus a per-string cement spec `{toc, …}` (or a list of
intervals for stage cementing). "Covers `d`" means `top ≤ d ≤ bot`.

```
# ---------- 0. Normalize ----------
boundaries = []                       # radial boundaries, each with a depth span
for each casing/liner/tubing S in ch:
    boundaries += { kind:'casingOuter', r: S.od/2, span:[S.top, S.shoe],  ref:S }
    boundaries += { kind:'casingInner', r: S.id/2, span:[S.top, S.shoe],  ref:S }
for each hole H in oh:
    boundaries += { kind:'holeWall',   r: H.bitSize/2, span:[H.top, H.bot], ref:H }
# shoe_S = S.bot (bottom of the string)

# ---------- 1. For each cemented string, find its outer boundary vs depth ----------
def cement_solids_for(S):
    cemInterval = [ S.toc , S.shoe ]           # axial clip = [TOC, shoe]
    if S.toc is None or S.toc >= S.shoe:        # uncemented / bad data
        return []                               # do NOT fabricate a TOC

    # Collect every depth breakpoint inside the cemented interval so that,
    # between consecutive breakpoints, the outer boundary is constant.
    cuts = sorted(unique( [S.toc, S.shoe] +
                          [b.span endpoints for b in boundaries] clipped to cemInterval ))

    segments = []
    for [d0, d1] in consecutive_pairs(cuts):
        dm = midpoint(d0, d1)
        # candidate outer radii = boundaries strictly OUTSIDE the casing OD,
        # present at this depth. For a casing we go out to its ID (the void
        # inside it); for a hole we go out to its wall.
        cands = [ b.r for b in boundaries
                  if b.span covers dm
                  and b.r > S.od/2
                  and b.kind in {'holeWall','casingInner'} ]
        if cands is empty:            # no boundary outside -> open annulus; skip + warn
            warn("no outer boundary for", S.id, "at", dm); continue
        rOuter = min(cands)           # NEAREST boundary radially outward
        if rOuter - S.od/2 < eps:     # zero/negative gap -> degenerate; skip + warn
            warn("degenerate annulus", S.id, "at", dm); continue
        segments.append({ top:d0, bot:d1, rOuter:rOuter, rInner:S.od/2,
                          against: which_ref_won(rOuter, dm) })   # openhole vs casingX

    return merge_adjacent_equal_radius(segments)   # collapse same-rOuter runs
```

**Emit as CSG.** For each segment build one concentric annulus and union them:

```
cement_S = UNION over seg in cement_solids_for(S) of
             annulus(od = 2*seg.rOuter, id = 2*seg.rInner,
                     top = seg.top, bot = seg.bot)
```

Equivalently, in the pure "feed the outer part(s) to the inner and subtract" form —
preferred when the outer boundary is irregular (washout caliper, non-round, multiple
outer parts):

```
outerSolid  = UNION of the winning outer parts, clipped to slab[TOC, shoe]
cement_S    = outerSolid  −  casingSolid(S)
            # then optionally − (any inner strings that pass through, e.g. a
            #   smaller casing run later inside this annulus) if they post-date cement
```

Both are correct; the per-segment annulus form is cheaper and exact for the common
concentric case, the subtract form is the general fallback.

**Annulus identity (A/B/C).** After sorting strings by radius, the annulus outside
string *k* (counting production tubing as the innermost) is annulus letter `A + k`,
which lets you label/colour the cement per the domain convention.

**Ordering guarantees.** Sorting all boundaries by radius once (`O(n log n)`) and taking
`min(cands)` per depth-segment reproduces the radial A/B/C nesting; segmenting on the
union of all `top`/`bot` breakpoints captures the **open-hole-below-shoe →
cased-hole-in-lap** transition automatically, without special-casing liners.

## Edge cases & pitfalls

- **TOC above the previous casing shoe.** The cement crosses from open hole (outer = bit
  size) into the lap zone (outer = previous casing ID). The segment loop handles this;
  do not assume a single OD. Above the previous shoe, trapped annular fluid can exist —
  that's the fluid-vs-cement split at TOC.
- **Liner (doesn't reach surface).** `top_S` = liner-hanger depth *inside* the previous
  casing; the outer boundary in the overlap is the **previous casing ID**, below the
  previous shoe it's the bit size. Liners are typically cemented back to the hanger, so
  `TOC ≈ liner top`. The **liner lap** (hanger-to-previous-shoe overlap) is a
  barrier-critical seal.
- **Uncemented / no TOC given.** Emit nothing (or a fluid annulus), and warn. **Never
  fabricate a TOC** — an invented cement top is a false barrier claim. If a policy
  default is required, make it explicit and configurable.
- **Stage cementing (DV tool).** Cement can occupy two disjoint intervals with a gap;
  the cement spec must be a **list** of intervals, each run through the same loop.
- **Multiple candidate outer strings at one depth.** `min(cands)` over radii `> OD_S/2`
  always picks the nearest boundary out; nesting order falls out of the sort.
- **Degenerate / negative gap.** If `OD_S ≥` nearest outer radius (string larger than
  its hole, or bad data), skip and warn — do not emit an inverted solid.
- **Washout / real hole > bit size.** `bitSize` is nominal; real annuli are larger and
  irregular. Use caliper if available, else nominal and note it. **Eccentricity /
  standoff ignored** — real casing sits off-centre; the schematic models a **concentric**
  annulus. Acceptable for a schematic; state it.
- **Micro-annulus, channels, partial cement, poor bond.** These are cement *quality*,
  not geometry — they belong to the barrier/EAC/CBL layer, modelled as attributes on
  `bw_cement`, not as holes in the solid.
- **Cement inside the pipe (shoe track, float collar, balanced plug).** That is cement
  in the casing *ID*, a different element — don't let the annulus detector claim it.
- **Z sign.** Depths increase downward; TOC is shallower than the shoe. In cadtrain's
  Z-down convention this is a monotone map (deeper → larger z), so `[TOC, shoe]` is a
  well-formed slab — but verify the sign against `src/lib/graph/CLAUDE.md` before
  emitting.

## How it maps to cadtrain

WSON already carries `ch[] = {od, id, top, bot}` and `oh[] = {bitSize, top, bot}`
(radial = inches, axial = metres), and every well element bakes as a `bw_*` part
([[wells_graph_bake_units_and_parts]]). Cement becomes a **derived `bw_cement` annulus**,
not a fixed-`od/id` part:

- Add a per-string **cement spec** to the WSON (`toc`, optional multi-interval,
  verification/role tag) — the only new authored input.
- In the WSON→graph step, run the detection loop above over `ch[]`+`oh[]`; for each
  cemented string emit `bw_cement` as either **per-segment annuli unioned** (cheap, exact
  concentric) or the general **`outer.subtract(inner)` clipped to `[TOC, shoe]`** —
  reusing the existing revolve/annulus primitive and the graph's `.subtract`/`mv`
  composition, so cement fuses/subtracts exactly like the other `bw_*` parts.
- Tag each `bw_cement` with its **annulus letter (A/B/C…)** from the radial sort and a
  **barrier role** (primary/secondary/none) so the viewer can colour it blue/red per
  NORSOK WBS convention.
- Keep it derived: when the casing program changes, cement geometry re-derives for free —
  no hand-edited OD/ID to drift.

## References

- NORSOK D-010, *Well integrity in drilling and well operations* — primary standard
  (paywalled at standard.no); context via the SINTEF CCS well-design report citing it.
- JPT / SPE — *Using Schematics for Managing Well Barriers* (WBS, envelope principle, IT
  tooling): https://jpt.spe.org/using-schematics-managing-well-barriers
- IPT Global — *Well Barrier Envelopes: Key Concepts and Importance* (primary/secondary,
  cement as WBE): https://iptglobal.com/articles/well-barrier-envelopes-key-concepts-and-importance/
- IPT Global — *Monitoring Well Integrity Using Annular Casing Pressure* (A/B/C annulus
  definitions, SCP): https://iptglobal.com/blog/monitoring-well-integrity-using-annular-casing-pressure/
- SLB — *Well Integrity Evaluation* (A/B annuli, SCP root-cause, cement bond):
  https://www.slb.com/products-and-services/innovating-in-oil-and-gas/reservoir-characterization/reservoir-testing/well-integrity-evaluation
- Wellbarrier — *Illustration Tool* brochure (NORSOK WBS authoring, element library,
  colour coding).
- Expro — *Annulus B intervention / C annulus communication* case study (A/B/C in
  practice): https://www.expro.com/case-studies/expros-annulus-b-intervention-corrects-casing-communication-with-c-annulus
- StrinGnosis — *Tools* (schematic auto-updates: TOC, cross-over depth, annular fluid):
  https://docs.stringnosis.com/en/menus/tools
- Drilling Formulas — *Calculate Annular Capacity* (annular-volume geometry, per-profile):
  https://www.drillingformulas.com/calculate-annular-capacity/
- Energy Excursions — *Cementing the Well* (open-hole vs cased-hole annular volume):
  https://energyexcursions.com/courses/in-pursuit-of-the-safe-well/lessons/cement-and-casing/topic/cementing-the-well/
- GOSCO — *Liner Hanger Systems* (liner lap = hanger-to-shoe overlap):
  https://goscoenergy.com/liner-hanger-systems/
- WITSML — *Cement Job Data Object* (Energistics):
  http://docs.energistics.opengroup.org/WITSML/WITSML_TOPICS/WITSML-000-134-0-C-sv2000.html

**Verification flags.** (1) The NORSOK cement-length figures (~50 m by displacement calc
/ ~30 m by bond log) and the "~50-element WBE library" come from secondary summaries and
public excerpts, not the paywalled standard itself — confirm against a licensed copy
before quoting as authoritative. (2) A few sources (the Springer barrier-principles
chapter, the ScienceDirect casing-annulus page, the StrinGnosis tools page) could not be
fetched directly (login gate / 403 / expired cert); their claims here rest on
search-result snippets and corroborating sources. (3) All geometry/algorithm content is
a synthesis grounded in the annular-volume and annulus-nesting sources above — not a
published algorithm from a single citable spec.
