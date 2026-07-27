<!-- research-group: Geometry kernels -->

# Is there an "SVG for 3D"? — analytic/vector surface + volume formats

**Status:** RESEARCH LEAD (open) · **Date:** 2026-07-27 · **Asked by:** user

## The question

SVG is a **declarative, analytic, resolution-independent** 2D format: a circle is
`<circle>` (exact), a curve is a Bézier (`<path d="C …">`) evaluated to whatever
resolution the viewer needs — never a bag of line segments baked at one zoom
level. **Is there an equivalent for 3D surfaces and volumes** — a format that
stores the *exact* geometry (analytic curves/surfaces / implicit volumes), not a
pre-tessellated triangle soup frozen at one LOD?

## Short answer

Yes — but "SVG for 3D" splits into **two axes** that SVG happens to unify in 2D:
(1) **declarative scene description** and (2) **analytic, resolution-independent
geometry**. Different 3D formats own different corners:

| SVG property | Surfaces (boundary) | Volumes (solid/field) |
|---|---|---|
| Analytic / exact | **NURBS**, **BREP** (STEP, IGES) | **SDF / implicit functions**, **CSG trees** |
| Resolution-independent | NURBS re-tessellate to any LOD | SDF sampled at any resolution |
| Declarative / XML-ish, web-native | **X3D / X3DOM** (mesh scene), **USD** | (none web-native yet) |
| Transmission "JPEG of 3D" | **glTF** — but tessellated, NOT analytic | **OpenVDB / NanoVDB** — voxel, NOT vector |

**The closest single answer for "vector-exact 3D geometry" is BREP/STEP (analytic
NURBS surfaces).** The closest answer for "declarative web 3D document" is X3D
(and, at a higher level, USD). glTF is the popular interchange format but is
*raster-like* (baked triangles), so it is the 3D analog of PNG, not SVG.

## The candidates, mapped to what SVG actually is

**Analytic surfaces (the true "vector" essence — resolution-independent):**
- **NURBS** (Non-Uniform Rational B-Splines) — the 3D analog of the Bézier path.
  A surface is control points + knots + weights; evaluate to any density. This is
  the atomic "vector" surface primitive.
- **BREP** (Boundary Representation) — a solid as trimmed analytic faces + edges +
  vertices with topology. Interchange formats: **STEP (ISO 10303)**, **IGES**.
  This is exactly what OCCT emits — and what a CAD system means by "exact."

**Implicit / procedural (the "vector" essence for volumes):**
- **SDF (Signed Distance Fields) / implicit functions** — a volume as `f(x,y,z)=0`.
  Resolution-independent (sample at any grid), booleans are `min/max`, sharp at any
  zoom. Shader-native (raymarching). Tools: MagicaCSG, Inigo Quilez's work, libfive.
- **CSG trees** — procedural boolean composition of primitives. Declarative +
  parametric. **This is literally what cadtrain's composition graph already is.**

**Declarative scene documents (SVG's *markup* side):**
- **X3D / X3DOM** — XML, web-native, the ISO successor to VRML; the most literal
  "SVG for 3D" as a *document*, but its geometry is mesh (IndexedFaceSet), not
  analytic.
- **USD (Universal Scene Description)** — Pixar's composable, layered scene format;
  more the "HTML/PDF of 3D" (scene graph, references, variants) than "SVG."
- **3MF** — XML 3D-manufacturing format (mesh + limited analytic + materials).

**Transmission (raster-analogs, NOT vector):**
- **glTF** — tessellated mesh, the de-facto web transmission format ("JPEG of 3D").
- **OpenVDB / NanoVDB** — sparse voxel volumes; efficient but sampled, not analytic.

## Why this matters for cadtrain (the interesting part)

cadtrain **already holds most of an "SVG for 3D" stack** — the pieces just aren't
framed that way:
- **BREP/OCCT engine** (`src/lib/engines/brep/`) = exact NURBS surfaces — the
  analytic, resolution-independent geometry (the "vector" essence).
- **Composition graph** (`src/lib/graph/composition-graph*`) = a declarative CSG
  tree — the *procedural* analog of SVG markup, resolution-independent by nature.
- **`brep-to-svg.ts`** (SHIPPED, `brep-svg-boundary-projection.md`) already
  projects the BREP's *true* boundary to real 2D `<path>` — i.e. it renders the
  analytic 3D → analytic 2D SVG. That is the round-trip proof the pieces line up.

So the open research is not "does an SVG-for-3D exist" (it does) but **"should
cadtrain expose one — a declarative, resolution-independent 3D interchange
artifact — and which target?"** Three concrete directions:
1. **STEP/BREP export** — the industry-standard analytic interchange (OCCT can
   already write STEP). The literal "vector 3D file."
2. **SDF/implicit backend** — a functional volume representation (shader-raymarched,
   boolean-exact) as a 4th kernel alongside Manifold/TF/BREP. Ties to
   `todo_webgpu_slm` / raymarch-in-browser. Volumes-as-vector.
3. **X3D/USD scene emit** — a declarative *document* wrapper around the parts (the
   markup axis), for web-embeddable, self-describing assemblies.

## Next steps (if promoted)
- Spike OCCT **STEP write** from an existing BREP part (probably ~1 endpoint).
- Evaluate an **SDF/CSG** primitive path (libfive / manual raymarch) for the
  volumetric-vector angle — cross-links `todo_occt_brep_backend`,
  `todo_kernel_csg_speed`, `todo_webgpu_slm`.
- Cross-reference `brep-svg-boundary-projection.md` (2D vector out) and
  `brep-csg-spike.md`.
