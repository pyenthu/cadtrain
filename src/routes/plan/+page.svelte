<script lang="ts">
  /**
   * Gantt-style view of cadtrain's roadmap. Mirrors the pattern in
   * sister-repo SVTC at src/routes/plan/+page.svelte but stripped of
   * Tailwind — cadtrain uses scoped Svelte styles and the same red-on-
   * dark navbar as the rest of the app.
   *
   * Edit `tasks` below to add/move/close items. Display codes (A.1, B.3, …)
   * are computed at render from each task's position within bundle A/B/C.
   * The numeric `id` field is the canonical key into ./details.ts and never changes.
   */

  import { details } from './details';

  // Axis epoch — the project's real start (May 2026). The chart shows
  // plain "W+n weeks since May 2026" numbers, NOT calendar dates:
  // `start` values are sequence positions that advance ~1-2 per working
  // session, so any date mapping drifts from reality within weeks.
  const START = new Date('2026-05-09T00:00:00');

  type Status = 'open' | 'done' | 'active' | 'deferred' | 'on-demand';
  type Priority = 'high' | 'medium' | 'low' | 'large';

  interface Bundle {
    id: string;
    name: string;
    tint: string;
    desc: string;
  }

  interface Task {
    id: number;
    bundle: string;
    lane: number;
    start: number;
    weeks: number;
    priority: Priority;
    status: Status;
    title: string;
  }

  const BUNDLES: Bundle[] = [
    { id: 'A', name: '/components', tint: '#dc2626', desc: 'Legacy prompt-based CAD engine: ManifoldCAD primitives, /components viewer, recognition (pHash + CLIP), wells/WSON, vendor catalog ingest, meta/UX, and archived platform work.' },
    { id: 'B', name: '/primitives', tint: '#84cc16', desc: 'Visual parametric CAD editor: graph editor, sidebar, sketcher, generative authoring, client-side bake, and session roadmap items.' },
    { id: 'C', name: 'Identity & sharing', tint: '#10b981', desc: 'Per-user Google OAuth, private parts on the volume, and sharing/customize-directory work.' },
    { id: 'D', name: 'SDK', tint: '#6366f1', desc: 'External developer SDK: the versioned /api/v1 facade, per-app bearer-key auth, app-scoped author/execute namespaces, and the LLM manifest + MCP server + /sdk/llms.txt tool schemas.' },
    { id: 'E', name: '/wells', tint: '#0ea5e9', desc: '3D-first well schematic (SVTC WsonApp-modeled). SHIPPED: sidebar + tabs + workspace header/cache + wired 3D + view/layer controls + depth ruler + labella labels + the 2D SVG track view as the DEFAULT (the ewells-speed match; 3D lazy-mounts). NEXT: (A) 3D-fast build architecture — WellBakePool + clip-plane cutaway + parametric element libraries (docs/plans/wells-build-architecture.md); (B) editing — mutation+undo, CompletionsEditor, SurveyEditor, inspector-on-select; polish + left toolbar rail. Gaps: docs/plans/wells-ewells-gaps.md.' },
    { id: 984, bundle: 'B', lane: 1, start: 1.30, weeks: 0.04, priority: 'high',   status: 'done',   title: "BUG · degenerate triangle in the SVG render of a WARPED part. Visible in the SVG tab on a warped/deviated part; suspected leftover state shared with the TF and Manifold paths (both write into the same projection/emit chain). Reproduce on a warped bw_* element and on w1_oh_warp. Decide first WHERE it is born: (a) the bake itself emits a zero-area tri (then it is the same class as the r_sweep defect-2 cap fan and must be prevented at build time, never removed post-hoc — post-hoc removal is PROVEN not to work, it cannot fix genus); (b) svg-emit projects two distinct 3D verts onto one 2D point (a projection degeneracy — legal geometry, illegal 2D triangle); or (c) the SVG tab still bakes through a stale path. NOTE the SVG tab is the LAST browser-facing caller of /api/primitives/preview (RightPane), so it may simply be rendering different geometry than the MF_CLIENT canvas. Diagnose by DECODING triangles (count near-zero-area, group by rounded position), never by eyeballing. Files: svg-emit.ts, PrimitiveSvgView.svelte, render-helpers.ts." },
    { id: 985, bundle: 'B', lane: 1, start: 1.30, weeks: 0.10, priority: 'medium', status: 'open',   title: "SVG smooth shading — reuse the 3D shading logic, do NOT fork a second renderer. The SVG tab renders flat facet chords while the 3D canvas shades smoothly from Manifold's calculateNormals(3,60) crease-aware normals. Want the SAME logic (crease angle, vertex normals, the flatShading gate in PrimitiveDualCanvas) driving the SVG fill/stroke, so the two surfaces agree. HARD CONSTRAINT (user, 2026-07-10): avoid a brand-new duplication of the SVG — extend PrimitiveSvgView + svg-emit, do not add a parallel path. RESEARCH FIRST, verify against current docs before designing: can a WebGL/WebGPU offscreen render feed the SVG (render to texture, extract silhouette + crease outlines), or is a pure-CPU projection with per-vertex normal interpolation and gradient fills the right shape? Prior art to read: three-svg-renderer (archived here as archive/src/lib/cad/exporter.ts, with its FillPass + VisibleChainPass), and the existing docs/plans/svg-projection-perf.md Phase 1. Folds together with the parked SVG-projection-smoothness item and #63 (SVG pattern textures)." },
    { id: 986, bundle: 'E', lane: 4, start: 1.30, weeks: 0.03, priority: 'medium', status: 'open',   title: "w_multi_string_dev — drop the linear sections, keep only the multi-part warp. The dev part currently carries 9 straight r_revolve elements (prd/int/srf x CSG/CEM/OH) plus the warp, and 18 nodes of sketch+revolve cards. It exists to exercise the MULTI-PART WARP (one spline warping N concurrent bodies), so the straight sections are noise: they inflate the graph, the PROPERTIES table (see #982), and the bake. Rebuild it as the warp case alone. Cross-check against #38 P2 (list<record> table editor), which would collapse the same part from 18 cards to 1 list param + 1 producer — decide whether to trim now or wait for P2 and do it once." },
    { id: 987, bundle: 'B', lane: 1, start: 1.30, weeks: 0.03, priority: 'high',   status: 'active',   title: "BUG · the 3D MF_CLIENT bake badge reports 'fresh - 0 ms' for a bake that takes ~6 s. REGRESSION introduced with the no-server-bake change (this session): runBake() used to POST /api/primitives/preview and the badge summed that response's server-side _t phase breakdown. runBake now calls validateGraphBake() -> /api/primitives/compile, which returns only _t.fetch_total, and the badge explicitly EXCLUDES fetch_total from its sum — so it sums nothing and prints 0 ms. Meanwhile the real work (compile + worker bake + transfer) happens in PrimitiveDualCanvas, which already measures it precisely and only console.logs it under __bakeTimings. FIX: surface the canvas's timings to the badge — bake-worker-core already attaches {build, mesh, cutaway, finalize, serialize} to its result and bake-client passes it through. Add an onBakeTimings callback on PrimitiveDualCanvas -> RightPane, and show compile + bake separately (they are different costs with different caches). Also make 'cached' mean the BAKE cache (IndexedDB scriptHash hit), not the compile cache, or the badge lies twice." },
  ];

  const tasks: Task[] = [
    { id: 996, bundle: 'B', lane: 1, start: 1.66, weeks: 0.03, priority: 'medium', status: 'done', title: "DONE (f3ea1b7) · Parts-table per-row MATERIAL trigger redesigned as a black/white hemisphere 'material sphere' button (was an ambiguous dashed square). Opens the same RowMaterialPopover; a row with an override tints its white half to that colour. Wire-to-material-node left as a TODO(material-wire) since it touches shared graph/emit plumbing. Files: shared/graph-editor/PartsTableCard.svelte." },
    { id: 997, bundle: 'E', lane: 4, start: 1.66, weeks: 0.02, priority: 'low', status: 'done', title: "DONE (9c58ca6) · /wells dark-tooltip readability. The element-rail (.wer-tip) + toolbar (.tb-tip) tooltips draw on a dark rgba(27,30,38,.94) background but coloured text with var(--w-text) = #1b1e26 (near-black) ever since /wells went to a white page — dark-on-dark, unreadable. Now fixed light #eef0f5 (matching the readable .wtr-tip) + a subtle light border." },
    { id: 998, bundle: 'E', lane: 4, start: 1.68, weeks: 0.05, priority: 'medium', status: 'done', title: "DONE (21d0336) · /wells — ONE in-tab diagram rail (WellDiagramRail) replacing the two separate vertical toolbars (the far-left placement WellToolbar + the in-stage layer WellElementRail). Two top-level icons, each a flyout submenu: 👁 Visibility toggles each schematic layer (mutates the shared WellViewSettings.layers) · ✎ Components = the add/edit placement tools (scaffold). One submenu open at a time; click-outside/Escape closes. Old two rails left unmounted." },
    { id: 999, bundle: 'B', lane: 1, start: 1.68, weeks: 0.06, priority: 'high', status: 'done', title: "DONE (55cc8d3) · Warp perpendicularity — its OWN build-time radial (xDiaScale) + depth (yScale) dials in the ⚙ options. Root cause: the scene view-scale [xScale,xScale,zScale] on the whole render GROUP was applied AFTER the warp, shearing bent cross-sections in every engine. Fix: bake the exaggeration PRE-FRAME (local section scaled before it lands on the spline frame) so a scaled section stays perpendicular to the tangent. TF now honours xDiaScale/yScale (graph-to-tf warp instr + execute.ts warpMeshJS calls); Manifold + emit + hydrate already did; BREP warpSpline takes opts. setWarpXDiaScale/setWarpYScale mutators (sparse: 1 → drop field, byte-identical). Proven by warp-scale-perp.test (xDiaScale=6 keeps section ⊥ + scales radius 6×). Memory warp_radial_scale_before_warp." },
    { id: 1000, bundle: 'B', lane: 1, start: 1.70, weeks: 0.02, priority: 'low', status: 'done', title: "DONE (fd40eb0) · EmbedConfig.tabBar flag (EXPLICIT, not count-inferred) — hides the RightPane vertical tab-bar strip; the active tab's content fills the pane. /wells' clean 3D view sets tabBar:false so the lone redundant 'MF_CLIENT' tab is gone (the full engine tabs live in the ✎ edit-graph popover). Threaded resolveEmbedConfig → GraphEditorPane → RightPane; parsed from ?tabbar=0." },
    { id: 1001, bundle: 'E', lane: 4, start: 1.70, weeks: 0.04, priority: 'medium', status: 'done', title: "DONE (0ca3650) · /wells chrome reorg (save space). Removed the 46px editor top-offset → the embedded editor fills the stage; the old dark top strip is gone. 2D|3D toggle + display-settings gear (WellViewControls) float top-RIGHT now (was top-left), next to the editor scene gear. ✎ edit-graph moved OFF the top bar INTO the left WellDiagramRail (3D only). FOLLOW-UP: verify the top-right WellViewControls position doesn't overlap the SceneControls gear (needs a screenshot after :3333 restart)." },
    { id: 1002, bundle: 'B', lane: 1, start: 1.72, weeks: 0.10, priority: 'high', status: 'done', title: "DONE (f086b4d) · parts_stack node kind (#38e) — heterogeneous 'completion string' card: each row a DIFFERENT part, mated end-to-end via stack([...]) → one geometry. Emit/hydrate/mutate family + 13 tests." },
    { id: 1003, bundle: 'B', lane: 1, start: 1.74, weeks: 0.10, priority: 'high', status: 'done', title: "DONE (51745d8 + 08a8f7f) · parts_stack card UI — PartsStackCard (element picker + length inline; ⚙ popover for other params + material; ▲▼ reorder; confirm-delete) + 'completion string' container-menu item + per-row src picker. Verified: bw_hanger+bw_tubing mate end-to-end." },
    { id: 1006, bundle: 'B', lane: 1, start: 1.76, weeks: 0.10, priority: 'high', status: 'done', title: "DONE (760c7d9 + faa3bc9 + 7e3d7e3) · parts_stack refinements (#38e). PER-ROW DEPTH (top): a row places at an absolute depth via mv([0,0,top]) instead of mating — one card authors both a running string AND a completion (reproduces w2_well_completions: hanger+tubing at top=0, packer at 100). Emit: no anchored rows → one mated stack (byte-identical); any anchored → a list of separate bodies. INSERT-ABOVE ⊕ per row. Reorder ▲▼ + ⚙ moved to a LEFT tools column, 🗑 right. MATERIAL dropped from the ⚙ (an element's material comes from its own definition / editor). +6 tests." },
    { id: 1007, bundle: 'B', lane: 1, start: 1.78, weeks: 0.12, priority: 'high', status: 'done', title: "DONE (9e62a9a + 88e4c55) · GRADED WARP-AUTOSCALE (DTX) — an 'Auto depth' toggle magnifies a completion string's SHORT elements along its spline (stretch stack + spline together via s=dtx(z), total length preserved), the SVTC/wellnew graded-magnification pipeline fed from parts_stack element lengths (partsStackWarpNodes → meta.warpNodes; autoNodes grade). NORMALIZED to a fraction-of-total footprint (autoNodes footprintFrac + a strength slider, capped ratio) so proportions hold on any well scale (user: 'proportions look excellent, very stable'). Works VERTICAL too: a no-warp parts_stack applies the DTX as a post-bake straight vertical z-stretch. Confined to parts_stack (a hand-wired concentric well has no sequential spans). Proven on Manifold in Node. Knobs: BASE_FRAC 0.08, strength 0.4, maxRatio 6." },
    { id: 1008, bundle: 'B', lane: 1, start: 1.80, weeks: 0.06, priority: 'medium', status: 'done', title: "DONE (6f16cde + bef120a) · DEPTH RULER overlay — a view-only tick line at an adjustable distance + azimuth from the part axis, ticks at true-depth intervals with labels, z-positions run through the SAME DTX as the geometry so it tracks the autoscale (magnified segments spread their ticks, stay registered). SceneControls 'Ruler' section (on/dist/azim/step). Off by default. Pure ruler.ts helper + 17 tests. WARPED-RULER (bef120a): on a DEVIATED part the ruler now BENDS along the warp spline instead of staying straight — PrimitiveDualCanvas parses the emitted resampleSpline([[x,y,z],…]) cp from source → warpSpline prop → Scene builds a per-arc-length frame via splineFrameSampler + offsets each tick ⊥ the path with rulerTicksWarped (az 0=+B/front, 90=+N/side). Domain = the DTX preserved-endpoint span when Auto-depth on, else the spline arc-length (a bent well's world-Z bbox is not its depth). Vertical/survey-mode ⇒ warpSpline undefined ⇒ straight ruler unchanged. Parse verified vs w2_multi_part_warp source." },
    { id: 1004, bundle: 'B', lane: 1, start: 1.71, weeks: 0.06, priority: 'medium', status: 'done', title: "DONE (760bafa) · parts_table polish (#38d) — card-level master material (tableMaterial ● in the title row, base for every row), two-click delete-confirm, delete moved to the right wall by the output socket. +6 tests." },
    { id: 1005, bundle: 'B', lane: 1, start: 1.70, weeks: 0.05, priority: 'low', status: 'done', title: "DONE (7e0869d + 7511a1a) · material batch — compact row-material popover + downhole presets (sandstone/cement/mud/…); picking a material overrides the row colour (↳ matl flag); brighter default lighting (ambient 0.9, exposure 1.55); cement reworked." },
    { id: 988, bundle: 'B', lane: 1, start: 1.30, weeks: 0.20, priority: 'medium', status: 'open', title: "BREP-native warp — wire the proven MakePipeShell sweep into the real bake pipeline. The E4 spike (branch worktree-agent-a5dc3020, HELD) proved deviated parts sweep curved via BRepOffsetAPI_MakePipeShell: w_deviated_casing 2232 tris, volume == MF oracle exactly, the 180-deg cut riding along for free because bw_casing bakes its section INTO the profile (section-before-sweep); OCCT .cut() on the curved solid is WRONG (removes 67%, the z-wedge ignores the deviation). LEFT: land it off the spike in brep-occt.ts into the engine path, curvature-adaptive spine density (mirror BakeOptions.axialMaxZSpan), stretch:true, high-torsion RMF roll parity, and the render-time quarter-box cutaway on a warped solid. Depends on E2 (client compile→create). TODO E4." },
    { id: 989, bundle: 'B', lane: 1, start: 1.30, weeks: 0.12, priority: 'medium', status: 'open', title: "TF · add a native r_loft builder. g_barrel fails on TF ('not built natively — TrueForm has no native builder for: call:r_loft'). graph-to-tf lowers r_cuboid/r_revolve/r_weld_extrude/r_sweep but NOT r_loft, so every barrel/waist/flare/ogive/scurve part blanks on TF (native-only, no MF fallback). Add op:'loft' building the section stack from the SAME scaleAt(t) shape curve + twist BREP's r_loft uses (r_loft.ts is the source of truth), welded/lofted like the MF gridPatch; executor tfLoft in tf_examples/execute.ts. Verify HEADLESS: bbox/volume vs the MF oracle (a barrel is fat-in-MIDDLE, so a monotonic endFactor can't fake it — same pin as brep-occt.test.ts t_barrel). User req 2026-07-12." },
    { id: 992, bundle: 'B', lane: 1, start: 1.30, weeks: 0.10, priority: 'high', status: 'open', title: "graph↔shared layering — move src/lib/shared/graph-editor/ → src/lib/graph/editor/. Audit (docs/research/graph-shared-overlap.md): shared/graph-editor/ (~40 files) is CAD-editor glue importing $lib/graph/ 77x, violating shared/'s no-domain-import rule + forming a directory-level import cycle; the move erases 76 of 77 violations. THEN delete the PartAppearance dup (graph/composition-graph-types.ts:783 → import shared/viewer/part-appearance) and move shared/profiles/profile-presets.ts into graph/ (kills the 2nd cycle). WARN wide import churn + update src/routes/design/folder-tree.ts (hardcoded shared/ paths) in the SAME commit. Precedes/feeds #16. Mechanical git mv + rewrite; land INLINE (build-green != correct /design diagram). User req 2026-07-12." },
    { id: 990, bundle: 'B', lane: 1, start: 1.42, weeks: 0.20, priority: 'medium', status: 'open', title: "IDEA · a BREP_SVG tab — shade the SVG from BREP boundary SURFACES, not the mesh (user 2026-07-12). BREP is a boundary representation: exact faces + topology, so the face boundaries ARE the silhouette/crease outline and each face carries an exact analytic normal — a natural fit for a 'shaded path on surface' SVG (clean true-edge outlines + smooth per-region fills) rather than projecting a triangle soup. Complements #985 (that shades mesh facets). New right-pane tab, server-side (OCCT in Node, like the BREP tab). RESEARCH first: OCCT HLRBRep_Algo/HLRBRep_PolyAlgo (hidden-line removal → visible + hidden edges as 2D curves) for the outline; per-face normal → Lambert fill for shading. Cross-ref #985, docs/plans/svg-projection-perf.md, archived exporter.ts (VisibleChainPass)." },
    { id: 991, bundle: 'B', lane: 1, start: 1.62, weeks: 0.05, priority: 'low', status: 'open', title: "BREP display-mesh T-junction FLICKER — occasional, minor (user 2026-07-12: 'slight random flicker, not too bad'). OCCT tessellates each face independently → adjacent faces get mismatched edge samples → hairline z-fighting on shared edges (a known cosmetic BREP cost). NOT a self-intersection (the sweep_tube_demo throw is fixed, 666086d). LOW priority. Fix path: stitch/weld the OCCT triangulation across face boundaries (shared BRepMesh verts) or a small display-mesh vertex-dedup at emit; verify by DECODING coincident edge verts, not eyeballing." },
    { id: 993, bundle: 'B', lane: 1, start: 1.66, weeks: 0.05, priority: 'low', status: 'open', title: "BREP renderer — INTERPOLATE vertex normals for the material shading (user 2026-07-12). The BREP display mesh should shade smooth (per-vertex interpolated normals) for its material, not flat per-facet. E5 (39757ed) already computes crease-aware corner normals shared by TF+BREP (crease-normals.ts) — verify they actually reach the BREP material render (PrimitiveDualCanvas flatShading gate + the BREP mesh path) and interpolate across the OCCT triangulation so curved faces read smooth. Sibling of #991 (both are OCCT display-mesh quality). Cross-ref E5, crease-normals.ts." },
    { id: 994, bundle: 'B', lane: 1, start: 1.30, weeks: 0.05, priority: 'medium', status: 'done', title: "DONE (8537450) · Graph-editor layout moves no longer rebake — auto-bake now keys on a layout-independent bakeKey (emit body + appearance meta), not the source (which embeds node x/y). Verified: 0 /compile on a move + headless emit-layout-invariant test." },
    { id: 995, bundle: 'B', lane: 1, start: 1.35, weeks: 0.30, priority: 'medium', status: 'open', title: "Modularize src/lib/graph/ by ABSTRACTION into subfolders (user 2026-07-12). graph/ carries 39 loose top-level files — group by concern: composition/ (9: emit/hydrate/layout/bake/tree/graph-types) · sketch/ (3) · spline/ (3) · expr/ (3) · sweep/ · survey/ · wire/ · warp/ · profile/ · primitive/ (2: sandbox+loader) · port/ (2, typed-ports) · part/ (2) · csg/ — plus the existing nodes/ + stdlib/. Mechanical git mv + import rewrite in focused commits (mirror shared/ #16 + engines E1). WARN: update hardcoded paths (routes/design/folder-tree.ts) in the SAME commit; and the archive/ twin-dir sed hazard (memory bulk_path_rename_archive_twin_hazard). TESTS: ONE test folder for the whole module — src/lib/graph/tests/ (consolidate the current graph/nodes*/tests + graph/stdlib/tests INTO it; NOT a tests/ per abstraction subfolder). Each new subfolder gets a short CLAUDE.md. Payoff: navigability + faster scoped code search + per-subfolder docs. Verify build + bun run test green. Precedes/pairs #16." },
    { id: 512, bundle: 'A', lane: 0, start: 0.0, weeks: 0.12, priority: 'high',   status: 'todo',   title: 'AI refine Level 2: post-generation validation in the refine endpoint (imports allowlist · denylist scan · undefined-instance detection · syntax check · optional live-bake · retry-once-with-errors-fed-back). PARTIAL: validateRefinedSource() + retry-once loop already exist in refine/+server.ts, but only check meta-extract / meta.id-unchanged / fn-name==id. LEFT: imports allowlist, denylist scan, undefined-instance detection, live-bake.' },
    { id: 700, bundle: 'C', lane: 2, start: 0.0, weeks: 0.15, priority: 'high',   status: 'open',   title: 'OAuth identity port from SVTC: Google OAuth + signed-session → event.locals.userId via sequence() in hooks (existing AUTH_TOKEN/proxy/rate-limit unchanged). Plan ready: docs/plans/oauth-identity.md. Blocked on user-provisioned Google OAuth creds.' },
    { id: 513, bundle: 'A', lane: 0, start: 0.01, weeks: 0.12, priority: 'high',   status: 'todo',   title: 'AI refine Level 3: live-bake gate on the inspector Accept button — status pill ("✓ Builds" green / "✗ Bake failed: <msg>" red); Accept disabled on failure. Uses the existing /api/components/bake-preview endpoint, no backend changes' },
    { id: 514, bundle: 'A', lane: 0, start: 0.01, weeks: 0.12, priority: 'medium', status: 'todo',   title: 'AI refine Level 4: assembly-aware prompt — when refining a composition, glob docs/assemblies/README.md + matching <assembly>.md into the system prompt. Today nothing in src/ reads docs/assemblies/ so the AI re-invents known recipes every refine' },
    { id: 702, bundle: 'C', lane: 2, start: 0.02, weeks: 0.15, priority: 'high',   status: 'open',   title: 'Private per-user parts under components/<userId>/ (REQUIRES L.1): user-scoped resolvers + owner enforcement; close R2 (/api/volume path guard), R3 (private out of proxy), R4 (list-cache by userId), R5 (id-collision scoped).' },
    { id: 804, bundle: 'B', lane: 1, start: 0.06, weeks: 0.18, priority: 'medium', status: 'todo', title: 'Pro polish (own session each). Snapping + grid; dimensions / light geometric constraints (revisit JSketcher only if dimension-driven constraints become a real need); DXF export (Maker.js native — real CAD handoff); 2D-CSG via model.combine (folds in the old K.58 SVG-CSG idea); mirror/symmetry.' },
    { id: 901, bundle: 'D', lane: 3, start: 0.15, weeks: 0.15, priority: 'medium', status: 'open', title: 'V1.0 read-only API: /api/v1/* facade thin-wrapping the existing handlers (list parts / get part metadata+geometry / bake preview → mesh-JSON·GLB·SVG / query the RAG corpus). No geometry logic duplicated. Versioned resource model + structured errors. Lowest risk (reuses shipped endpoints).' },
    { id: 644, bundle: 'B', lane: 1, start: 0.16, weeks: 0.13, priority: 'medium', status: 'deferred',   title: 'D Phase 2 (DEFERRED): repeat_with_data(array, fn) for HETEROGENEOUS instances — BHA with mixed HWDP/drill pipe/stabilizers, per-iteration params from a data array. Sandbox = native data.map (no helper needed); recognizer extension to spot const items = data.map((d,i) => mv(<inst>(...d), [...])); return place(items). Build when a concrete varied use case lands.' },
    { id: 902, bundle: 'D', lane: 3, start: 0.17, weeks: 0.16, priority: 'high', status: 'open', title: 'V1.1 auth: per-app bearer-key registry (ctk_v1_ token, stored as sha256(bearer) hash + metadata at <volume>/apps/_tokens/<id>.json — Rule 15, never plaintext; 60s cache; scopes read⊂bake⊂author⊂admin; CADTRAIN_ADMIN_KEY bootstrap), gated via a new apiKeyHandle composed with sequence(). Orthogonal to the per-USER OAuth (bundle L) — both reuse one owner-scoped subtree resolver.' },
    { id: 903, bundle: 'D', lane: 3, start: 0.18, weeks: 0.18, priority: 'medium', status: 'open', title: 'V1.2 author/execute + per-app namespace: app-scoped writes under apps/<appId>/primitives/... resolved by the SAME primitive-paths.ts (parameterized root, kept out of VOLUME_PROXY_PATHS). Highest risk — the write surface + the R2–R4 holes from the customize-dir plan. IP protection: per-part meta.visibility:baked-only serves geometry+metadata but withholds source/graph (bridges to the WASM-conceal idea).' },
    { id: 904, bundle: 'D', lane: 3, start: 0.20, weeks: 0.16, priority: 'medium', status: 'open', title: 'V1.3 LLM manifest + MCP: /api/v1/manifest (evolve /api/manifest) + /sdk/llms.txt + tool-call JSON schemas per operation + an MCP server (adopt SVTC\'s) so an agent can discover + drive cadtrain. Worked examples (author from description → bake → fetch GLB/SVG). V1.4 (later): embeddable canvas (iframe-postMessage or published web-component).' },
    { id: 954, bundle: 'E', lane: 4, start: 0.0,  weeks: 0.06, priority: 'high',   status: 'open', title: 'W-E · Left vertical TOOLBAR rail — fill WellToolbar with real actions: new/open/save .wson, add completion/casing/perf, toggle 2D/3D, export (PNG/GLB/SVG), fit-view. The persistent icon rail on the left of the /wells workspace.' },
    { id: 951, bundle: 'E', lane: 4, start: 0.30, weeks: 0.12, priority: 'high',   status: 'open', title: 'W-B1 · Editing — mutation + undo layer (viewer→editor foundation, deep-dive #1, THE differentiator over ewells\' viewer-only schematic). One commit() choke point that mutates the open .wson (add/remove/edit strings·surveys·completions) + a per-workspace undo/redo history; SSR-safe, feeds the 3D re-bake + 2D re-render. Prereq for CompletionsEditor / SurveyEditor / inspector. Plan docs/plans/wells-ewells-gaps.md §B.' },
    { id: 957, bundle: 'E', lane: 4, start: 0.30, weeks: 0.15, priority: 'high',   status: 'open', title: 'W-H1 · 3D-fast build — WellBakePool. When 3D is opened, move the per-element Manifold build off the main thread into a POOL of N Web-Workers each owning its OWN Manifold instance (NOT the /primitives editor\'s single latest-wins worker — wells needs all elements built in parallel + cached, rendered progressively). Reuses the bake-worker/bake-client pipeline (client_side_execution). Kills the main-thread CSG jank that makes /wells slow vs ewells\' 2D SVG. Plan docs/plans/wells-build-architecture.md (P1–P3).' },
    { id: 958, bundle: 'E', lane: 4, start: 0.45, weeks: 0.10, priority: 'high',   status: 'open', title: 'W-H2 · 3D-fast — clip-plane cutaway (drop the boolean). The half-section cutaway is currently a per-element Manifold .cut() boolean that scales super-linearly (stack_cutaway_perf_root_cause). Replace with a GPU clip plane (THREE material clippingPlanes + stencil caps) so the cutaway is free at render time and does NOT re-trigger a CSG rebuild on azimuth/toggle. Plan docs/plans/wells-build-architecture.md.' },
    { id: 959, bundle: 'E', lane: 4, start: 0.55, weeks: 0.18, priority: 'medium', status: 'open', title: 'W-H3 · Parametric element libraries — the well elements (OH / casing / tubing / cement / perf) become PARAMETRIC LIBRARY parts the engine CALLS (procedural), and completions = the g_* jewelry via compile+worker; register g_* into the parametric registry with ParamSpec dials (feeds W-B4 inspector). Auto-scale/fit. Plan docs/plans/wells-build-architecture.md §A2 + wells-ewells-gaps.md §A2.' },
    { id: 960, bundle: 'E', lane: 4, start: 0.42, weeks: 0.12, priority: 'high',   status: 'open', title: 'W-B2 · CompletionsEditor — SVTC-style strings table editor (oh/ch/cement/tubing/completions rows: add/remove/reorder, edit OD/ID/top/bottom) writing through the W-B1 mutation layer, live 3D re-bake + 2D re-render.' },
    { id: 961, bundle: 'E', lane: 4, start: 0.54, weeks: 0.12, priority: 'high',   status: 'open', title: 'W-B3 · SurveyEditor — md/dev/az survey-station table (add/edit/delete stations) with live re-warp of the 3D deviation + 2D buildDirPath. Through the W-B1 mutation layer. SVTC SurveyEditor.' },
    { id: 962, bundle: 'E', lane: 4, start: 0.66, weeks: 0.10, priority: 'medium', status: 'open', title: 'W-B4 · Inspector-on-select — click a component in the 2D/3D schematic → inspector panel wired to the parametric registry (tool_comp → its ParamSpec dials); edits flow through the W-B1 mutation layer. Depends on W-H3 element registry.' },
    { id: 906, bundle: 'A', lane: 0, start: 0.36, weeks: 0.20, priority: 'medium', status: 'open', title: "Local web-llm backend (no data leaves org): web-llm (MLC) + XGrammar constrained decoding, Qwen2.5-1.5B in a Web Worker, default-OFF, gated by a bench (>=90% tool / >=85% args); local TF-IDF few-shot DB in IndexedDB. Reference Functionary's prompt format but do NOT deploy it (server-side vLLM, not WebGPU). Plan: docs/research/web-llm-functionary.md." },
    { id: 932, bundle: 'B', lane: 1, start: 0.89, weeks: 0.25, priority: 'medium', status: 'open', title: "Parametric geometry slots — spline/expr/profile as an OVERRIDABLE typed param (design 2026-07-02). A part exposes its internal geometry (path spline, section expr/profile) as a typed param with a DEFAULT; the caller overrides by passing/wiring a compatible value (e.g. s_tube wires one shared path into two sweep instances while keeping rad parametrized). Typed-param-with-default, NOT class inheritance. The PART-LEVEL generalization of wire-into-spline (#26). Plan docs/plans/parametric-geometry-slots.md." },
    { id: 940, bundle: 'B', lane: 1, start: 0.95, weeks: 0.30, priority: 'high', status: 'active', title: "GraphEditorPane modularization — Phase 4 continuation (the remaining shell reduction). SHIPPED 2026-07-07 (see the done view): the node-kind REGISTRY (Phases 0-3 — every node kind → a descriptor in src/lib/graph/nodes/, the emit/hydrate switches collapsed, golden-emit byte-gate), GraphEditorController step-1 (controller.svelte.ts trunk owns graph + history + leaves), and undo/redo (graph-history.svelte.ts). REMAINING: the FULL Phase 4 GraphEditorController extraction — migrate the rest of GEP's imperative state + actions onto the controller trunk toward the ~1,500-line composing shell (the 2026-06-25 honest target was ~2,500–3,000; this pushes past it). Done INLINE (subagents stall on GEP). Unblocks the deferred warp NODE + editor card (#936, items 1 & 5). Plan docs/plans/graph-editor-pane.md + modularize-round2.md. Prior: #665 (round 1), #907 (round 2, GEP 9455→5070)." },
    { id: 944, bundle: 'B', lane: 1, start: 1.02, weeks: 0.10, priority: 'medium', status: 'active', title: "Curvature-adaptive warp axial span (N5). DONE 2026-07-10 (5eb88f4 + 8b0f4d1): BakeOptions.axialMaxZSpan replaced the scale-blind WARP_AXIAL_MAX_ZSPAN=1.5 constant, and /api/primitives/preview now honours the survey-derived span that wellBakeSpec() computes — a 3000 m well was being densified at 1.5 m, ~2000x the Z-samples it needs. That alone took well 13 from 467,620 tris/11.4s to 132,288 tris/1.6s, and turned wells 05 (RangeError: Invalid string length) + 09 (WASM trap) from HTTP 500 into HTTP 200. LEFT: per-SEGMENT adaptivity. The J-well tangent section (535-1070 m, constant 38 deg) is straight and still gets rings — that is the remaining fat. Blocked on N6 (unit- and scale-aware sag budget): today the sag tolerance is 0.4%% of the largest RADIUS in inches while curvature R is in metres, and tessellation should be judged in the RENDERED, scaled frame, not raw model units." },
    { id: 946, bundle: 'B', lane: 1, start: 1.05, weeks: 0.20, priority: 'low', status: 'open', title: "TF_WASM tab — C++→WASM TrueForm builders for IP concealment. NOTE the honest framing: the WORKER (off-main-thread) is what makes TF fast, NOT the language — WASM here buys source concealment, not speed. Plan docs/plans/tf-wasm-tab.md." },
    { id: 947, bundle: 'B', lane: 1, start: 1.04, weeks: 0.10, priority: 'medium', status: 'done', title: "DONE (8d2636c) · Per-SUBPART material now survives one Call deeper — a part's own internal materials (a packer's blue seal + brown body) were COLLAPSED to a flat blob when nested in a larger assembly. Fix: __tagNest PRESERVES + namespaces the callee's named sub-part runs (partNestId, band-checked so leaves/anon CSG still collapse); part-colors composeNestedLut adds matching LUT entries so nested runs INHERIT the child's colour, or take the parent OVERRIDE when set — propagating the subtractive ROLE so a hollow element keeps skin=outer/bore=inner (fixed an outer/inner swap). BREP: __tagNest aliases __tag (MF-only). Verified: nested bake asserts both sub-part colours + override precedence; 155-test color/bake/parts suite green." },
    { id: 948, bundle: 'B', lane: 1, start: 1.02, weeks: 0.12, priority: 'medium', status: 'open', title: "Warp-trajectory originZ + #38 P2 param-editor tails (from the 2026-07-07 batch, #972; the parts_map NODE-CARD + pm_demo volume part already SHIPPED — see #973 in the done view). #36c: wire the warp originZ PLACEMENT option through to the warp node — the tangent-extension shipped and the option exists in warp-spline.ts, but no caller feeds it. #38 P2: the ParamsCard list<record> TABLE editor (the 'add object / add row' param editor) for the new record|list param kinds — NOT built yet (P1 ParamSchema union + P3 parts_map producer + pm_demo + the parts_map node-card #973 all shipped). Plans docs/plans/{warp-part-along-spline,complex-params-list-of-parts,parts-params}.md." },
      { id: 976, bundle: 'E', lane: 4, start: 1.16, weeks: 0.14, priority: 'high',   status: 'open', title: "W-G2 · Wells graph — remaining rungs. 3b: a cutaway node in the well graph. 5: completions (packer/nipple/mule shoe) as bw_* Calls at depth. 6: round-trip graph edits back to WSON (today the graph is generated one-way from the doc). Plus: bw_casing.top is declared but ignored — either wire it in the part or drop the param (until then every generated casing card shows a call-drift ⚠ for the unpassed arg); and the generated part id overflows the bake-pane header." },
      { id: 982, bundle: 'B', lane: 1, start: 1.18, weeks: 0.20, priority: 'medium', status: 'open', title: "#66 Per-part material/colour popover on the NODE CARD — not a table in PROPERTIES. Today every subpart gets a row in the PROPERTIES card (PART / OUT / IN / MATL / OP). On w_multi_string_dev that is 10 rows (Default + 9 elements) and the card covers half the graph canvas — the table grows linearly with the part count, exactly where screen space is scarcest. Wanted: click the material/colour chip ON the node card itself and edit that part in an anchored FloatingPanel (per feedback_popup_over_inline). Less space, better graph. Also folds in: bind-a-variable to a param without wiring a node. Depends on per-SUBPART material (#947, needs color-by-source)." },
      { id: 983, bundle: 'B', lane: 1, start: 1.22, weeks: 0.25, priority: 'medium', status: 'open', title: "#65 API + SDK — third parties build apps on our graph editor. The long-term bet, and /wells is its first proof: a domain app is just a translator (domain doc → composition graph) + the embedded GraphEditorPane + a domain canvas + toolbars around it. Generalize that into a public seam so someone outside this repo can do the same — connect the engines (Manifold · TrueForm · BREP/OCCT) into something bigger than any one of them. Needs: a stable graph schema, a documented /api/primitives/* contract (compile · bake · save · list · types), an SDK wrapping them, and GraphEditorPane mountable against a caller-supplied part id OR an in-memory graph (today {id, embed} loads from the volume; seedGraph already hydrates an in-memory graph, which is the door). Precondition for the wells GRAPH tab (#975) being a PATTERN rather than a one-off." },
  ];

  const PRIORITY_COLOR: Record<Priority, string> = {
    high:   '#dc2626',
    medium: '#2563eb',
    large:  '#7c3aed',
    low:    '#64748b',
  };
  const PRIORITY_ORDER: Record<Priority, number> = {
    high: 0, medium: 1, large: 2, low: 3,
  };

  // Layout
  // Flexible first-column width (the frozen task-label column). Drives the
  // `--label-w` CSS var; drag the divider handle to resize, persisted to
  // localStorage. Replaces the old fixed LABEL_W = 320 const.
  let labelW = $state(320);
  const LABEL_W_MIN = 180;
  const LABEL_W_MAX = 600;
  if (typeof localStorage !== 'undefined') {
    const saved = Number(localStorage.getItem('plan-label-w'));
    if (Number.isFinite(saved) && saved >= LABEL_W_MIN && saved <= LABEL_W_MAX) labelW = saved;
  }
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = labelW;
    const move = (ev: PointerEvent) => {
      labelW = Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, startW + (ev.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem('plan-label-w', String(Math.round(labelW))); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function resetResize() {
    labelW = 320;
    try { localStorage.setItem('plan-label-w', '320'); } catch { /* ignore */ }
  }
  /** Translate a 0..1 opacity into an 8-bit hex alpha suffix for a 6-hex color,
   *  so bars fade like the old SVG fill-opacity (grid shows through) without
   *  fading the ✓ glyph or the active/hover outline (element opacity would). */
  function alphaHex(o: number): string {
    return Math.round(Math.max(0, Math.min(1, o)) * 255).toString(16).padStart(2, '0');
  }

  const ROW_H    = 26;
  const ROW_GAP  = 4;
  const WEEK_PX  = 56;
  const HEAD_H   = 44;
  const TAIL_PAD = 80;
  const HEADER_ROW_H = ROW_H + 6;

  let sortMode = $state<'bundle' | 'priority' | 'start' | 'id'>('bundle');
  // The Open/Done toggle is gone with the done rows (see doneFrontier). Every task
  // in `tasks` is live work; shipped rows live in docs/HISTORY.md.

  let hoverId = $state<number | null>(null);
  let selectedId = $state<number | null>(null);

  let expandedBundles = $state(new Set(BUNDLES.map(b => b.id)));
  function toggleBundle(id: string) {
    const next = new Set(expandedBundles);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedBundles = next;
  }
  function expandAll()   { expandedBundles = new Set(BUNDLES.map(b => b.id)); }
  function collapseAll() { expandedBundles = new Set(); }

  const visibleTasks = $derived(
    tasks.filter(t => t.status !== 'done')
  );

  // A.1, B.2, … — numbered within bundle among items in the current view only.
  const codeById = $derived.by(() => {
    const map = new Map<number, string>();
    for (const bundleId of ['A', 'B', 'C', 'D'] as const) {
      const sorted = visibleTasks
        .filter((t) => t.bundle === bundleId)
        .sort((a, b) => a.start - b.start || a.id - b.id);
      sorted.forEach((t, i) => map.set(t.id, `${bundleId}.${i + 1}`));
    }
    return map;
  });
  const codeFor = (id: number) => codeById.get(id) ?? `#${id}`;

  function sortTasks(arr: Task[]): Task[] {
    const copy = [...arr];
    if (sortMode === 'priority') {
      return copy.sort((a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        a.start - b.start || a.id - b.id);
    }
    if (sortMode === 'start') return copy.sort((a, b) => a.start - b.start || a.id - b.id);
    if (sortMode === 'id')    return copy.sort((a, b) => a.id - b.id);
    return copy.sort((a, b) => a.start - b.start || a.id - b.id);
  }

  type FlatRow =
    | { type: 'header'; bundle: Bundle; count: number; totalWeeks: number; activeCount: number }
    | { type: 'task'; task: Task };

  const flatRows = $derived.by<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const bundle of BUNDLES) {
      const inBundle = visibleTasks.filter(t => t.bundle === bundle.id);
      if (inBundle.length === 0) continue;
      const totalW = inBundle.reduce((s, t) => s + t.weeks, 0);
      const activeN = inBundle.filter(t => t.status === 'active').length;
      out.push({ type: 'header', bundle, count: inBundle.length, totalWeeks: totalW, activeCount: activeN });
      if (expandedBundles.has(bundle.id)) {
        for (const t of sortTasks(inBundle)) out.push({ type: 'task', task: t });
      }
    }
    return out;
  });

  // Time horizon spans both backward (done items shipped before start)
  // and forward. We snap to whole-week increments on either side of START.
  // Chart span = the EARLIEST visible item to the LATEST (no hard 0 floor —
  // that pinned the left edge to sequence-week 0, which now maps to a year
  // back; the open view would render every bar far off-screen right).
  const minStart = $derived.by(() => {
    let m = Infinity;
    for (const t of visibleTasks) m = Math.min(m, t.start);
    return Number.isFinite(m) ? Math.floor(m) : 0;
  });
  const maxEnd = $derived.by(() => {
    let m = -Infinity;
    for (const t of visibleTasks) m = Math.max(m, t.start + t.weeks);
    return Number.isFinite(m) ? Math.ceil(m + 0.5) : 1;
  });
  const totalWeeks = $derived(maxEnd - minStart);

  function rowYAt(i: number): number {
    let y = 0;
    for (let k = 0; k < i; k++) {
      y += flatRows[k].type === 'header' ? HEADER_ROW_H : ROW_H + ROW_GAP;
    }
    return y;
  }

  const chartHeight = $derived(HEAD_H + rowYAt(flatRows.length) + 20);
  const chartWidth = $derived(totalWeeks * WEEK_PX + TAIL_PAD);

  function weekX(weekOffset: number): number {
    return (weekOffset - minStart) * WEEK_PX;
  }
  /** The work frontier — where shipped work ends and the roadmap begins. Drives
   *  the "Now" marker. It USED to be derived from the `done` rows, but those were
   *  moved to `docs/HISTORY.md` (2026-07-10): /plan is the roadmap, not an archive.
   *  Bump this when a batch of rows closes. Last set at the MF_CLIENT/MF_SERVER +
   *  no-compose bake landing. */
  const doneFrontier = 1.3;

  // ── Calendar axis (today-anchored) ───────────────────────────────────
  // The `start` values are sequence positions, NOT literal calendar weeks,
  // so we don't hardcode a calendar epoch. Instead we pin the work frontier
  // (doneFrontier) to TODAY and read every other week off that: the gantt
  // shows real dates with today at the origin, and forward items dated out
  // from today. Self-maintaining — re-anchors every day + every time an
  // item flips to done. (ssr is off, so `new Date()` client-side is fine.)
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  /** Calendar date for an ABSOLUTE sequence-week (frontier ⇒ today). */
  function dateForWeek(absW: number): Date {
    // Anchor the EARLIEST visible task (minStart) to TODAY so the chart starts
    // at today (16 Jun) and nothing renders before it; weeks flow forward.
    return new Date(TODAY.getTime() + (absW - minStart) * WEEK_MS);
  }
  function fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const activeIds = $derived(new Set(tasks.filter(t => t.status === 'active').map(t => t.id)));
  const countsByPri = $derived.by<Record<Priority, number>>(() => {
    const out: Record<Priority, number> = { high: 0, medium: 0, large: 0, low: 0 };
    for (const t of visibleTasks) out[t.priority] = (out[t.priority] ?? 0) + 1;
    return out;
  });
  const openCount = $derived(tasks.filter(t => t.status !== 'done').length);

  const selectedTask = $derived(selectedId == null ? null : tasks.find(t => t.id === selectedId) ?? null);
  const selectedDetails = $derived(selectedId == null ? null : details[selectedId] ?? null);

  function onGlobalKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && selectedId != null) {
      selectedId = null;
      e.preventDefault();
    }
  }
