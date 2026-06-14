# Landing-Nipple Vocabulary — PROPOSAL (do not auto-apply)

> Proposed new terms for the cadtrain compositional vocabulary, derived from the
> landing-nipple domain reference ([`landing-nipples.md`](landing-nipples.md)).
>
> **This is a proposal only.** It does **not** edit `vocabulary.json`,
> `proposed-vocab-entries.json`, or any volume part. Review here first; promote
> via `scripts/promote-to-vocab.ts` if accepted.

## Two layers of terms

The landing-nipple domain introduces terms at **two different altitudes**, and
they should not be conflated:

1. **FEATURE concepts** (bore modifiers) — `shoulder`, `no_go`, `seal_bore`,
   `lock_profile`. These are *not* standalone parts; they are reusable (r, z)
   edits applied to a base tube. In rule terms they are **modifiers** in a
   `boolean_modify` body, or named segments of an inline polygon. They retrieve
   by *purpose* ("lock", "seal off", "stop a tool"), not by silhouette.
2. **WHOLE-PART types** — `seating_nipple` (with Model F / R variants) and
   `flow_coupling`. These are complete revolved parts that *compose* the feature
   concepts onto a tube.

All of these realize as an **`r_revolve`** of a closed half-section (Z-down: top
= lower z), exactly like `g_collar`. Feature concepts that cut into a wall (the
lock groove) use a `subtract` modifier in the `boolean_modify` rule kind; pure
ID steps (no-go, seal-bore step) are inline polygon vertices.

---

## FEATURE concepts (bore modifiers)

### `shoulder`

- **Definition:** A single radial step in the half-section — an ID or OD
  transition between two constant-radius runs.
- **Geometric realization:** Two (r, z) vertices at the same z with different r
  (the step face) joined to the adjacent constant-r runs. *Up-facing* = the step
  face supports load from below (smaller-r region is down-hole); *down-facing* =
  supports load from above. With Z-down, an up-facing shoulder has the larger-r
  run at higher z.
- **Synonyms:** step, ledge, land, ID step, OD step, shoulder face, stop.
- **Engine / exemplar:** `r_revolve`; primitive building block, no standalone
  exemplar (it is the atom the others are built from — cf. `shaft` in
  `vocabulary.json`).
- **Layer:** FEATURE (the atom).

### `no_go`

- **Definition:** An *inward* ID step (a `shoulder`) sized smaller than a
  matching tool's no-go ring, so the tool cannot pass and lands on it.
- **Geometric realization:** A reduced-r run in the bore (one inward step in +
  one outward step out, or a single terminal step). Two variants by axial
  position:
  - **`no_go_top`** — restriction *above* the lock/seal profile (low z). Baker
    Model "F". Tool catches at the top.
  - **`no_go_bottom`** — restriction *below* the seal bore (high z). Baker Model
    "R". Tool passes the profile and lands at the base.
- **Synonyms:** no-go, no-go shoulder, no-go ring seat, landing shoulder,
  restriction, stop shoulder, no-go nipple seat.
- **Engine / exemplar:** `r_revolve`; specializes `shoulder`. New exemplar to
  build alongside `seating_nipple`.
- **Layer:** FEATURE (a specialized `shoulder`).

### `seal_bore`

- **Definition:** A smooth, honed, constant-ID run of the bore where a device's
  seal stack packs off.
- **Geometric realization:** A constant-r segment of the ID (no steps over its
  length), typically just below the lock groove. Parameters: bore radius +
  axial length.
- **Synonyms:** seal bore, polished bore, polished bore receptacle, PBR, honed
  bore, packoff bore, sealing surface.
- **Engine / exemplar:** `r_revolve`; a constant-r polygon segment. Realized as
  part of `seating_nipple`, not standalone.
- **Layer:** FEATURE (a constant-r bore run).

### `lock_profile`

- **Definition:** An internal groove (or set of grooves) in the bore, bounded by
  up- and down-facing shoulders, that lock-mandrel keys engage to anchor a
  device.
