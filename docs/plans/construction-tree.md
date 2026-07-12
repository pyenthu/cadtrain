# Construction Tree — architecture plan (2026-05-23)

> Status: PLANNING. A unified CAD construction tree (scene graph) for cadtrain
> composites: leaves (primitives/sub-assemblies), CSG op nodes, transform nodes
> (incl. **warp-along-spline**), nested assemblies — one recursively-evaluated
> tree. Headline: **warp the whole composed solid along a spline at the END.**

## Two composition substrates today (pick the foundation)
- **Model A — source.ts expression (LIVE prod path).** `const L=…; const h1=mv(r_cylinder(…),[…]); return L.subtract(h1).subtract(h2);` parsed by `recognizeComposite` (`recognize-composite.ts:124`), edited by text-splice at recognized offsets, built by `buildPrimitiveGeom` (`primitive-loader.ts:61`) via `new Function`. The `return` chain is ALREADY a (linear) tree; richer nesting is "unrecognized opaque code".
- **Model B — recipe.json (parallel store, only `/primitives/recipe-test`).** `PartRecipe` = `instances[]` + FLAT `composition[]` folded through `GeomAcc` (`part-recipe.ts:432`). Right shape (declarative JSON, interpreter, arg-expr language, no esbuild) but `composition[]` is flat — can't express `A − (B ∪ C)` or "warp the whole result".

**Verdict:** extend Model B with a recursive **`tree`** field that supersedes the flat `composition[]`; keep source.ts for LEAF primitives; composites migrate to the tree-recipe.

## Tree node model (post-order eval → one Manifold)
```
leaf      { kind:'leaf', id, call, args }            // primitive OR composite id (assembly)
csg       { kind:'csg', op:union|subtract|intersect, children[] }   // subtract = c0 − union(c1..)
transform { kind:'transform', op:translate|rotate|warpSpline, args, child }
group     { kind:'group', name, children[] }         // named assembly (≡ union)
```
`evalTree`: leaf→resolveDep(call).build(args); csg→fold children via `GeomAcc`; transform→ translate=`.translate`, rotate=`.rotate`, **warpSpline=`warpManifoldAlongSpline(child)`**; group=named union. Reuses `evalExpr`/`resolveArg`/`GeomAcc` wholesale — no new interpreter. **warpSpline at the ROOT = "warp at the end"** (its child is the whole composed tree → `.warp` runs on the fully-built solid).

## warp-as-transform (the load-bearing new capability)
**The warp-along-spline.md "do NOT `.warp` a pre-built solid" ruling was for building a swept LEAF from a cross-section** (can't vary profile, hits the `scaleTop`+extrude collapse). **Warping an ALREADY-COMPOSED solid is the opposite case — `Manifold.warp(callback)` is exactly right, and the scaleTop bug does NOT apply (no extrude here).** Precedent ships: `primitives/archive/profile_extrude_v6/source.ts:64-78` does `m.refine(n)` then `m.warp(p=>{…})` (callback mutates a Vec3 tuple in place).

`warpManifoldAlongSpline(m, path, opts)` (NEW `src/lib/graph/warp-spline.ts`): reuse the Catmull-Rom densify + arc-length table + planar `frameN` from `warp_along_spline/source.ts:45-91`; measure z-extent via `m.boundingBox()`; **subdivide-before-warp** so flat walls bend as arcs not chords (port `warp.ts:subdivideAlongZ` to operate on a Manifold mesh as `ensureZDensity`, capped at MAX_VERTS — cheaper than global n² `.refine`); then `m.warp(p => { s=((p[2]-z0)/zLen)*S; {pos,tan}=sampleAt(s); N=frameN(tan); p=[pos[0]+p[0]*N[0], pos[1]+p[1], pos[2]+p[0]*N[2]]; })`. It's the inverse of the sweep: remap each existing vertex's (x=radial, z=axial) onto the spline frame. `finalizeManifold` then does cutaway + normals on the warped solid (correct in mesh/GLB/cutaway/SVG — unlike the temporary client warp SHADER in `warp.ts`, which this supersedes).

## Assemblies = nesting (free at the loader level)
A composite-inside-composite is a LeafNode whose `call` is another composite id; `loadPrimitiveGeomById` already recurses meta.uses (cycle-guarded). GroupNode = explicit assembly affordance (collapse/name/promote a subtree to its own saved id).

## Visual tree editor UI (`ConstructionTree.svelte`)
Parts tab → indented node rows: leaf rows = today's per-arg cards + ✎ profile; op rows = glyph (∪ ∩ − ↔ ⟳ 〰) + args. Drag/reparent = JSON tree mutation → re-preview (the payoff of the JSON substrate, no source splicing). Generalize the existing `+ transform` palette to add warpSpline + a "Warp at end" toggle (ProfileEditor `presetSet:'revolve'` for the path). Per-arg cards + delete-part land INSIDE leaf rows unchanged (orthogonal).

## Phasing
- **Slice 0 (smallest, highest-value — ships warp-at-end on the CURRENT model):** `warp-spline.ts` helper + `ensureZDensity`; inject `warpSpline` into the sandbox (`primitive-sandbox.ts`); add a "Warp at end" toggle in PrimitiveView that splices `warpSpline(<comp>, <path>, {stations})` over `compStart..compEnd` (mirror of the Load `.add(X)` splice) + a ProfileEditor for the path. No tree refactor, no format change.
- **P1** recursive `tree` in PartRecipe + `evalTree` (csg/transform/group/leaf), zod-validated; `recipe-preview` builds it. (Supersedes overnight CSG-tree Phase 3.)
- **P2** wire `warpManifoldAlongSpline` into `evalTree` transform case → warp-at-end as a first-class node.
- **P3** the tree editor UI (drag/reparent).
- **P4** assemblies (composite-id leaves + GroupNode promote) + migration script (recognizeComposite → tree recipe.json).

## Supersedes / absorbs
standalone `warp_along_spline` primitive (stays as a swept-LEAF; SHARES the frame math via `warp-spline.ts`) · the flat composition chain · per-instance transforms (become TransformNodes) · overnight CSG-tree Phase 3 · the temporary `warp.ts` shader demo.

## Risks
Real refactor (P1-4 move composites source.ts→JSON + migration) — Slice 0 sidesteps it. Self-intersection on tight bends (clamp bend radius ≥ max planar extent). Subdivision cost vs smoothness (targeted ensureZDensity, fewer for preview). Cross-instance `expr` refs need a deterministic leaf-eval order in a tree (decide before P1). Register `warpSpline` in `createPrimitiveResolveDep` (STRICT_RECIPE_CALLS). Warp assumes the solid is built around Z (Z-down convention).

### Critical files
`part-recipe.ts` (tree + evalTree + warpSpline operator) · `warp_along_spline/source.ts` (frame math to factor into `warp-spline.ts`) · `warp.ts` (subdivideAlongZ → ensureZDensity; remove shader) · `primitive-sandbox.ts` (Slice-0 warpSpline helper) · `PrimitiveView.svelte` (tree editor + warp-at-end toggle) · `primitive-recipe.ts` (nested-composite resolve) · `recognize-composite.ts` (compStart/compEnd splice for Slice 0).