</script>

<svelte:head><title>Plan — CAD Train</title></svelte:head>
<svelte:window onkeydown={onGlobalKey} />

<div class="page">
  <header class="head">
    <div class="head-title">
      <h1>Plan</h1>
      <p class="sub">
        {openCount} open · {BUNDLES.length} bundles · today = {fmtDate(TODAY)} · horizon {fmtDate(dateForWeek(maxEnd))}
      </p>
    </div>
    <div class="head-controls">
      <a class="hist-link" href="https://github.com/pyenthu/cadtrain/blob/main/docs/HISTORY.md">✓ Shipped → docs/HISTORY.md</a>
    </div>
  </header>

  <!-- Bundle legend strip -->
  <div class="legend">
    {#each BUNDLES as b}
      {@const inB = visibleTasks.filter(t => t.bundle === b.id)}
      {#if inB.length}
        <button
          class="legend-chip"
          class:active={expandedBundles.has(b.id)}
          onclick={() => toggleBundle(b.id)}
          title={b.desc}
        >
          <span class="dot" style="background:{b.tint}"></span>
          <span class="bid">{b.id}</span>
          <span class="bname">{b.name}</span>
          <span class="bcount">({inB.length})</span>
        </button>
      {/if}
    {/each}
    <!-- Priority legend shares the bundle-legend row (pushed right). -->
    <div class="pri-legend">
      {#each Object.entries(PRIORITY_COLOR) as [key, color]}
        {#if countsByPri[key as Priority]}
          <span class="pri-chip">
            <span class="dot" style="background:{color}"></span>
            {key} ({countsByPri[key as Priority]})
          </span>
        {/if}
      {/each}
      <span class="pri-chip"><span class="dot active-dot"></span>active</span>
    </div>
  </div>

  <!-- Controls -->
  <div class="controls">
    <label>Sort:</label>
    <select bind:value={sortMode}>
      <option value="bundle">Bundle order</option>
      <option value="priority">Priority</option>
      <option value="start">Start date</option>
      <option value="id">ID</option>
    </select>
    <button onclick={expandAll}>Expand all</button>
    <button onclick={collapseAll}>Collapse all</button>
  </div>

  <!--
    HTML/CSS Gantt. Single scroll container (.chart-wrap, overflow:auto) so
    BOTH freezes work off the same scroller:
      • each row's .label-cell is position:sticky; left:0  → frozen first column
      • the .axis-row is position:sticky; top:0            → frozen date header
      • the corner cell is sticky on BOTH axes (sits in the sticky-top row AND
        is itself sticky-left) → frozen top-left corner.
    Column width is driven by the --label-w CSS var (let labelW). A tall drag
    handle on the divider resizes it (startResize). Week gridlines + the today
    frontier live in one full-height .grid-overlay behind the rows.
  -->
  <div class="chart-wrap" style="--label-w:{labelW}px;">
    <div class="chart-inner" style="width: calc(var(--label-w) + {chartWidth}px); min-height:{chartHeight}px;">
      <!-- Full-height grid overlay: a gridline each week (heavier every 2nd) +
           the red dashed today frontier. Offset by the label column; sits
           BEHIND the rows so it shows through transparent task tracks. -->
      <div class="grid-overlay" style="left: var(--label-w); width:{chartWidth}px;">
        {#each Array(totalWeeks + 1) as _, w}
          <div class="gridline" class:heavy={w % 2 === 0} style="left:{w * WEEK_PX}px;"></div>
        {/each}
        <div class="today-line" style="left:{weekX(minStart)}px; top:{HEAD_H}px;"></div>
        <div class="today-label" style="left:{weekX(minStart) + 4}px; top:{HEAD_H}px;">Today · {fmtDate(TODAY)}</div>
      </div>

      <!-- Date-axis header row (frozen top). -->
      <div class="row axis-row" style="height:{HEAD_H}px;">
        <div class="label-cell corner">
          <span class="col-h hash">#</span>
          <span class="col-h task">Task</span>
          <span class="col-h bundle">Bundle</span>
          <!-- Divider drag handle — spans the full chart height. Lives in the
               corner cell, which is frozen top+left, so it tracks the divider
               through both scroll axes. Double-click resets to 320. -->
          <div
            class="resize-handle"
            style="height:{chartHeight}px;"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize task column"
            title="Drag to resize · double-click to reset"
            onpointerdown={startResize}
            ondblclick={resetResize}
          ></div>
        </div>
        <div class="axis-track" style="width:{chartWidth}px;">
          {#each Array(totalWeeks + 1) as _, w}
            {@const absW = w + minStart}
            {#if w < totalWeeks && w % 2 === 0}
              <span class="axis-date" style="left:{w * WEEK_PX + 5}px;">{fmtDate(dateForWeek(absW))}</span>
            {/if}
          {/each}
        </div>
      </div>

      <!-- Bundle swimlane headers + task rows -->
      {#each flatRows as row, i (i)}
        {#if row.type === 'header'}
          {@const expanded = expandedBundles.has(row.bundle.id)}
          <div
            class="row header-row"
            style="height:{HEADER_ROW_H}px; background:{row.bundle.tint}1f;"
            role="button"
            tabindex="0"
            title={`Click to ${expanded ? 'collapse' : 'expand'} ${row.bundle.id} — ${row.bundle.name}`}
            onclick={() => toggleBundle(row.bundle.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBundle(row.bundle.id); } }}
          >
            <div class="label-cell header-label" style="background:{row.bundle.tint}1f;">
              <span class="spine" style="background:{row.bundle.tint};"></span>
              <span class="caret">{expanded ? '▾' : '▸'}</span>
              <span class="bchip" style="background:{row.bundle.tint};">{row.bundle.id}</span>
              <span class="bname">{row.bundle.name}</span>
              <span class="bmeta">· {row.count} task{row.count !== 1 ? 's' : ''} · {row.totalWeeks.toFixed(1)}w{row.activeCount ? ` · ${row.activeCount} active` : ''}</span>
            </div>
            <div class="track header-track" style="width:{chartWidth}px;"></div>
          </div>
        {:else}
          {@const t = row.task}
          {@const barLeft = weekX(t.start)}
          {@const barW = Math.max(t.weeks * WEEK_PX, 12)}
          {@const color = PRIORITY_COLOR[t.priority] ?? '#64748b'}
          {@const active = activeIds.has(t.id)}
          {@const isHover = hoverId === t.id}
          {@const op = t.status === 'deferred' ? 0.35 : t.status === 'done' ? 0.55 : isHover ? 1 : 0.85}
          <div class="row task-row" style="height:{ROW_H + ROW_GAP}px;">
            <div class="label-cell task-label">
              <span class="tcode">{codeFor(t.id)}</span>
              <span class="ttitle">{t.title}</span>
              <span class="tchip" style="background:{BUNDLES.find(b => b.id === t.bundle)?.tint ?? '#94a3b8'};">{t.bundle}</span>
            </div>
            <div class="track task-track" style="width:{chartWidth}px;">
              <div
                class="bar"
                class:active
                class:hover={isHover}
                style="left:{barLeft}px; width:{barW}px; height:{ROW_H}px; background:{color}{alphaHex(op)};"
                role="button"
                tabindex="0"
                title={`${codeFor(t.id)} (#${t.id}) — ${t.title}\nBundle: ${t.bundle} · Priority: ${t.priority} · Status: ${t.status}\n${fmtDate(dateForWeek(t.start))} → ${fmtDate(dateForWeek(t.start + t.weeks))}\nClick for plan details`}
                onmouseenter={() => hoverId = t.id}
                onmouseleave={() => hoverId = null}
                onclick={() => selectedId = t.id}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedId = t.id; } }}
              >
                {#if t.status === 'done'}<span class="check">✓</span>{/if}
              </div>
              <span class="weeks" style="left:{barLeft + barW + 6}px;">{t.weeks}w</span>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>

  <footer class="foot">
    <span>Source: <code>src/routes/plan/+page.svelte</code> · details in <code>./details.ts</code></span>
    <span class="mono">Total: {visibleTasks.reduce((s, t) => s + t.weeks, 0).toFixed(1)}w across {new Set(visibleTasks.map(t => t.lane)).size} lanes</span>
  </footer>
</div>

<!-- Detail popup -->
{#if selectedTask}
  <div class="modal-backdrop" onclick={() => selectedId = null} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="modal-head" style="background: linear-gradient(to right, {PRIORITY_COLOR[selectedTask.priority]}1a, transparent)">
        <div class="modal-meta">
          <span class="mono">{codeFor(selectedTask.id)} <span class="dim">· #{selectedTask.id}</span></span>
          <span class="dot-sm"></span>
          <span class="pri-pill" style="background:{PRIORITY_COLOR[selectedTask.priority]}">{selectedTask.priority}</span>
          <span class="dot-sm"></span>
          <span class:active-text={selectedTask.status === 'active'}>{selectedTask.status}</span>
          <span class="dot-sm"></span>
          <span>{fmtDate(dateForWeek(selectedTask.start))} → {fmtDate(dateForWeek(selectedTask.start + selectedTask.weeks))}</span>
        </div>
        <h2>{selectedTask.title}</h2>
        <button class="modal-close" onclick={() => selectedId = null} aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        {#if selectedDetails}
          {#if selectedDetails.summary}
            <section><h3>Summary</h3><p>{selectedDetails.summary}</p></section>
          {/if}
          {#if selectedDetails.steps?.length}
            <section><h3>Steps</h3>
              <ol>{#each selectedDetails.steps as step}<li>{step}</li>{/each}</ol>
            </section>
          {/if}
          {#if selectedDetails.acceptance?.length}
            <section><h3>Acceptance</h3>
              <ul class="check">{#each selectedDetails.acceptance as a}<li><span class="ok">✓</span><span>{a}</span></li>{/each}</ul>
            </section>
          {/if}
          {#if selectedDetails.refs?.length}
            <section><h3>References</h3>
              <ul class="refs">{#each selectedDetails.refs as r}
                <li>{#if r.startsWith('http')}<a href={r} target="_blank" rel="noopener">{r}</a>{:else}<code>{r}</code>{/if}</li>
              {/each}</ul>
            </section>
          {/if}
          {#if selectedDetails.video || selectedDetails.videos?.length}
            <section>
              <h3>Recording (e2e verification)</h3>
              {#if selectedDetails.video}
                <video controls preload="metadata" src={selectedDetails.video}>
                  <track kind="captions" />
                </video>
                <p class="video-caption"><code>{selectedDetails.video}</code></p>
              {/if}
              {#if selectedDetails.videos?.length}
                {#each selectedDetails.videos as v}
                  <video controls preload="metadata" src={v}>
                    <track kind="captions" />
                  </video>
                  <p class="video-caption"><code>{v}</code></p>
                {/each}
              {/if}
              <p class="video-hint">Generated by <code>bun run record:task -- {selectedTask?.id}</code> per CLAUDE.md Rule 12.</p>
            </section>
          {/if}
        {:else}
          <p class="dim italic">No detail entry yet for {codeFor(selectedTask.id)}. Add one in <code>./details.ts</code>.</p>
        {/if}
      </div>
      <div class="modal-foot"><span>Esc or click outside to close</span><span class="mono">details.ts[{selectedTask.id}]</span></div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 16px 24px; height: 100%; overflow: auto; background: #f8fafc; box-sizing: border-box; }
  .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
  .head-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .head h1 { margin: 0; font-size: 24px; font-weight: 600; color: #1e293b; }
  .sub { margin: 0; font-size: 13px; color: #64748b; white-space: nowrap; }
  .head-controls { display: flex; align-items: center; gap: 12px; }
  .toggle { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; font-size: 12px; }
  .toggle button { padding: 4px 12px; border: none; background: #fff; color: #475569; cursor: pointer; font: inherit; }
  .toggle button:hover { background: #f1f5f9; }
  .toggle button.on { background: #334155; color: #fff; font-weight: 600; }

  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 6px; margin-bottom: 10px; }
  .legend-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px;
    border: 1px solid #e2e8f0; border-radius: 4px; background: #f1f5f9; font-size: 11px; color: #334155; cursor: pointer; }
  .legend-chip.active { background: #fff; border-color: #cbd5e1; }
  .legend-chip:hover { background: #fff; }
  .legend-chip .bid { font-weight: 700; flex: none; }
  /* Cap the name width so long bundle titles ellipsis instead of forcing
     each chip onto its own row — keeps the legend to ~2 rows on narrow
     viewports while still fitting all four on one row when wide. */
  .legend-chip .bname { color: #475569; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-chip .bcount { color: #94a3b8; flex: none; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }

  .controls { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; font-size: 13px; color: #475569; }
  .controls select, .controls button { padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font: inherit; cursor: pointer; }
  .controls button { font-size: 12px; color: #475569; }
  .controls button:hover { background: #f1f5f9; }
  .pri-legend { margin-left: auto; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pri-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #475569; }
  .active-dot { border: 2px solid #f59e0b; background: #fff; }

  /* ── Gantt chart (HTML/CSS) ──────────────────────────────────────────
     Single scroll container; sticky freezes resolve against it. */
  .chart-wrap {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    overflow: auto;                 /* scrolls BOTH axes */
    max-height: calc(100vh - 210px);
    min-height: 320px;
    user-select: none;
    position: relative;
  }
  .chart-inner {
    position: relative;
    z-index: 0;                     /* stacking context for overlay/rows */
  }

  /* Full-height week grid + today frontier — behind the rows (z 1). */
  .grid-overlay { position: absolute; top: 0; bottom: 0; z-index: 1; pointer-events: none; }
  .gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: #eef2f6; }
  .gridline.heavy { background: #cbd5e1; }
  .today-line { position: absolute; bottom: 0; width: 0; border-left: 2px dashed #ef4444; }
  .today-label { position: absolute; font: 700 10px system-ui; color: #dc2626; white-space: nowrap; transform: translateY(2px); }

  /* Rows: flex [ sticky label cell | track ]. */
  .row { display: flex; position: relative; z-index: 2; }
  .axis-row {
    position: sticky; top: 0; z-index: 3;     /* frozen date header */
    background: #fff;
    border-bottom: 1px solid #cbd5e1;
  }

  .label-cell {
    position: sticky; left: 0; z-index: 4;    /* frozen first column */
    flex: 0 0 var(--label-w);
    width: var(--label-w);
    box-sizing: border-box;
    border-right: 1px solid #cbd5e1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    overflow: hidden;
    background: #fff;                          /* opaque → occludes scrolled track/grid */
  }
  .label-cell.corner {
    z-index: 6;                                /* above task rows AND its own track */
    background: #f8fafc;
    font: 600 11px system-ui;
    color: #334155;
  }
  .corner .col-h.hash { width: 22px; }
  .corner .col-h.task { flex: 1 1 auto; }
  .corner .col-h.bundle { margin-left: auto; }

  /* Divider drag handle — full chart height, pinned via the corner cell. */
  .resize-handle {
    position: absolute; top: 0; right: -4px;
    width: 8px;
    z-index: 10;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
  }
  .resize-handle:hover { background: rgba(37, 99, 235, 0.18); }

  /* Date axis */
  .axis-track { position: relative; flex: 0 0 auto; }
  .axis-date { position: absolute; top: 8px; font: 9.5px system-ui; color: #64748b; white-space: nowrap; }

  /* Bundle swimlane header rows */
  .header-row { cursor: pointer; align-items: stretch; }
  .header-label { gap: 8px; position: relative; padding-left: 18px; }
  .header-label .spine { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; }
  .header-label .caret { font: 700 12px system-ui; color: #334155; }
  .header-label .bchip {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 18px; padding: 0 4px; border-radius: 3px;
    color: #fff; font: 700 11px system-ui;
  }
  .header-label .bname { font: 600 12px system-ui; color: #1e293b; white-space: nowrap; }
  .header-label .bmeta { font: 10px system-ui; color: #64748b; white-space: nowrap; }
  .header-track { flex: 0 0 auto; }

  /* Task rows */
  .task-label { background: #fff; }
  .task-label .tcode { flex: 0 0 auto; font: 11px ui-monospace, monospace; color: #64748b; }
  .task-label .ttitle {
    flex: 1 1 auto; min-width: 0;
    font: 12px system-ui; color: #1e293b;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;   /* CSS truncation */
  }
  .task-label .tchip {
    flex: 0 0 auto; margin-left: auto;
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; height: 16px; padding: 0 3px; border-radius: 3px;
    color: #fff; font: 700 10px system-ui;
  }
  .task-track { position: relative; flex: 0 0 auto; }

  .bar {
    position: absolute; top: 50%; transform: translateY(-50%);
    border-radius: 4px; cursor: pointer;
    transition: background-color 120ms;
    display: flex; align-items: center; justify-content: center;
  }
  .bar.hover { outline: 1.5px solid #0f172a; }
  .bar.active { outline: 2.5px solid #f59e0b; }     /* active wins over hover */
  .bar .check { color: #fff; font: 700 10px system-ui; pointer-events: none; }
  .weeks { position: absolute; top: 50%; transform: translateY(-50%); font: 10px ui-monospace, monospace; color: #64748b; white-space: nowrap; pointer-events: none; }

  .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; font-size: 11px; color: #64748b; }
  .foot code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font: 11px ui-monospace, monospace; }
  .mono { font-family: ui-monospace, monospace; }

  .modal-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .modal { background: #fff; border-radius: 8px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25); max-width: 720px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-head { padding: 14px 20px; border-bottom: 1px solid #e2e8f0; position: relative; }
  .modal-head h2 { margin: 6px 32px 0 0; font-size: 16px; font-weight: 600; color: #0f172a; line-height: 1.4; }
  .modal-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; flex-wrap: wrap; }
  .modal-meta .dim { color: #94a3b8; }
  .dot-sm { width: 3px; height: 3px; border-radius: 50%; background: #cbd5e1; }
  .pri-pill { padding: 2px 6px; border-radius: 3px; color: #fff; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .active-text { color: #d97706; font-weight: 600; }
  .modal-close { position: absolute; top: 12px; right: 14px; background: none; border: none; color: #94a3b8; font-size: 16px; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; }
  .modal-close:hover { background: #f1f5f9; color: #334155; }

  .modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; font-size: 13px; color: #334155; }
  .modal-body section { margin-bottom: 14px; }
  .modal-body h3 { margin: 0 0 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; }
  .modal-body p { margin: 0; line-height: 1.55; }
  .modal-body ol { margin: 0; padding-left: 20px; }
  .modal-body ol li { line-height: 1.5; margin-bottom: 4px; }
  .modal-body ul.check { list-style: none; margin: 0; padding: 0; }
  .modal-body ul.check li { display: flex; gap: 8px; line-height: 1.5; margin-bottom: 4px; }
  .modal-body ul.check .ok { color: #059669; font-weight: 700; flex-shrink: 0; }
  .modal-body ul.refs { list-style: none; margin: 0; padding: 0; }
  .modal-body ul.refs li { margin-bottom: 2px; }
  .modal-body code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font: 11px ui-monospace, monospace; }
  .modal-body a { color: #2563eb; text-decoration: none; font: 11px ui-monospace, monospace; word-break: break-all; }
  .modal-body a:hover { text-decoration: underline; }
  .modal-body .italic { font-style: italic; }
  .modal-body .dim { color: #94a3b8; }

  .modal-foot { padding: 8px 20px; border-top: 1px solid #f1f5f9; background: #f8fafc; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }

  .modal-body video { width: 100%; max-width: 640px; height: auto; border: 1px solid #e2e8f0; border-radius: 4px; background: #000; margin-bottom: 4px; }
  .video-caption { margin: 0 0 12px; font-size: 10px; color: #94a3b8; }
  .video-hint { margin: 6px 0 0; font-size: 10px; color: #94a3b8; }
  .video-hint code { font-size: 10px; }
</style>
