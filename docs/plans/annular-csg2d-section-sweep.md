# Annular / CSG-2D cross-section sweep — one welded mesh, no 3D boolean

**Status:** planning (2026-07-02). User direction: sweep a cross-section that can be
an **annulus (with holes)** or a **CSG-composed 2D profile** → **ONE welded solid, no
3D boolean**. "Annular cross section sweep… option of a CSG 2D xSection… planar spline
XY for xSection… an xSection sketch card that allows multiple sketches to be CSG then
used for sweeping… but it needs to be a single mesh." Hunch (correct): also **faster**.

## Why (vs subtracting two 3D sweeps — the `s_tube` approach)
- `s_tube` = `sweep(outer).subtract(sweep(inner))` → a **3D mesh boolean** on two
  coaxial, tilted-cap tubes → degenerate/sliver caps (**defect 2**, Manifold v3 mesh
  boolean limit — [[r_sweep_normals_and_twist]]) + slower (the boolean is the cost).
- Instead do the CSG in **2D on the section**, then sweep the composed region **once** →
  one clean welded mesh. 2D `CrossSection` booleans are **robust + cheap**; the cap is a
  **with-holes triangulation**, not a coincident-face 3D boolean. Engine-agnostic
  (stays in fast Manifold; no BREP needed for this class).

## The pieces
### A. Section = a 2D REGION, not just one loop
- Represent the xSection as a Manifold **`CrossSection`** (2D): outer boundary + inner
  holes. CrossSection natively supports `.add/.subtract/.intersect` (2D booleans) + holes.
  Helpers already exist in `src/lib/cad/csg-2d.ts` (`cs`, `extrude_csg`, `ext`, `resample`).
- A closed **planar (XY) spline** → one boundary loop; multiple loops/shapes → CSG'd
  into a single CrossSection.

### B. `r_sweep` accepts a CrossSection / multi-loop section
- Extend `section` to accept a CrossSection (or `{outer, holes[]}`) instead of only a
  single point list. In `sweepAlongPath` (`manifold-mesh.ts`):
  - **Walls:** sweep EACH boundary loop (outer + each hole) along the path via
    `loftStations` — inner-loop walls wound inward so the solid is the material
    BETWEEN outer and holes.
  - **Caps:** triangulate the 2D CrossSection **with holes** → the annular cap fill;
    frame + place it at BOTH ends (reuse the RMF start/end frames). This replaces
    `fanCap3D`'s simple-polygon ear-clip for the region case. Get the triangulation
    from Manifold (`CrossSection` → polygons → holes-aware triangulate; or a tiny
    `.extrude()` and take a cap face).
  - **Weld** walls + both caps → ONE Manifold (`weldAndBuild`). No 3D boolean, no
    coincident caps → no defect-2 slivers.

### C. xSection sketch card (compose multiple 2D sketches → CSG → section)
- A card where the user adds N 2D sketches/profiles (circle, rect, slot, planar spline)
  each with a CSG op (union / subtract / intersect) → composes ONE CrossSection via 2D
  booleans. Output = a typed **section** value wired into `r_sweep`'s `section` slot
  (rides typed-ports + [[todo_parametric_geometry_slots]] — the section is a typed,
  wireable producer).
- e.g. `outer circle − inner circle − keyway slot` = a keyed annulus → sweep → a keyed
  hollow tube as a **single mesh**.

## How (implementation sketch)
1. CrossSection section support in `sweepAlongPath`: accept boundary loops (outer +
   holes) + a cap triangulation.
2. Cap fill: `crossSection.toPolygons()` → holes-aware triangulation → cap tris; place
   at both ends via the start/end frames.
3. Walls: `loftStations` per loop; inner loops reversed winding.
4. xSection sketch card (UI): builds the CrossSection via 2D CSG → feeds `section`.
5. `weldAndBuild(walls + caps)` → single welded Manifold.

## Speed
Expected FASTER than subtract-two-sweeps: skips the 3D boolean (the expensive + fragile
step); 2D CSG is cheap; one weld. **Verify via bench** vs the subtract path (record ms).

## Sequencing / relationship
- The durable, engine-agnostic fix for **defect 2** (curved hollow caps) — no BREP, no
  TrueForm needed for this class.
- Rides typed-ports + [[todo_parametric_geometry_slots]] (section = a typed wireable
  value) + `spline-generic-source.md` (a planar spline is a 2D point-source).
- Phase 1: annulus (outer+inner loop) sweep + with-holes cap. Phase 2: the xSection
  sketch card (multi-sketch 2D CSG). Phase 3: wire it as a section producer.