- **Geometric realization:** A short *outward* notch in the wall (local
  *increase* in bore r over a defined width), i.e. a groove cut into the ID.
  Best realized as a `subtract` modifier — revolve a clean tube, then subtract a
  thin revolved ring at the groove z — rather than an inline vertex run.
  Parameters: groove depth, width, axial position, optional groove count.
- **Synonyms:** lock profile, locking recess, lock groove, key profile, locking
  mandrel profile, lock recess, nipple profile, key seat.
- **Engine / exemplar:** `r_revolve` + `subtract` (the `boolean_modify` pattern,
  cf. `mule_shoe` in `proposed-vocab-entries.json`).
- **Layer:** FEATURE (a groove modifier).

---

## WHOLE-PART types

### `seating_nipple`

- **Definition:** A heavy-wall tubing sub whose precision bore carries a
  `lock_profile` + `seal_bore` + a `no_go`, giving wireline tools a place to
  lock and seal in the completion string.
- **Geometric realization:** `r_revolve` of a closed tube half-section, with the
  bore (r, z) walk carrying, top→base: a `no_go` step, the `lock_profile`
  groove, and the `seal_bore` constant-r run. Lock groove cut via `subtract`;
  no-go + seal bore as inline polygon steps.
- **Variants:**
  - **`seating_nipple_f`** (Baker Model "F") — `no_go_top`: restriction above
    the profile.
  - **`seating_nipple_r`** (Baker Model "R") — `no_go_bottom`: restriction below
    the seal bore.
- **Synonyms:** seating nipple, landing nipple, no-go nipple, lock nipple,
  profile nipple, wireline nipple, tubing nipple, BFC nipple.
- **Engine / exemplar:** `r_revolve` (`boolean_modify` rule kind — body tube +
  `subtract` lock groove). New exemplar `g_seating_nipple` (or `_f` / `_r`) to
  author. Closest existing geometry pattern: `g_collar` (stepped revolved tube).
- **Layer:** WHOLE-PART.

### `flow_coupling`

- **Definition:** A plain, heavy-wall tubular sub placed next to a nipple to
  absorb the turbulence and erosion where flow accelerates past a restriction.
  No internal profile.
- **Geometric realization:** `r_revolve` of a simple tube half-section
  (constant ID, thick OD); optionally a stepped OD for an external upset. No
  modifiers.
- **Synonyms:** flow coupling, flow nipple, erosion sub, blast joint (related),
  heavy-wall coupling, BFC flow coupling.
- **Engine / exemplar:** `r_revolve`; extends `tube` (see `vocabulary.json`
  `tube`). Essentially `tube` with a heavier wall — could be `kind: 'rev'` /
  `extends: 'tube'` with no modifiers.
- **Layer:** WHOLE-PART.

---

## Suggested rule kinds at a glance

| Term | Layer | Rule kind | Engine | Closest existing |
|---|---|---|---|---|
| `shoulder` | feature | primitive (atom) | `r_revolve` | `shaft` |
| `no_go` (`_top`/`_bottom`) | feature | `boolean_modify` step | `r_revolve` | `shoulder` |
| `seal_bore` | feature | inline polygon run | `r_revolve` | `tube` |
| `lock_profile` | feature | `boolean_modify` (`subtract` ring) | `r_revolve` | `mule_shoe` pattern |
| `seating_nipple` (`_f`/`_r`) | whole-part | `boolean_modify` | `r_revolve` | `g_collar` |
| `flow_coupling` | whole-part | `rev` / `extends: tube` | `r_revolve` | `tube` |

## References

- Domain reference: [`landing-nipples.md`](landing-nipples.md)
- `boolean_modify` exemplar: [`proposed-vocab-entries.json`](proposed-vocab-entries.json) (`mule_shoe`)
- Promotion path: `scripts/promote-to-vocab.ts` (do not hand-edit `vocabulary.json`)
- Source taxonomy: <https://www.drillingmanual.com/landing-nipple-in-well-completion/>
