# Wells CAD-parts API browser + WBG Wizard (TODO #42d)

> **Status: STUB (2026-07-10).** This file was referenced by `TODO.md` #42d but did
> not exist; created to capture the already-agreed scope so the reference resolves.
> Not yet a full execution plan — no step ordering, no acceptance tests. Flesh out
> before building. This is UI work (needs a browser); it is **not** overnight-safe.

Model on the **[AIDE WBG Wizard](https://aide.mwdstd.com/)**. Reference screenshot
`docs/plans/refs/aide-wbg-wizard.png` is named in TODO #42d but is **not on disk
yet** — capture it before implementation.

## Goal
Let a user design a well's bore geometry and drop cadtrain `/primitives` parts into
it from the `/wells` canvas, so the well body + completion string are authored from
real volume parts (feeds the wells element registry, `src/lib/wells/registry.ts`,
and A2 in `docs/plans/wells-build-architecture.md`).

## Pieces

### WBG Wizard panel
Section-by-section well-bore-geometry design. Each section is an alternating **hole
size row + casing row**. Standard API sizes render as clickable pills in a
horizontal grid (6½ → 26 in); the selected size highlights teal. Curved arrows
between rows show the clearance relationship between drill bit and casing OD.

### CAD-parts picker
Browse/search `/primitives` from the `/wells` canvas; drop a part into a section
with params auto-populated from the part's `meta.params`. A dynamic GUI matching the
graph-editor param card gives live scrub/edit. Wells-specific additions per placed
part: **depth anchor**, **string assignment**, **orientation**.

### Left-nav sections
`WBG Wizard` · `Tubulars` · `Rig` · `Trajectory` (Auto Design + Cost Model) ·
`Summary` (Well Cost · WBG · Report). A section list with **+ Add section** and a
section-count badge.

### Auto Design
Trajectory auto-generation given a surface location + target TVD / inclination.

### Toolbar
`Reset` · `Apply` · `Save locally` · `New` · `Import` · `Export` · `Feedback`.

## Constraints / open questions
- **WSON vs graph source-of-truth** must be decided first (same blocker noted in
  `overnight-2026-07-10.md` for #42f popovers). Round-tripping both directions is the
  trap.
- Placing parts must NOT write the shared prod volume on its own — the picker reads
  `/primitives`; persistence of an authored well is a separate decision.
- The catalog data already exists (`registry.ts`, ~45 completion keys + `bw_*`
  structural); what is missing is the picker UI and a search/filter endpoint (SVTC
  has `filtercomps` → `queryCatalog`; cadtrain has neither yet).

## Related
- `docs/plans/wells-interface.md` — the /wells interface plan.
- `docs/plans/wells-build-architecture.md` — WellBakePool + element libraries (A2).
- `docs/plans/wells-ewells-gaps.md` — the ewells feature gaps this closes.
- `src/lib/wells/registry.ts` — the `tool_comp`→`g_*` + section-kind→`bw_*` maps.
