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
  ];

  const tasks: Task[] = [
    { id:  1, bundle: 'A', lane: 0, start: 0, weeks: 4,   priority: 'large',  status: 'done', title: '18 parametric primitives in src/lib/cad/library.ts' },
    { id: 20, bundle: 'A', lane: 0, start: 1, weeks: 1.5, priority: 'medium', status: 'done', title: 'pHash 2D-DCT perceptual hash + hamming distance' },
    { id:  2, bundle: 'A', lane: 0, start: 2, weeks: 2,   priority: 'medium', status: 'done', title: 'ManifoldCAD geometry pipeline (buildComponent + finalizeManifold)' },
    { id: 21, bundle: 'A', lane: 0, start: 2, weeks: 1,   priority: 'medium', status: 'done', title: 'TrainingCache (JSONL, atomic write, feedback weighting)' },
    { id:  3, bundle: 'A', lane: 0, start: 3, weeks: 1.5, priority: 'medium', status: 'done', title: '/components viewer — cutaway, edges, SVG export, PNG capture' },
    { id: 22, bundle: 'A', lane: 0, start: 3, weeks: 1.5, priority: 'high',   status: 'done', title: '/api/identify — RAG few-shot prompt + Claude vision' },
    { id:  4, bundle: 'A', lane: 0, start: 4, weeks: 1,   priority: 'medium', status: 'done', title: 'Dedicated /tools/bottom-sub viewer (HAL10408)' },
    { id: 23, bundle: 'A', lane: 0, start: 4, weeks: 1,   priority: 'medium', status: 'done', title: '/api/refine — SSIM loop + Claude param updates' },
    { id:  5, bundle: 'A', lane: 0, start: 5, weeks: 1,   priority: 'medium', status: 'done', title: 'Dedicated /tools/ratch-latch viewer' },
    { id: 24, bundle: 'A', lane: 0, start: 5, weeks: 0.5, priority: 'medium', status: 'done', title: '/api/accept + /api/feedback — user-validated cache growth' },
    { id: 25, bundle: 'A', lane: 0, start: 6, weeks: 1,   priority: 'medium', status: 'done', title: 'HAL catalog ingest into cache.jsonl (1,772 records) — scaffolding only; 1,646 unknown-component records deleted 2026-05-11 (chore 0cdd687)' },
    { id:  6, bundle: 'A', lane: 0, start: 8,  weeks: 0.3, priority: 'medium', status: 'done', title: 'URL-driven /components (?p=&cam=) for synthetic data generator' },
    { id: 26, bundle: 'A', lane: 0, start: 8, weeks: 0.5, priority: 'large',  status: 'done', title: 'CLIP retrieval rollout — embed module, hybrid scoring, identify wiring' },
    { id: 27, bundle: 'A', lane: 0, start: 8, weeks: 0.3, priority: 'medium', status: 'done', title: 'Synthetic data generator — Playwright × 5 angles × 7 styles (700 samples)' },
    { id: 60, bundle: 'A', lane: 0, start: 8,   weeks: 0.2, priority: 'high',   status: 'done', title: 'WSON schema + validateWson — mirrored from SVTC src/lib/apps/wson/CLAUDE.md' },
    { id: 100, bundle: 'A', lane: 0, start: 8,   weeks: 0.2, priority: 'medium', status: 'done', title: '/plan Gantt route — this page' },
    { id: 61, bundle: 'A', lane: 0, start: 8.2, weeks: 0.2, priority: 'high',   status: 'done', title: '/api/wells/extract — Claude (Opus 4.7) vision → WSON; type:document for PDFs; rate-limited' },
    { id: 101, bundle: 'A', lane: 0, start: 8.2, weeks: 0.1, priority: 'medium', status: 'done', title: 'Navbar: Wells + Meta segments added' },
    { id: 62, bundle: 'A', lane: 0, start: 8.4, weeks: 0.2, priority: 'high',   status: 'done', title: '/wells UI — upload, extract, render section cards, download JSON' },
    { id: 102, bundle: 'A', lane: 0, start: 8.4, weeks: 0.5, priority: 'low',    status: 'done', title: 'Per-task plan details — populate ./details.ts entries for in-flight items' },
    { id:  7, bundle: 'A', lane: 0, start: 9,  weeks: 1.5, priority: 'high',   status: 'done', title: 'Re-render primitives with red-outer/grey-internal coloring + shading before pHash/CLIP — shelved: cold-classification 17/18 killed CLIP rationale' },
    { id: 110, bundle: 'A', lane: 0, start: 9,   weeks: 0.4, priority: 'high',   status: 'done',   title: 'Phase 0 — Extract shared API/CLI infra (identify + wells backends → src/lib/shared/)' },
    { id: 111, bundle: 'A', lane: 0, start: 9.4, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Phase 1 — Move all current routes under /archive/* (preserve as reference, mark "old work")' },
    { id: 200, bundle: 'A', lane: 0, start: 9.5, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Storage convention: static/eval/catalog/<vendor>/ + manifest.json; PDFs gitignored, structure committed' },
    { id: 201, bundle: 'A', lane: 0, start: 9.7, weeks: 0.5, priority: 'high',   status: 'done',   title: 'PDF inspector: per-page detection of vector vs raster vs hybrid (PyMuPDF page.get_drawings + get_images + get_text)' },
    { id: 112, bundle: 'A', lane: 0, start: 9.8, weeks: 0.1, priority: 'medium', status: 'done',   title: 'Phase 1.3 — Navbar rewrite: CAD | Wells | Archive | Meta segments' },
    { id: 113, bundle: 'A', lane: 0, start: 9.9, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Phase 2 — Empty /cad and /wells stubs + new two-product landing' },
    { id: 114, bundle: 'A', lane: 0, start: 10.1, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Phase 3 — Update CLAUDE.md (route table, methodology section, lib map for shared/)' },
    { id: 115, bundle: 'A', lane: 0, start: 10.3, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Playwright e2e suite — routes/navbar/archive-links specs (44 tests, headless 15s)' },
    { id: 116, bundle: 'A', lane: 0, start: 10.6, weeks: 0.5, priority: 'medium', status: 'done',   title: 'Expand e2e: backend smoke tests (upload to /archive/wells + /archive/reverse)' },
    { id: 117, bundle: 'A', lane: 0, start: 11.1, weeks: 0.5, priority: 'low',    status: 'done',   title: 'Wire e2e suite into CI / pre-commit (currently manual via bun run test:e2e)' },
    { id: 118, bundle: 'A', lane: 0, start: 11.6, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Rule 12 implementation — harvest_e2e_videos.ts + video playback in /plan popups (record:task script)' },
    { id: 119, bundle: 'A', lane: 0, start: 11.8, weeks: 0.1, priority: 'medium', status: 'done',   title: 'Home page = SVTC-style menu only; promote Tests to top-level navbar; longest-prefix active state' },
    { id: 120, bundle: 'A', lane: 0, start: 11.9, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Mobile responsive (≤900px stack vertical) + collapsible side panels (params/meta/parts) on components + author' },
    { id: 205, bundle: 'A', lane: 0, start: 11.9, weeks: 0.5, priority: 'medium', status: 'done',   title: 'Catalog indexer: COMPLETE-BY-DELETION (chore 0cdd687, 2026-05-11) — 1,646 unknown records dropped; KB tables (H bundle) replace cache as vendor-data source of truth' },
    { id: 121, bundle: 'A', lane: 0, start: 12.1, weeks: 0.1, priority: 'high',   status: 'done',   title: 'Promote /author + /library to top-level (out of /archive); add to navbar' },
    { id: 122, bundle: 'A', lane: 0, start: 12.2, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Multi-mesh render path for compose.ts (mirror bottom-sub) — fixes mobile WebKit OOM on Opus assemblies; restores 192-segment precision' },
    { id: 123, bundle: 'A', lane: 0, start: 12.5, weeks: 0.5, priority: 'medium', status: 'done',   title: 'GLB-via-REST: server-side ManifoldCAD writes <id>.glb (or <paramhash>.glb on Apply); client just GLTFLoads — no WASM in the browser at all' },
    { id: 124, bundle: 'A', lane: 0, start: 13, weeks: 1.0, priority: 'low',    status: 'done',   title: 'Explore GPU-based CSG (compute-shader booleans) for the giant-mesh path — would let /author do live edits on assemblies that today exceed WASM heap' },
    { id: 400, bundle: 'A', lane: 0, start: 18, weeks: 0.4, priority: 'high',   status: 'done',   title: '/components sidebar restructure: 4 hierarchy tabs (Primitives / Compositions / Components / Assemblies) + KB tab; tab-strip-on-left, in-tab Threlte canvas + scene controls' },
    { id: 401, bundle: 'A', lane: 0, start: 18.4, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Variation generator in library.ts: ComponentDef.parent + deriveVariation(spec) + buildPrimitiveManifold parent-chain fallback. SC/LC/BC box+pin variants generated from one spec table' },
    { id: 402, bundle: 'A', lane: 0, start: 18.7, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Tubing rules file (src/lib/cad/rules/tubing.ts): TubingInputs → resolveTubing (KB lookup + formula fallback) → buildTubingSpec → AuthoredComponent. Box on top, pin on bottom convention encoded' },
    { id: 403, bundle: 'A', lane: 0, start: 19.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Drill-pipe identification KB (static/kb/api/drill-pipe-identification.json) + drill_pipe_tool_joint primitive (parametric tong-area marking) + rules/drill_pipe.ts mirroring the tubing pipeline' },
    { id: 404, bundle: 'A', lane: 0, start: 19.5, weeks: 0.3, priority: 'high',   status: 'done',   title: 'KB row → composite preview: optional rowAction prop on KbTableViewer; casing-tubing rows get a ▶ button → generateTubingComponent → opens as composite tab' },
    { id: 405, bundle: 'A', lane: 0, start: 19.8, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Catalog-inspired primitives: window_cutout (LatchRite multilateral), whipstock, sliding_sleeve (HS-ICV / MCC-ICV pattern), drill_pipe_tool_joint' },
    { id: 500, bundle: 'A', lane: 0, start: 23, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Inspector overhaul: param-group accordion · "+ Add primitive" picker w/ search · empty-stub for new components (no cylinder) · GLB stage tab added' },
    { id: 501, bundle: 'A', lane: 0, start: 23.3, weeks: 0.2, priority: 'high',   status: 'done',   title: 'Cross-section + Edges toggles relocated from the bottom stage strip into the SceneControls gear popup; Params · Script shortcuts dropped' },
    { id: 502, bundle: 'A', lane: 0, start: 23.5, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Params folded into Parts tab; slider replaced with `dragNumber` Svelte action (mouse-drag scrub + keyboard typing); stacked 4-col card layout (label-on-top, drag-input full width, unit in brackets)' },
    { id: 503, bundle: 'A', lane: 0, start: 23.8, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Geom accumulator DSL: "+" opens the parts picker; snippets emit `geom = geom.add(...)`; `ensureGeomScaffold` auto-injects `let geom = empty(); ... return geom;`; new-primitive stub uses the same shape; `Manifold.prototype.add` sugar alias + `empty()` helper' },
    { id: 504, bundle: 'A', lane: 0, start: 24.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'GLB pipeline overhaul: per-component cut-variant bake (`<id>.cut.glb`) honouring the same `getCutBox()` the live cutaway uses · per-face red-outer/grey-bore vertex colours · Z× compression via `scale.z` · flat-shading + brighter specular (full GLB stays indexed)' },
    { id: 505, bundle: 'A', lane: 0, start: 24.5, weeks: 0.2, priority: 'high',   status: 'done',   title: 'Parts-tab accordion is PER PART: each used helper / composed component is one collapsible bar (name · sig · count · × remove); content = params with matching `group` field; orphan params collapse into a trailing General section' },
    { id: 506, bundle: 'A', lane: 0, start: 24.7, weeks: 0.2, priority: 'high',   status: 'done',   title: 'Stage subtabs collapse to two (3D · Picture); in-canvas pill toggle picks Mesh ↔ GLB; same SceneControls/camera/cutaway state across both' },
    { id: 507, bundle: 'A', lane: 0, start: 24.9, weeks: 0.4, priority: 'medium', status: 'done',   title: 'J.7 [TEMP] — Sinusoidal Z-warp experiment: `MeshPhongMaterial.onBeforeCompile` injects `sin(z * freq)` displacement; edge-split z-subdivider so the mesh has samples to bend through; master `scene.warpEnabled` checkbox + axis/amp/freq controls in SceneControls. Grep-tagged `// TEMP warp experiment` for clean retirement' },
    { id: 508, bundle: 'A', lane: 0, start: 25.3, weeks: 0.1, priority: 'medium', status: 'done',   title: 'E2E spec cleanup: navbar layout, /author removed, /runes → /components GLB path, stage-name landing-tab regex loosened; stale `static/components/*.glb` artefacts deleted (conn_pin, e2e_stubs, curl-test files)' },
    { id: 511, bundle: 'A', lane: 0, start: 25.9, weeks: 0.2, priority: 'high',   status: 'done',   title: 'AI refine Level 1: dynamic prompt from discoverHelpers/discoverOperators; teaches accumulator-form defineGeom(meta, (p, geom) => …), cross-instance refs, top-model stacking, and warns AI off the loader-managed meta fields (instanceColors/instanceOps/instanceTopMode/instanceTopOffset)' },
    { id: 600, bundle: 'B', lane: 1, start: 27, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Single canvas: live mesh + baked GLB side-by-side in ONE WebGL context (PrimitiveDualCanvas/Scene); dropped the stacked 2nd canvas → closes the WebGL context leak' },
    { id: 601, bundle: 'B', lane: 1, start: 27.3, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Instantiable components: meta.profiles defaults + a props override object so compositions stay clean (t_valve_port)' },
    { id: 602, bundle: 'B', lane: 1, start: 27.6, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Collapsible /primitives sidebar (persisted localStorage, SVTC-style « / » toggle)' },
    { id: 603, bundle: 'B', lane: 1, start: 27.8, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Transform editing: ＋transform below the chain (sequential) + ✕ delete (unwrap op(inner,args)→inner)' },
    { id: 604, bundle: 'B', lane: 1, start: 28, weeks: 0.3, priority: 'medium', status: 'done',   title: 'r_threads radial taper: taper_angle param reduces radius along length (NPT-style); 0° = straight, regression-safe' },
    { id: 605, bundle: 'B', lane: 1, start: 28.3, weeks: 0.5, priority: 'high',   status: 'done',   title: 'Inspector accordion: merged Params+Parts into a /components-style accordion (Build · Source · AI tabs); dropped Profile tabs → profile editing via ✎ popup everywhere' },
    { id: 606, bundle: 'B', lane: 1, start: 28.8, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Sidebar directory restructure: tests→Industrial + Completions family folders + Basic folder for r_* primitives — all shipped' },
    { id: 607, bundle: 'B', lane: 1, start: 29.2, weeks: 0.6, priority: 'high',   status: 'done',   title: 'Visual CSG/BODMAS composition tree (read-first): recognizer parses the return expr → ConstructionTree.svelte renders bracketed BODMAS ((L − h1) − h2) + op/leaf nodes + warp-at-end root. Editable drag/reparent splice tracked as K.15.' },
    { id: 608, bundle: 'B', lane: 1, start: 29.8, weeks: 0.5, priority: 'medium', status: 'done',   title: 'Inspector UX polish: exclusive accordion (one row open unless pinned 📌), 2-col param layout (less padding/narrower cols), primitive title inside canvas (Threlte HTML) + hover description, profile shape-icon w/ hover preview + popup w/ 2dp coordinates, prominent tooltips (black bg/white text)' },
    { id: 609, bundle: 'B', lane: 1, start: 30.3, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Warp-at-end transform: warpSpline(comp, path, opts) bends the assembled solid along an (x,z) spline as the final op; no-stretch 1:1 arc-length map (was elongating ~2×). Toggle in the Parts tab; shows as the construction-tree root.' },
    { id: 610, bundle: 'B', lane: 1, start: 30.7, weeks: 0.4, priority: 'medium', status: 'done',   title: 'Searchable profile palette: SVG-thumbnail grid (built-in PROFILE_REGISTRY ∪ volume profiles, filterable) + volume-saved profiles (/api/primitives/profiles/{list,save}) + save-as-profile in the popup.' },
    { id: 611, bundle: 'B', lane: 1, start: 31.1, weeks: 0.3, priority: 'medium', status: 'done',   title: 'Volume consolidated to 4 dirs (archive/components/ai/primitives): kb+kb-sources+training_data+eval → ai/, empty library/ husk deleted; code repointed (no alias) + docker-entrypoint + CLAUDE.md Rule 13.' },
    { id: 612, bundle: 'B', lane: 1, start: 31.4, weeks: 0.2, priority: 'low',    status: 'done',   title: 'Drag-resizable /primitives left sidebar (160–560px, persisted; double-click resets) so long primitive names are readable.' },
    { id: 616, bundle: 'B', lane: 1, start: 33.6, weeks: 0.5, priority: 'high',   status: 'done',   title: 'Profile popup redesign: ~20% smaller, vertical editor|coords-table split, searchable shape DROPDOWN (thumbnail-as-you-type) replacing the preset "tabs" + <select>; applied to leaf + composite popups.' },
    { id: 617, bundle: 'B', lane: 1, start: 34.1, weeks: 0.5, priority: 'high',   status: 'done',   title: '"+ new primitive" sidebar popup (FloatingPanel, not native prompt): name + searchable r_* BASE picker → composes the r_* via meta.uses + a NAMED instance (const body = r_*(...)). Rule 20 (author from r_*, never raw cyl/tube). Tree-aware delete fix (archive basic/completions parts).' },
    { id: 618, bundle: 'B', lane: 1, start: 34.6, weeks: 0.3, priority: 'medium', status: 'done',   title: 'BODMAS tree expands intermediate composition variables (const geom = ball.add(body) → named sub-composite node; ((ball ∪ body) ∪ revolve2)).' },
    { id: 619, bundle: 'B', lane: 1, start: 34.9, weeks: 0.8, priority: 'high',   status: 'done',   title: 'Profile EXPRESSIONS: parametric profile params drivable by expressions referencing the composite params (rMajor: od/2) via the ƒ expression builder (reuse openFx, lists composite params + Math); profile arg → resolveProfile({kind, params:{exprs}}) spliced into source (no resolver change — evaluated in scope). Composite profiles; later hooks P3 custom-fn. See docs/plans/profile-expressions.md.' },
    { id: 620, bundle: 'B', lane: 1, start: 35.7, weeks: 0.6, priority: 'high',   status: 'done',   title: 'Parametric drill-pipe connection profile KINDS: drill_pipe_pin (male) + drill_pipe_box (female) in PROFILE_REGISTRY (revolve half-section computed from bore/wall=body-thickness/tjOD/lengths/taper, box adds counterbore). Pick in the profile dropdown → r_revolve renders the connection; profile visible. Kind params are a compact 2-col grid of draggable number boxes (dragNumber, no spinner arrows) like the Parts panel, live-redraw. Kinds live in src (curated library); saved dimensioned configs → volume.' },
    { id: 621, bundle: 'B', lane: 1, start: 36.3, weeks: 0.3, priority: 'medium', status: 'done',   title: 'r_threads internal/external switch (side param) + taper: external/male threads sit on the OD with ridges inward (subtract cuts the outer pin surface); internal (default) unchanged. Enables male tapered threaded joints on pin connections.' },
    { id: 623, bundle: 'B', lane: 1, start: 37, weeks: 0.8, priority: 'high',   status: 'done',   title: 'New-primitive create fixed + function-first: stub generator serialized polygon array defaults unbracketed (default: 0,0,1,0) → invalid meta → save 400; now JSON.stringify + type:polygon (pure src/lib/cad/primitive-stub.ts, unit + e2e tests). Raw r_revolve/r_extrude removed from the create picker. Fancy var-name profile inputs in the part row + top panel. Delete params from the Parameters section (FloatingPanel confirm). Optimistic-create: just-created parts show immediately despite the laggy prod list (pendingCreated/mergePending).' },
    { id: 624, bundle: 'B', lane: 1, start: 37.8, weeks: 1.2, priority: 'high',   status: 'done',   title: 'File-based P0. SHIPPED 2026-05-26: flat typed files <id>.{prim,asm}.ts + profiles <id>.{prvl,prex}.ts (mid-ext=type); prod volume MIGRATED (42 prims source.ts→.prim.ts, 4 profiles profile.json+source.ts→one .prvl.ts module); single resolver primitive-paths.ts (dual-read legacy); endpoints source/save/list/delete/restore + profiles/* rewritten. REMAINING (P0b): content-hash bake cache keyed on content+params+dep-hashes, busted on save. See docs/plans/file-based-architecture.md.' },
    { id: 629, bundle: 'B', lane: 1, start: 43, weeks: 0.5, priority: 'high',   status: 'done',   title: 'Components product DELETED (2026-05-27): /primitives is now the ONE CAD UI. Removed the /components route, all 12 /api/components/* endpoints, src/lib/cad/components/ (bundle registry + families.ts + components-l3), server/library.ts + component-loader.ts, the dead recipe chain (part-recipe/primitive-recipe/recipe-preview), /archive/**/components, and the industrial category. builder.ts kept (live preview render helpers) but detached from the bundle registry. Nav + landing → /primitives; e2e specs updated (runes/instance-ops deleted). Also finished the half-applied profile-swap refactor (▾ selector → ProfilePalette popup) + r_rotate function-first scaffold. ~22.5k lines removed.' },
    { id: 630, bundle: 'B', lane: 1, start: 43.5, weeks: 0.8, priority: 'high',   status: 'done',   title: 'stdlib primitives in src (2026-05-27): r_revolve + r_extrude moved OUT of the volume INTO src/lib/cad/stdlib/ (git-tracked, type-checked, READ-ONLY), made FUNCTION-ONLY parametric (type:profile → profile selector + lifted params, no vertex grid). New stdlib registry (src/lib/server/stdlib.ts; import.meta.glob ?raw → source baked into build, no runtime COPY) + dual-source resolver: /api/primitives/{source,list} serve stdlib FIRST + dedupe volume copies; save/delete refuse stdlib ids. Dedicated read-only "stdlib" sidebar group (blue src tag). Create picker now offers r_revolve/r_extrude function-first bases (buildFnProfileStub wraps the stdlib base w/ a profile-selector param); r_rotate retired + archived; volume r_revolve/r_extrude archived. ALSO unfroze Railway: a stale Dockerfile COPY of the deleted src/lib/cad/components broke image assembly (Vite build passed) → auto-deploy restored. See memory stdlib_primitives_in_src + dockerfile_stale_copy_freezes_deploy.' },
    { id: 631, bundle: 'B', lane: 1, start: 44.3, weeks: 0.6, priority: 'high',   status: 'done',   title: 'Self-contained function-profile parts + part-building fixes (2026-05-27): a revolve/extrude part now carries its profile INLINE (const X_profile = resolveProfile({kind,params}) → r_revolve(X_profile, dial)); the profile + params live ON the part (selector in the accordion head + ✎ fn editor), NOT lifted to the top Parameters section. Fixes: (1) loadPrimitive scaffolds the inline profile for r_revolve/r_extrude (was the dead r_rotate branch; generic path String(obj)d the descriptor → [object Object] → 400, blocking a 2nd revolve); (2) defaultArgFor emits resolveProfile() for object defaults; (3) buildFnProfileStub create stub = empty meta.params + inline profile; (4) fetchLeafProfile detects type:profile; (5) recognize errors are a non-destructive banner (keep the last-good accordion); (6) swapPartProfile repoints the kind in place (no regenRevolveSource → no appliedArgs desync → re-renders); (7) loadProfileBuild merges each VOLUME profile’s own d.params defaults (else resolveProfile({kind}) with partial params → NaN → "Not manifold"; all revolve profiles are volume-materialized). Shipped 2373f6f + 41c4acd. See memory self_contained_profile_parts.' },
    { id: 632, bundle: 'B', lane: 1, start: 44.9, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Color-by-source rendering (2026-05-27 evening; 397d44b..3d6df51): each part colored by its r_* source via Manifold mesh relation (runOriginalID/runIndex) — survives CSG + calculateNormals + cut-box subtract. Stamped with hashId (part-id.ts FNV-1a, biased into the 0x40000000..0x7FFFFFFF source band); LUT built by analyzeParts (server/part-colors.ts); applied to live mesh + GLB bake (cut walls = body color, not the tool color). Per-part outer/inner colors via two swatches in each accordion title (square=outer, circle=inner) → meta.instanceColors[name]={outer,inner}.' },
    { id: 633, bundle: 'B', lane: 1, start: 45.3, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Drill-pipe spec profiles + r_threads threadType (2026-05-27 evening): drill_pipe_pin profile trimmed 9→5 params (std upset + 45° nose); NEW dp_spec_pin (pipeOD/jointOD/wall→ri, flat jtUpset shoulder, 45° upset + 5° thread taper, thread length DERIVED — terminates at ri+wall); NEW dp_spec_box (counterbore + flat internal makeup shoulder, faces UP). r_threads adds threadType selector (NC38/NC40/NC46/NC50/FH — presets form + OD; values APPROX, refine vs API 7-2).' },
    { id: 634, bundle: 'B', lane: 1, start: 45.7, weeks: 0.4, priority: 'medium', status: 'done',   title: 'Inspector UX polish (2026-05-27 evening): one-click searchable profile selector (grid, not nested combobox); viewport-clamped FloatingPanels; ProfileFnEditor "Save" leftmost + red dirty button; vertical/trapezoidal Build/Source/AI tabs + shared icon action bar (Delete/Save/Save as/Save defaults/Duplicate w/ tooltips). Fixes: edge outlines re-added to live canvas; uniqueInstName guards <name>_profile companion; live profile params from inline descriptor; defaultsDirty pill ("Save defaults" when applied≠source defaults); GLB warp-on-load gated by scene.warpEnabled.' },
    { id: 635, bundle: 'B', lane: 1, start: 46.1, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Connection-datum layer (2026-05-28, ad76ffc): ref(m, head, tail) declares a part\'s connection planes; head(m)/tail(m) read them (fallback = bbox faces); mate(a, b, gap)/align(b, aZ, bZ) chain. mv() carries _refHead/_refTail under translate. The structured-wiring path that powers dp_joint (box+pipe+pin stacked via mv(b, [0,0,tail(a)])) and dp_stand. Sandbox-injected via primitive-sandbox.ts.' },
    { id: 636, bundle: 'B', lane: 1, start: 46.4, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Vertical Z-pan camera slider (2026-05-28, M1, 89b6c9a): vertical range slider on the canvas\'s left edge drives scene.zFocus. OrbitControls target follows ([0,0,zFocus]) and the camera position pans by the same delta — composes with orbit; pure pan along Z. Useful for tall assemblies (dp_stand, dp_inst_stand). ⊙ button resets.' },
    { id: 637, bundle: 'B', lane: 1, start: 46.6, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Sidebar folder glyphs + sharpened titles (2026-05-28, C, b2a246c + 98c9b44): Heroicons folder/folder-open glyph (amber) on group/family headers (open vs closed signals expand state). ▾/▸ caret removed (the folder glyph IS the signal). Titles black #1a1a1a, 14/13px, antialiased — file-manager look.' },
    { id: 638, bundle: 'B', lane: 1, start: 46.8, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Move parts between folders from the sidebar (2026-05-28, B, 3e280b0): new /api/primitives/move?id&to endpoint (atomic fsp.rename via primitive-paths.findPrim; EXDEV-safe copy+unlink fallback; refuses stdlib ids 403; allowlists basic | archive | completions/<family>). UI: 📁 picker per part row (FloatingPanel folder list, current folder excluded). Since location = category (Rule 16), the move regroups the part in the sidebar. Added to VOLUME_PROXY_PATHS (single live store).' },
    { id: 639, bundle: 'B', lane: 1, start: 47.2, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Vertical sidebar section tabs (2026-05-28, E, f0948b6 + 5b75748): three trapezoidal, vertical-text tabs in the sidebar — Primitives (Profile builder + stdlib + Basic) · Components (Completions families, flattened — no outer wrapper) · Archive (always visible, empty state when none). Editor-rail format (clip-path trapezoid, writing-mode: vertical-rl, narrow 24px rail). Profile-builder link moved from header into the Primitives tab. Active section persists in localStorage. Tabpanel scrolls; vrail stays fixed.' },
    { id: 640, bundle: 'B', lane: 1, start: 47.6, weeks: 0.5, priority: 'high',   status: 'done',   title: 'place() instancing + dp_inst_stand (2026-05-28, A, 629a04f): new place(parts) sandbox helper → Manifold.compose (a purely topological combine, NO boolean union). Parts stay SEPARATE bodies ("connected/placed, not fused") and each keeps its source originalID so color-by-source survives. dp_inst_stand on the volume = BUILD dp_joint ONCE + N cheap translates + place(); geom cost FLAT in joint count (~58ms vs dp_stand\'s 147ms 3× build + union, growing linearly). finalize still scales with total triangles (the Phase-2 boundary). Spike TEST 5 (scripts/spike_csg_originalid.ts) verifies compose preserves per-body originalID + survives cutaway. Also documents: translate() reads originalID()=-1 but PRESERVES the mesh-relation id (mv keeps colors).' },
    { id: 641, bundle: 'B', lane: 1, start: 48.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Repeat × N construction-tree node (2026-05-28, D Phase 1, 461af39): recognize-composite spots the canonical instanced-assembly idiom (const ARR = []; for (let i=0; i<N; i++) ARR.push(mv(<inst>, [0,0,<step>])); return place(ARR);). New RecognizedRepeat exposes { arrayName, instName, countText, stepText + source spans }. ConstructionTree renders a green ⟳ "Repeat × <count>" node with the inner instance as child + Δz badge. dp_inst_stand now shows as Repeat × p.joints over joint :dp_joint. The count is already a live param so dragging the joints slider IS editing the loop count — visualization was the missing piece.' },
    { id: 642, bundle: 'B', lane: 1, start: 48.5, weeks: 0.2, priority: 'medium', status: 'done',   title: 'forge branch merged into main (2026-05-28, 0b1b6b3): the parked image→3D exploration brought onto main — /forge route + src/lib/forge/{pipeline,types}.ts + /api/forge/generate (FAL Hunyuan3D v2, REST, no SDK). Nav + landing get a Forge entry. Half-built — needs FAL_API_KEY in Railway when actually used. forge branch backed up to origin/forge as a safety net before merging. Auto-merge was clean (no conflicts) + build verified before the merge commit.' },
    { id: 646, bundle: 'B', lane: 1, start: 50.2, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Subfolders inside completions/<family>/ + 📁+ folder-create button + dp_test_* parts (2026-05-28, ddbcab5 + 4c6a7ee). primitive-paths.findPrim walks a 3rd level; /api/primitives/list returns completionSubfolders so empty folders surface; save/move TARGET_RE accepts the nested form. UI: per-family 📁+ FloatingPanel POSTs /api/volume?action=mkdir (no new endpoint), nested fold per subfolder in the sidebar, move-to-folder picker includes subfolders as targets. Test parts authored to primitives/completions/drill_pipe/test/ on prod: dp_test_2_7_8_g105_nc31, dp_test_4_5_g105_nc46, dp_test_4_5_20_g105_nc50 (Perforator API spec rows pp 6-7, 14-15, 16-17) + dp_test_hwdp_5_spiral (3 helical wear pads via r_threads at wide pitch + 120° rotations).' },
    { id: 647, bundle: 'B', lane: 1, start: 50.6, weeks: 0.6, priority: 'high',   status: 'done',   title: 'Visual loop (repeat row) in the profile editor — D3-join style without D3 (2026-05-28, 2659296 + 352bec5 + bbc48d3 + 6df44f6 + c0ff807 + 83a152e). + repeat cmd added to ProfileFnEditor Move type with a/b/c = count, x(i), y(i). composeSource emits Array.from spread when any repeat row present (mixed with mv/line static rows). parseBody Phase 2 recognizes Array.from({length: N}, (_, i) => BODY) — inline + block-with-local-calcs forms — with chained-calc inlining to fixpoint; parseCalc fixed to track brace depth (was leaking inner callback consts as top-level). Stacked layout: N + cmd + delete on row 1, x(i) and y(i) each get their own full-width row with monospace 13px for math readability. Three polar-pattern volume samples on prod: ngon_v2 (uniform r), star_v2 (alternating r via i%2), gear_v2 (sinusoidal rBase + amp*cos(teeth·θ)) — all decompose into one editable repeat row + render correctly (6/10/96 points). Curated Ellipse also decomposes into one repeat row with rMajor*cos((i/n)·2π) / rMinor*sin((i/n)·2π).' },
    { id: 648, bundle: 'B', lane: 1, start: 51.2, weeks: 0.3, priority: 'medium', status: 'done',   title: 'Cartesian profile fix + parseBody return-array decomposition (2026-05-28, 4c6a7ee + 05fa017 + e95a97c). ProfileFnEditor DEFAULT_BODY + seedRows fallback branch on the `set` prop — cartesian + New profile now scaffolds a centered {w, h} rectangle (was the revolve half-section + r/len, which threw "build(p) must return ≥ 3 [r,z] points"). profile-fn validator error message neutralized to mention both axes. parseBody extended to extract structured moves from a tail return-array literal (rect/l/t/plus/cylinder/tube/cone/barrel/drill_pipe_pin all decompose). Procedural bodies (ellipse/ngon/star before K.47) preserved verbatim by composeSource so they still render via /profiles/resolve.' },
    { id: 649, bundle: 'B', lane: 1, start: 51.5, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Basic subfolders (Revolved / Extruded / test_primitives) + 6 extrude samples (2026-05-28, e96201e). /api/primitives/list returns basicSubfolders[] + tags entries with subfolder; save/move regexes accept basic/<sub>. Sidebar Primitives tab Basic group nests subfolder folds the same way Components families do; 📁+ button mirrors the per-family one; mkdir popup generalized to take parent ∈ {basic, completions/<family>}. Volume reorg on prod: 9 existing r_* → basic/revolved/; 6 extrude samples authored to basic/extruded/ — r_cube_ext (rect), r_cylinder_ext (ellipse), r_hex_prism (ngon_v2 polar), r_star_prism (star_v2 polar), r_gear_prism (gear_v2 polar), r_l_beam (l cartesian); basic/test_primitives/ empty playground. All six preview-build end-to-end against r_extrude(profile, length).' },
    { id: 654, bundle: 'B', lane: 1, start: 52.3, weeks: 0.6, priority: 'medium', status: 'done',   title: 'Visual Repeat block for Array.from + place(ring) at the PARTS layer (sister to K.47 at the profile layer). Today w_test_ring_of_pegs / w_test_cube_grid / w_test_bolt_row author the polar/grid placement idiom directly in source — `const ring = Array.from({ length: p.count }, (_, i) => { const a = (i / p.count) * 2 * PI; return mv(peg, [cos(a) * p.ring_r, sin(a) * p.ring_r, 0]); }); return place(ring);` — and the user has to mentally simulate what each `i` produces. The recognizer already spots a Repeat × N node in the ConstructionTree (D Phase 1, K.45, dp_inst_stand case) but the Parts/Composition editor does NOT yet expose it as an editable visual block the way the ProfileFnEditor does for repeat ROWS in 2D profiles. Goal: lift the parts-layer Array.from idiom into a first-class visual block. Three halves: (a) RECOGNIZE — extend recognize-composite.ts to detect the Array.from({length}, (_, i) => …) form WITH inline calc consts (currently only for-loop), capturing {count, perInstance: {translateX(i), translateY(i), translateZ(i), rotX(i), …}, basePart}. (b) RENDER — new RepeatBlock row in the Parts accordion of PrimitiveView with editable count + x(i)/y(i)/z(i)/rot(i) expression slots (textareas, same monospace style as K.47), small ⓘ helper with common patterns (linear, polar ring, polar disk, cartesian grid, fibonacci spiral, helical). (c) ROUND-TRIP — composeSource emits the same Array.from + place(...) shape back so the source stays hand-editable. Connects to deferred D Phase 2 (repeat_with_data heterogeneous, memory `todo_*` notes) — same visual block, the loop pulls from a data array instead of a literal range. One dimension up from K.47 (2D points) to 3D placement.' },
    { id: 657, bundle: 'B', lane: 1, start: 54.2, weeks: 0.1, priority: 'low',     status: 'done',   title: 'A/B/C instance naming on drag-into-assembly + Mesh-Live label drop in legacy view (2026-05-29, NEXT). Per user — short alphabetical instance names (Excel-column-style: A, B, …, Z, AA, AB, …) in place of the current childId-derived ones (rod_4, my_try_extreude2). Easier to read in chained .add(A).add(B).subtract(C) expressions. Plus the \"Mesh (live)\" label chip in PrimitiveDualCanvas now hidden in the legacy AssemblyEditor view (already hidden in the typed-builder dispatch). Only one scene per pane so the label is visual noise.' },
    { id: 662, bundle: 'B', lane: 1, start: 54.5, weeks: 1.0, priority: 'high',   status: 'done',   title: 'Assembly composition model overhaul: lists-are-groups + per-row CSG chain + nested sub-lists + import/expression rows (2026-05-29..31, six commits 72786dc / 5fbb96f / b8c0de5 / 7a8e2fd / 247a9d2 / b3206aa). User-driven model shift away from K.56-D\'s single-op-per-row pill (▢add ▣subtract ◫intersect ▤place) which was unintuitive once the "list IS group" mental model was on the table. NEW MODEL — what the user sees in source: `return [A, B];` is the canonical compose (sandbox auto-place wraps any returned Array in a recursive Manifold.compose); CSG ops are authored as a LEFT-to-RIGHT chain per row (`const A = A_raw.subtract(B).intersect(C);`); groups are inner arrays (`[A, [C, B, D.intersect(E)]]` ⇒ nested place()). PHASE E.1 (72786dc) — sandbox wrapper installed in buildPrimitiveGeom auto-places Array returns recursively; Instance.ops {op, arg}[] data field; two-pass emitter (PASS1 `const NAME_raw = <placement>` + downstream tail/head refs lock onto `_raw` so a .subtract doesn\'t crop the column\'s stacking math; PASS2 ops chains); Instance.hidden field excludes operand-only rows from the return list; backward-compat migration on parse lifts legacy `op:\'subtract\'|\'intersect\'` to the previous row\'s ops chain + marks operands hidden. PHASE E.2 (5fbb96f) — per-row ⊕⊖∩ mini-toolbar: click an op button opens a FloatingPanel typeahead listing sibling row names; pick one and it appends to Instance.ops; existing ops render as `[∆ C ×]` chips with × to remove; auto-hide on append + auto-un-hide when the last reference is removed; 👁 toggle on hidden rows to also show them in the scene as an override; the single-op `<select>` and the currentOpForInstance / setInstanceOp helpers are GONE. PHASE E.3 data (b8c0de5) — Instance.children?: Instance[] for nested groups; recursive emit walks groups depth-first (children first, then `const NAME = [child names];`); sequential mate cursor is LOCAL to each group (entering resets, exiting locks onto the last visible child\'s tail); ops chains + overlay anchors cross groups freely (every binding in the same function scope); parser STRIPS `children: [...]` BEFORE other field scans so a regex field-getter doesn\'t reach into nested rows and pull a child\'s src/args up to the group; walkInstances / flatInstances public iterators. PHASE E.3 UI (7a8e2fd) — `+ Group (sub-list)` button at the top of the add-part popup creates an empty {children: []} at top level; group marker rows render as `🗂 G [B] [C] ✕` chips in the Sequential subtab; ✕ deletes the group AND promotes children back to top level so nothing\'s lost; filteredAsmParts excludes any row inside a group\'s children list. PHASE E.3.1 (247a9d2) — drag-into-group: 🗂 group markers become drop targets for the existing instance drag MIME (\'application/x-instance-name\'); drop a row onto a group → it reparents as last child; each child chip gains a ↗ button to promote back to top level; immutable tree manipulators removeFromTree / findInTree / moveIntoGroup / moveToTopLevel land in the data layer. PHASE E.4 (b3206aa) — IMPORT (alias) + EXPRESSION rows: user-proposed model shift. The classic tube case collapses from two atom instances + ops chain to ONE import (\`{name:\'A\', kind:\'import\', src:\'shaft\'}\` → \`const A = shaft;\`) + ONE expression (\`{name:\'tube_body\', mode:\'custom\', expr:\'A(p.od,p.len).subtract(A(p.id,p.len))\'}\` → \`const tube_body = A(p.od,p.len).subtract(A(p.id,p.len));\`). Recursive expressions fall out for free — each row binds a name in scope so later expressions reference earlier ones (\`whole = core.add(wing)\`). The + popup gains stacked buttons: 🗂 Group / 📥 Import (with sub-mode "pick primitive to alias") / ƒ Expression. Definitions section (blue) renders import rows above the subtabs; Expression section (amber) renders custom rows with inline blur-commit textarea. Bake-verified end-to-end: tube_new shape via /api/primitives/bake-preview 25532 bytes visible. DEFERRED to E.3.2 — RECURSIVE NESTED ACCORDION RENDERING: render each group\'s children as full per-row accordions inside the group\'s body (their own ops bar / mode pickers / drag handles / color swatches), not the flat chip list; needs a Svelte 5 snippet `{#snippet renderRow(inst, depth)}` that recursively renders + the per-row machinery extracted into a reusable inner snippet (~200 lines of markup extraction). DEFERRED to E.4.1 — expression-row authoring polish: typeahead autocomplete on sibling names + known methods (.subtract / .add / .intersect / mv / rot / tail / head / p.*); syntax highlight; live error annotation. DEFERRED to E.3.3 — DRAG-TO-SIBLING-GROUP (move a child from group A directly into group B); GROUP-LEVEL ops on the group ITSELF (\`const G_raw = [B, C]; const G = G_raw.subtract(F);\`) since groups are first-class composables too. All deferred items are pure UI/polish on the data-layer foundation (b8c0de5 + b3206aa shipped the runtime); they\'re independent of further runtime work. Bake regression baseline confirmed at each phase: legacy flat assemblies still produce 297712-byte GLB through the new wrapper; new-shape assemblies bake equivalently or better. Tracks K.56 → K.62 evolution; supersedes the per-row op pill model from K.56-D entirely (the op-pill markup is removed from PrimitiveView).' },
    { id: 659, bundle: 'B', lane: 1, start: 55.5, weeks: 0.4, priority: 'medium', status: 'done',   title: 'Implement `taper` in r_weld_extrude (DONE 2026-06-02, commits 947a72d + 6c8eb80). Wired the long-dropped 5th arg through CrossSection.extrude\'s scaleTop tuple (the Vec2 `[s, s]` form works fine WITHOUT a follow-up .warp — the bug we deferred for was the scalar-1 + warp combo, memory: manifold_extrude_scaletop_warp_bug). Branch matrix on (twist, taper): tw=0/tp=0 → bare extrude(h); tw=0/tp≠0 → extrude(h, 1, 0, [s, s]) where nDivisions=1 + non-1 scaleTop sidesteps the coincident-slice degeneracy; tw≠0 → twist morphing with or without taper. Followup (6c8eb80) moved the formula INTO the part body — buildExtrudeSource now emits `const scaleTop = [1 - taper, 1 - taper];` so users can see + edit the math directly; r_weld_extrude gained an optional 7th positional scaleTopOverride that wins over the legacy taper-only path. Sign flipped to drilling convention (positive taper narrows the bottom, classic shaft / drill-bit shape). taper schema gained `unit: \'\'` so the dimensionless scale factor stops being tagged as mm. The loader-side sig-rewrite was also fixed to preserve trailing optional args past meta.params (otherwise scaleTopOverride got stripped, fix landed in same commit chain). Verified via /tmp/probe_taper2.ts on a rect profile: taper=+0.5 narrows bottom (0.375 vs top 0.75), taper=-0.5 flares bottom (1.125), taper=0 straight prism. Existing parts (taper=0 by default) unaffected; existing parts with non-zero taper get the new behaviour through the legacy fallback path. The user observation that prompted the fix: "the taper does not work in the assembly". Hand-wound rail-weld variant (the K.50(b)\' alternative described in the original plan note) is still future work IF non-linear per-v taper is needed (the per-v multiplicative form mentioned there).' },
    { id: 660, bundle: 'B', lane: 1, start: 56, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Atomic rename for primitives (file + meta.id + meta.name + function-name + downstream uses all in one operation). Today the rename operation surfaced via the GUI / volume PUT only changes the FILENAME (`tube.asm.ts` → `tube_new.asm.ts`). The source body still says `id: \'tube\'`, `name: \'tube\'`, `export function tube(od) {...}`, AND every assembly that already declared `uses: [\'tube\']` keeps pointing at the OLD name. The downstream effect when nesting: the loader\'s `p`-injection regex (primitive-loader.ts:140-146) matches `function NAME(args)` where NAME = the requested-id. After a partial rename, NAME (`tube_new`) doesn\'t match the function-name (`tube`), so the regex doesn\'t inject `const p = {od};` and the body throws `"p is not defined"` at runtime as soon as it tries to read `p.od`. Standalone bake superficially worked (sometimes — depending on whether `p` was needed) which made the bug INVISIBLE until nesting surfaced it. Plan: NEW endpoint `/api/primitives/rename` that takes `{oldId, newId}` and atomically (a) walks every `.asm.ts` / `.exp.ts` / `.rev.ts` on the volume, rewrites `uses: [...]` entries that mention oldId + every `oldId(...)` call site in the body → newId; (b) opens the target file, rewrites `id: \'oldId\'` → `id: \'newId\'`, `name: \'oldId\'` → `name: \'newId\'`, AND `export function oldId(` → `export function newId(`; (c) renames the file. All three under one temp-file+rename txn so partial state is impossible. Surface in the GUI as a ✎-name button on the primitive\'s title chip; a confirm popup lists the N downstream assemblies that will be rewritten before applying. Also handle the collision-detection edge — if `newId` already exists OR is a SANDBOX_ARG_NAMES helper, refuse with a clear message. Surfaced 2026-05-29 when the `tube` collision investigation forced an in-flight rename to `tube_new`; ate ~30 minutes of debugging before the function-name mismatch was visible. Pairs with K.59 / K.61.' },
    { id: 669, bundle: 'B', lane: 1, start: 61, weeks: 1.0, priority: 'high',   status: 'done',   title: 'Vocabulary editor /vocab + boolean_modify rule + 41 completion seeds + mule_shoe exemplar (2026-06-06, pushed d3b696e..9ef94e9). First wave of K.68 phase 1 lands as a working editor + a new rule kind. 41 completion-parts seeds ingested from SVTC `comp_list.xlsx` into `docs/parts/vocabulary.seeds.json` (57 catalogue rows → 41 unique terms; multi-size variants kept in `variants[]`; 39 carry `compjson_ref` to the matching 2D silhouette at `static/svtc-compjson/*.json`, 72 files ~2.9MB). New script: `scripts/sync-svtc-compjson.ts` + `scripts/ingest-comp-list.ts`. /vocab page rebuilt as the vocabulary editor: Topology / Browse left tabs; right pane has Inferred / Proposed vertical trapezoidal rail (matches /primitives chrome), 30/70 outer split + 40/60 inner split (canvas / params+rule details). Definition + chip groups encapsulated in a ⓘ Definition & tags popover so the tab body focuses on params + 3D bake. Inline Bake + Promote in the title row. Parameters use ParamGrid in a .pg-acc-wrap accordion (identical to /primitives Build tab). Layout contracts captured in src/routes/vocab/CLAUDE.md (the zoom-loop bug fix from display:flex column + flex:1 1 auto + min-height:480px on .bake-body — needed to prevent the canvas auto-fit feedback loop). 2D→3D inference pipeline: `src/lib/authoring/compjson-to-profile.ts` reads SVTC compjson half-section drawings (LEFT = section cut / bore, RIGHT = OD silhouette), classifies elements by x-midpoint, transforms the dominant section polyline to [r,z] pairs via OD-calibrated scale. Pure deterministic, no ML weights. Tested live on 4 seeds: mule_shoe 5-vert chamfered tip, tubing_pup / flow_coupling plain cylinders, nipple_r_landing auto-captures 4 landing grooves on the OD as alternating r-bands. New `boolean_modify` rule kind: `src/lib/authoring/proposal-translator.ts` translates `proposed-vocab-entries.json` entries into source. Rule body = a polygon_inline primitive + a `modifiers[]` chain of {op, shape}. First shape: tilted_slab (rectangular slab whose top face is the cut plane, rotated around an axis by an angle, anchored at a Z — carves one half-space). First use: mule_shoe\'s 45° angled bottom cut on a hollow tube + box top. Future shape slots: cylindrical_hole_ring (perforated pups), thin_slot_ring (slotted liners), lateral_pocket (side-pocket mandrels), j_slot_grooves (indexing). Each new shape = a multiplier across many parts. mule_shoe end-to-end as the exemplar — bakes to 3456 verts · z=9 · r=2 with the slanted cut visible. Endpoints: POST /api/vocab/infer?term=<slug>, POST /api/vocab/bake-proposed?term=<slug> (body {params?:[]} for slider-driven re-bake), POST /api/vocab/promote-proposed?term=<slug> (writes the full entry into vocabulary.json + bumps version + saves dt_<slug>.prim.ts to volume + flips seed status to promoted). Three new CLAUDE.mds: src/routes/vocab/, src/lib/authoring/, src/routes/api/vocab/.' },
    { id: 670, bundle: 'B', lane: 1, start: 62, weeks: 1.5, priority: 'high',   status: 'done',   title: '/primitives multi-tab wrapper + GraphEditorPane extraction + UI polish session (2026-06-09, ~30 commits, c8b5a82..21338a4 + 37ce44a..e6252a2). MAJOR session: rebuilt /primitives as a multi-tab editor around the extracted GraphEditorPane.svelte (no iframes — tabs mount the component directly, isolated WASM state per tab). Sidebar of primitives groups (basic / completions / stdlib / stdstale / archived) + filter + per-tab close + persisted open-tabs state (localStorage prim-open-tabs / prim-active-tab-id). Trim chain: removed redundant "Graph editor" title above the canvas; removed the top Flowbite Navbar (CAD Train | Primitives | Vocab | Wells | FEM | Forge | Volume | Plan); content row now fills the full viewport. Layout overflow fix: `.layout` + `.prim-root` switched from `grid-template-rows: 1fr` to `minmax(0, 1fr)` (the `1fr` default of `minmax(auto, 1fr)` let canvas content force expansion to 1343px on a 598px viewport — clamped back to viewport with this + `min-height: 0` cascade). Camera/scene fix: PrimitiveDualScene auto-centers the OrbitControls target on the geometry bbox each refresh (scene.partCenter); cam.y bumped to 50; Z-pan slider range expanded -50..200. Mule_shoe build chain (the originating goal): composed via r_tube + r_cuboid + rot + mv + subtract — saved to basic/, 5 nodes, z 1.00. Profile picker authoring MVP (#119): chip on Call args that switches the profile kind via the descriptor. SRC + MD tabs in the editor right pane (#118); MD tab gains an AI icon that generates a description of the part. Vertical toolbar on the canvas left edge (+, save, bake, auto, ghost-clear, undo, ⚙ settings, reset). Push-apart with wire repulsion + boundary half-planes (#116, merged from worktree subagent). Per-card 👁 ghost mode (auto-translucent during composition); resize handles on cards (width persisted to graph.layout, snaps to label-fit floor); status badges in canvas bottom-left (save state + node count + zoom); sort dropdown for the primitive list (A-Z / Recent / Source via localStorage ge-picker-sort); profile arg detection in dep paramKeys regex (842fa8c fixed the quoted-JSON-keys bug behind the WASM "memory access out of bounds"). UX polish: ⚙ canvas-settings menu rebuilt as a Flowbite-style dropdown anchored to the button\'s getBoundingClientRect (was a wide button-list panel at hardcoded top:220px that drifted as ghost-clear/undo buttons appeared above it); two action rows (Auto-layout, Push apart) + separator + two boolean checkbox rows (Left/Right boundary repellant). + picker also anchored to its rail button\'s bounding rect + outer wrapper height:480px overflow:hidden so only the inner Call list scrolls (the CSG/Transform/Container sections stay pinned at top). Edge-bound indicators: the small circular ⏹/🔺/🔒 buttons pinned to the canvas edges were removed (redundant with the ⚙ menu checkboxes); BoundState simplified from \'off\'|\'repellant\'|\'confiner\' to \'off\'|\'repellant\' (legacy confiner persisted values read as off). /primitives sidebar gains overflow-y:auto + min-height:0 cascade so the rail scrolls when 100+ entries load. Pairs with K.69 (the /vocab editor uses the same Flowbite-style chrome); will be consolidated under K.67 (graph promotion) once the .asm.ts body becomes a derived projection.' },
    { id: 672, bundle: 'B', lane: 1, start: 64, weeks: 0.8, priority: 'high',   status: 'done',   title: 'Polygon + PolyRepeat loop architecture overhaul + sidebar UX cluster + g_* migration Round 1 (2026-06-10/11, ~30 commits e0ff295..e14f00f, 3 of 4 parallel subagents shipped clean). LOOP ARCHITECTURE (#155–#157): PolyRepeatNode as a SEPARATE node type with its own canvas card (Params · Bindings · Loop sections); polygons embed loops via {kind:\'repeat-ref\', sourceId} entries interleaving with literal vertices in any order — each ref splices N points at its row position; hydrate auto-migrates legacy inline repeats. NPts auto-injected as a const in every loop arrow body (theta = i*tau/NPts Just Works); bindings emit after NPts + cascade left-to-right per-iteration. Wire sockets: poly_repeat output (violet) → polygon per-row repeat-ref input; NPts input (amber) accepts p.<name> drops. 3-state vertex colours (red literal · violet parametric · purple loop-generated). SVG popover: ⋮⋮ drag grip + ↩ snap-back + frozen viewBox + click-to-insert with edge-hover (green/🚫) + click-to-delete. Expression popover: r/z (x/y) tab strip + ƒ on loop slots + mode-aware axis labels; mv/rot ƒ buttons route to the same shared popover. CRITICAL per-point UI rule: always entryIdxForEvalIdx(node, i) — direct points[i] silently breaks on repeat expansions (memory entry_idx_eval_idx_gotcha). Also: NaN guard in resolveProfile (mid-edit typos → degenerate geometry instead of WASM crash); usesOf + extractParamsBlock regex fixes accept JSON-quoted keys (unblocks ALL programmatic build scripts — memory json_stringify_meta_regex_traps). G_* ROUND 1 (graph-authored .asm.ts exemplars, per-part docs at docs/parts/g_<id>.md): g_spiral (flat coil, 2 interleaved loops), g_star (extruded star prism, conditional i%2 binding), g_collar (revolved hollow chamfered tube); g_dt_joint DEFERRED → K.75. SIDEBAR UX (subagent C): A↓ global alpha-sort toggle (localStorage); ✎ inline rename via POST /api/primitives/rename; broken-refs scan + repair via NEW POST /api/rag/scan-refs (toast after rename lists N dependents + [Repair all] rewrites their src:\'<old>\' refs); drag-from-sidebar onto canvas creates a Call seeded with meta.params defaults at the drop point (clientToCanvas inverts pan+zoom); call-card title hyperlink opens that primitive in a new tab (onOpenTab). Detail: memories polygon_repeat_loop_architecture + session_handoff_2026-06-11.' },
    { id: 673, bundle: 'B', lane: 1, start: 64.6, weeks: 0.4, priority: 'high',   status: 'done',   title: 'RAG generative authoring Phases 1 + 2 — describe a part → graph in a tab (2026-06-11, f144c81..5355374). The L2-cache slice of K.68 realized as a working prompt→part loop. PHASE 1 (subagent B): corpus extractor src/lib/server/rag-corpus.ts walks the volume parts → one JSONL record each ({id, kind, description, tags, params, structure_summary}) at <volume>/ai/rag/parts.jsonl; POST /api/rag/rebuild + GET /api/rag/stats; ↻ rebuild button next to the sidebar filter + quiet "RAG corpus · N parts · Xm ago" footnote. Prod corpus = 29 records on first rebuild. PHASE 2 (5355374; modules salvaged from crashed subagent D\'s worktree): src/lib/server/rag-query.ts — corpus loader + pure BM25 (k1=1.5 b=0.75, doc text = description+tags+structure, zero-score cutoff) + topK(query, 5); src/lib/server/rag-prompt.ts — system prompt teaches the graph schema BY EXAMPLE (trimmed g_spiral literal: polygon + poly_repeat + call + params) + hard JSON-only rules, user prompt = top-k exemplars one-line each + the description; NEW POST /api/rag/prompt — BM25 → one Claude call (RAG_MODEL env, default claude-sonnet-4-6) → parseJsonLoose → validated {id, candidates, graph}. Proxied to prod in VOLUME_PROXY_PATHS (corpus + ANTHROPIC_API_KEY live prod-side; X-Volume-Local forces local). UI: violet ✨ prompt input under the sidebar filter row — Enter generates; the proposed graph opens in a NEW tab via the seedGraph prop (GraphEditorPane hydrates + auto-layouts it INSTEAD of fetching by id; exemplarId pre-set so first Save lands under the suggested name; volume untouched until then; seeded tabs excluded from tab persistence). Footnote doubles as status (generating… / from: <exemplar ids> / error). Verified live: "hexagonal prism with a central round bore" → g_hex_prism_bore with hex + bore poly_repeat loops, param-wired across-flats + length + subtract node. PHASE 3 (embeddings) deferred until the catalog passes ~200 parts. Plan doc: docs/plans/rag-prompt-builder.md.' },
    { id: 674, bundle: 'B', lane: 1, start: 65, weeks: 0.3, priority: 'medium', status: 'done',   title: 'Stability fixes + instruction-surface modernization (2026-06-11 PM, 3c3d4c6..15697d5). FOUR FIXES from live use: (1) polygon card socket alignment (#168) — left-edge r/z + repeat-ref sockets assumed uniform 39px rows but CSS renders vertex rows at 45px / loop-ref rows at 38px; new polyRowTop() cumulative walk mirrors the CSS; wires + auto-height use it. (2) WebGL context budget (#169) — only the ACTIVE /primitives tab mounts PrimitiveDualCanvas (new `active` prop); inactive tabs keep all editor state but release their context (renderer.dispose + forceContextLoss on unmount); module-scope LRU fetch cache (12 entries, keyed on full request body) makes switching back instant with zero server round-trips. CLOSES the long-standing todo_webgl_context_leak (~16-context browser cap). (3) profiles/resolve 400 spam (#170) — both resolve $effects re-fire every render; identical request bodies are now skipped (bakeNonce still forces retry). (4) infinite-loop regression fix (84dc204) — the fetch cache made rebuilds synchronous, closing an identity-churn loop on the fresh-args prop → effect_update_depth_exceeded; rebuild effect now keys on serialized {id, args, source} content. Canonical pattern in memory fresh-array-props-effect-loops (same trap as the /vocab zoom loop). DOCS MODERNIZATION (Fable-5 era cleanup, background agent + main session): root CLAUDE.md rewritten ~330→158 lines — current architecture snapshot (GraphEditorPane one-editor-two-surfaces, stdlib/stdstale, tracked archive/), deduped rules with stable numbers, shipped-session ledgers moved to NEW docs/HISTORY.md; api/shared/cad CLAUDE.md refreshed vs actual code; MEMORY.md index trimmed 28.5KB→8.3KB (grouped by theme; topic files kept on disk). HYGIENE: all 12 stale agent worktrees removed + 18 merged/superseded branches deleted local+GitHub (verified each for unmerged work first); kept refactor/strip-old-composite-editor (5 unmerged commits = the K.65 strip starting point); salvaged g_dt_joint.md + build_g_parts.ts from failed agent A\'s worktree (→ K.75).' },
    { id:  8, bundle: 'A', lane: 0, start: 65.4, weeks: 0.3, priority: 'low',    status: 'done', title: 'Add new primitive types as drilling needs surface' },
    { id: 512, bundle: 'A', lane: 0, start: 65.4, weeks: 0.2, priority: 'high',   status: 'todo',   title: 'AI refine Level 2: post-generation validation in the refine endpoint (imports allowlist · denylist scan · undefined-instance detection · syntax check · optional live-bake · retry-once-with-errors-fed-back). PARTIAL: validateRefinedSource() + retry-once loop already exist in refine/+server.ts, but only check meta-extract / meta.id-unchanged / fn-name==id. LEFT: imports allowlist, denylist scan, undefined-instance detection, live-bake.' },
    { id: 676, bundle: 'B', lane: 1, start: 65.4, weeks: 0.2, priority: 'high',   status: 'done',   title: '✨ generate UX relocation + auto-layout crash fix (2026-06-12, e990523..3b6c2a2). UX cluster from live use: (1) the ✨ AI-generate input moved OFF the sidebar onto the graph editor\'s vertical rail — a violet ✨ button CENTERED between ⚙ and reset (equal flex spacers); its popover holds the instructions + a resizable description textarea (360px default, drag-resizable 264-720px, width persisted) and CLAMPS on-screen (measures after tick, never spills below the viewport — it sits at the rail bottom). (2) Generation now hydrates the proposed graph INTO the CURRENT tab (auto-layout + exemplarId set, tab relabeled) instead of opening a new one — the user generates from the open editor and the changes land there; a bad graph shows a visible popover error, not a blank canvas. (3) Push-apart MERGED into auto-layout (one button; the redundant menu row removed) and the auto pass runs PURE separation (useBounds=false) so the viewport boundary walls — which depend on pan/zoom — can\'t fling a card thousands of px off-screen (was sending one to y=4402). autoLayoutGraph rowGap 40→160. (4) THE BIG FIX — auto-layout "does nothing" was a CRASH: composition-layout predecessorsOf() fell through to `n.children.filter(...)` for unhandled node types, but polygon/poly_repeat have NO children → TypeError → autoLayoutGraph threw → the menu onclick aborted before closing + nothing moved. Since every revolve/extrude part has an inline polygon, auto-layout was broken on ALL of them. Fixed: polygon/poly_repeat are leaf producers (return []); container branch guarded (children ?? []). Diagnosed by importing the layout module live in the dev page (`await import("/src/lib/cad/composition-layout.ts")`) and running it on g_dt_joint\'s real graph — the stack pointed straight at the line. Memory: autolayout_predecessors_polygon_crash. Remaining separation-quality work → K.78.' },
    { id: 679, bundle: 'B', lane: 1, start: 65.4, weeks: 0.3, priority: 'medium', status: 'done',   title: 'MD AI-describe wired + polygon point-order markers + expr-popover viewport clamp (2026-06-12, 9afedbc..6a1fd80). Live-use batch, attempted as 4 parallel worktree agents — all stalled on an infra watchdog ~600s, so salvaged the one that had written files (MD) + redid the rest by hand. (1) MD-tab ✨ AI describe (#117) — NEW POST /api/primitives/describe: one Claude call (DESCRIBE_MODEL || RAG_MODEL || claude-sonnet-4-6) infers a drawing-descriptor markdown (Purpose · Function · Composition · Parameter table · Drawing notes [Z-down] · See also) from the emitted source + bake stats; button replaces drawingMd, failures prepend an HTML comment so MD is never wiped. Not proxied. Verified live on dt_collar_flat. (2) Polygon point-order markers — both profile-preview SVGs (popup + right-pane) ring the FIRST vertex green with "1" + the LAST orange with the point count so winding is readable; pointer-events:none (drag/click unchanged). (3) clampToViewport action measures polyExprPop + argExprPop after paint + shifts them on-screen so the vertex-edit popover never spills off the bottom/right.' },
    { id: 700, bundle: 'C', lane: 2, start: 65.4, weeks: 0.5, priority: 'high',   status: 'open',   title: 'OAuth identity port from SVTC: Google OAuth + signed-session → event.locals.userId via sequence() in hooks (existing AUTH_TOKEN/proxy/rate-limit unchanged). Plan ready: docs/plans/oauth-identity.md. Blocked on user-provisioned Google OAuth creds.' },
    { id: 800, bundle: 'B', lane: 1, start: 65.4, weeks: 0.3, priority: 'high',   status: 'done', title: 'Spike + package validation. Add makerjs (Microsoft, MIT, pure-JS). Prove a parametric path (line + arc + fillet + Bézier spline) → model.toSVG() render → SAMPLE to (r,z) at the segments dial → bakes through r_revolve unchanged. Bench tessellation cost. DECISION GATE: Maker.js fits (chain.fillet / dogbone-chamfer / expandPaths-offset / BezierCurve / DXF + SVG export, no WASM) vs fall back to Paper.js + hand-rolled CAD ops. Alternatives ruled out for now: JSketcher (full app + constraint solver — too heavy to embed; revisit only if true geometric constraints are needed), @flatten-js (geometry lib, no editor), OpenCascade.js (massive WASM, overkill for 2D).' },
    { id: 513, bundle: 'A', lane: 0, start: 65.6, weeks: 0.2, priority: 'high',   status: 'todo',   title: 'AI refine Level 3: live-bake gate on the inspector Accept button — status pill ("✓ Builds" green / "✗ Bake failed: <msg>" red); Accept disabled on failure. Uses the existing /api/components/bake-preview endpoint, no backend changes' },
    { id: 675, bundle: 'B', lane: 1, start: 65.6, weeks: 0.4, priority: 'medium', status: 'done',   title: 'g_* Round 2 + g_dt_joint composition showcase (#167). Blocker first: the graph emit path must handle `place([...])` cleanly (multi-Call compose returning an instanced list) — that is what deferred g_dt_joint out of Round 1. Then: g_dt_joint as the multi-part graph exemplar (box + tube + pin via place/tail), seeded from the salvaged draft at docs/parts/g_dt_joint.md + scripts/build_g_parts.ts. Round 2 migrations: g_dt_stand, g_tube (consolidate dt_tube + dt_tube_v2 + e_tube into one), g_dt_collar_{flat,tapered,rounded} (style enum like template_collar). Also wire the RAG prompt-loop flywheel: each ACCEPTED ✨ generation gets saved + the corpus rebuilt (↻) so it becomes a retrievable exemplar — the compounding loop from docs/plans/rag-prompt-builder.md.' },
    { id: 801, bundle: 'B', lane: 1, start: 65.7, weeks: 0.6, priority: 'high',   status: 'done', title: 'Sketch node model. NEW `sketch` graph node (sits where `polygon` does) whose body is an ordered `ops` list, each op a param/expr-able graph entry: moveTo/lineTo (r,z) · arcTo (r,z,radius,sweep) · spline (through[]/control[]) · fillet (atVertex,radius) · chamfer (atVertex,dist×angle) · offset (dist) · mirror (axis). NEW compileSketch() runs the ops through Maker.js → a chain → samples to the (r,z) point list r_revolve/r_extrude ALREADY consume, so the bake pipeline is untouched. polygon stays as the degenerate all-lineTo case; existing polygon parts auto-migrate (each point → a lineTo op) on first open. composition-emit + hydrate round-trip. No new UI yet — author ops in the graph + verify bake parity vs the old polygon. Because ops are graph entries, a fillet radius wires to p.filletR + re-bakes live.' },
    { id: 514, bundle: 'A', lane: 0, start: 65.8, weeks: 0.2, priority: 'medium', status: 'todo',   title: 'AI refine Level 4: assembly-aware prompt — when refining a composition, glob docs/assemblies/README.md + matching <assembly>.md into the system prompt. Today nothing in src/ reads docs/assemblies/ so the AI re-invents known recipes every refine' },
    { id: 701, bundle: 'C', lane: 2, start: 65.9, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Public parts category: add `public` to LIBRARY_CATEGORIES (resolvers iterate the tuple) + visibility:public on save. Ships without identity.' },
    { id: 677, bundle: 'B', lane: 1, start: 66, weeks: 0.4, priority: 'high',   status: 'done',   title: 'L1 deterministic dictionary for generative authoring (retrieve-and-clone known parts). Surfaced 2026-06-12 when "flat collar" → blank: the prod proxy was down AND we asked Claude to INVENT a graph for a part we already have (g_collar / template_collar). The fix is the K.68 L1 tier: a curated phrase→{partId, paramOverrides} map (docs/parts/aliases.json or extend vocabulary.json synonyms). On a ✨ prompt, check L1 FIRST — exact/synonym match → load that part\'s known-good meta.graph + apply the param overrides (e.g. "flat collar" → template_collar with style=\'flat\'); 0 tokens, instant, OFFLINE (no prod proxy / no Claude), and it CAN\'T bake blank because it clones a graph that already works. Only fall through to the L2 Claude path (existing /api/rag/prompt) on an L1 miss. Incremental growth: each ACCEPTED ✨ generation that the user saves appends a phrase→savedPart alias, so the dictionary compounds (the RAG flywheel, pairs with K.75). Directly fixes the "blank known part" failure + removes the prod-proxy dependency for the common case.' },
    { id: 702, bundle: 'C', lane: 2, start: 66.1, weeks: 0.5, priority: 'high',   status: 'open',   title: 'Private per-user parts under components/<userId>/ (REQUIRES L.1): user-scoped resolvers + owner enforcement; close R2 (/api/volume path guard), R3 (private out of proxy), R4 (list-cache by userId), R5 (id-collision scoped).' },
    { id: 802, bundle: 'B', lane: 1, start: 66.3, weeks: 0.8, priority: 'high',   status: 'done', title: 'Full-tab sketch editor + dedicated toolbar. Opening/editing a sketch EXPANDS it to occupy the whole tab content (3D-bake pane collapses to a strip/toggle); ✎ Edit sketch enters, ✓ Done exits back to the graph. Dedicated left toolbar: select · line · arc · spline · fillet · chamfer · offset · mirror · dimension · snap-to-grid · zoom/fit · exit. Maker.js renders the OUTLINE (smooth arcs/splines, visible fillets/chamfers) + an interaction layer (drag points/handles, the black/white hover tooltip + point-order markers already shipped). The current popup/right-pane previews become the read-only "mini" view; the full-tab sketcher is the "max" edit view. DECISION: full-tab overlay inside /primitives (recommended — no route change, keeps tab state) vs a /sketch/[id] route.' },
    { id: 678, bundle: 'B', lane: 1, start: 66.4, weeks: 0.3, priority: 'medium', status: 'done',   title: 'Auto-layout separation QUALITY (the post-crash follow-up). K.76 fixed the crash so auto-layout RUNS, but on dense graphs (g_dt_joint) it only partially de-overlaps. Two root causes: (1) `__POLY__<id>` profile references that wire a polygon to its consumer revolve/extrude are NOT modeled as layout edges in composition-layout.ts predecessorsOf/successorsOf — so a polygon and the Call it feeds collapse into the same depth-0 column and stack. Fix: treat an arg of kind expr matching /__POLY__(\\w+)/ as a data-flow edge polygon→call. (2) nodeSize() height estimates undersize the real rendered cards (variable-height param/accordion bodies), so forceSeparate thinks cards clear when they visually overlap. Fix: measure real card heights from the DOM (.ge-node bounding boxes) and pass them as nodeSize to forceSeparate during the push-apart pass. Together these make auto-layout produce a clean, readable arrangement on the polygon-heavy parts that are now the norm.' },
    { id: 668, bundle: 'A', lane: 0, start: 67.1, weeks: 0.8, priority: 'high',   status: 'open',   title: 'Generative authoring (vocabulary → translator → multi-tier cached generation with WebGPU local LLM, supervised) (added 2026-06-05). User-driven pivot away from hand-authored parts and ad-hoc rewrites — every dp_* this session was either hand-written or imported from a legacy backup, none were GENERATED from a description, and that doesn\'t scale. THE VOCABULARY: a compositional grammar of part terms — shaft = cylindrical profile; tube = larger shaft .subtract( smaller shaft ); collar = revolve profile with locally-larger OD; pin = shaft + tapered nose; box = tube + counterbore (female complement of pin); joint = ordered composition of pin+body+box via tail() datum; stand = N joints stacked. Each entry has a definition, synonyms (RAG aliases), a structured rule (in the K.62 IR shape — imports + composition tree + param mapping), an exemplar part id, and expected bake metrics. THE TRANSLATOR (`src/lib/authoring/rule-translator.ts`): pure deterministic function `Rule → AsmSource` that compiles a vocabulary rule (or any rule conforming to the schema) into a runnable `.asm.ts` / `.rev.ts` via the existing `composition-tree.ts` data layer (applyToSource + addAssemblyParam + the K.62 emit pipeline). NO LLM IN THE TRANSLATOR — it\'s pure compile. THE FIVE-TIER CACHE (descending cost): L1 vocabulary term/synonym lookup (0 tokens, 0ms, client-side JSON match) → L2 cached generations vector lookup against IndexedDB authoring_cache + the existing $APP_DATA_DIR/ai/training_data pattern (0 tokens, ~50ms embed match) → L3 translator-from-rule (0 tokens, ~5ms deterministic compile when a vocab rule matched) → L4 WebGPU LLM emits a RULE conforming to the vocabulary schema (NOT raw source) and the translator compiles it (0 tokens, ~1-5s in-browser, structured-output mode for constrained generation) → L5 Claude API `/api/author` server fallback when WebGPU low-confidence or unavailable (token-cost, ~1s, highest quality). The translator is the SAME for all five tiers — rule comes from different sources but compiles the same way. CRITICAL INSIGHT: constrained generation (LLM emits structured RULE matching the schema, not raw `.asm.ts`) is dramatically smaller output + validatable + the deterministic translator handles correctness — far better than asking the LLM to emit runnable source. SUPERVISION PANEL (Phase 5 — equally critical, not afterthought): meaningful + fast human-in-the-loop oversight on every generation. Side-by-side: description input + generated rule JSON + live 3D bake preview + cited exemplars + trust signal badge ("L1 vocab hit · pin" / "L4 WebGPU · 87% confidence · 2 exemplars"). Keyboard-bound Accept (Y — caches to L2) / Reject (N — logs failure mode + opens refine) / Refine (R — edit rule fields in place, re-translate, see diff). Diff view between generations: which rule fields changed + bake-metric delta (verts, z-extent, etc.). Always reversible. The supervision panel makes generative authoring trustable + scalable — without it, the whole stack is a black-box source dumper users can\'t validate at speed. SVTC chatbot integration via the same panel: chat suggests, supervisor approves. SIX-PHASE ROLLOUT: Phase 1 (3 days) — vocabulary.json + vocabulary.md + synonym map (docs/parts/), with the dp_test pipeline parts (shaft/tube/collar/pin/box/joint/stand) as the first rule set. Phase 2 (3 days) — rule-translator.ts + regenerate every dt_* part from its vocab entry as the validation contract (translator passes iff bake metrics match the manual baseline). Phase 3 (2 days) — client-author.ts orchestrator with L1+L2+L3 wired (IndexedDB / training-data cache for L2). Phase 4 (4 days) — WebGPU LLM integration: model selection (Mistral-7B-Instruct via web-llm, Llama-3-8B-Instruct, or a domain-tuned small model), structured-output constrained decoding for the rule schema, prompt engineering with vocab + retrieved exemplars as context. Skipped gracefully when WebGPU unavailable (falls to L5). Phase 5 (3 days) — supervision panel UI inside CompositionEditor; side-by-side preview; diff view; keyboard shortcuts; trust signals. Phase 6 (2 days) — /api/author server (Claude) as L5 fallback + the SVTC-style chatbot panel binding. WIN: a "drill pipe pin, 4 1/2" OD, NC50 thread" description hits L1 (vocab match on "pin") → translator generates source from the pin rule → user supervises (≤1s of input) → cached for next time. Repeat description = 0 tokens, 50ms total. Novel description = WebGPU 1-5s offline → cached. Token-expensive Claude calls only for hard cases. REPLACES the hand-rewrite anti-pattern observed during the dp_test session (every non-curated profile triggered an ad-hoc `/tmp/dt_*_swap.ts` script — the right architecture pushes that into the vocabulary + lets the system absorb new rules over time).' },
    { id: 803, bundle: 'B', lane: 1, start: 67.1, weeks: 0.6, priority: 'medium', status: 'done', title: 'Operator UX (SHIPPED). Direct-manipulation sketch operators in GraphEditorPane: select/line/spline/fillet/chamfer tools, click a vertex to round/bevel (cornerAtOpIdx), spline through picked points (splineDrag), each writes a sketch op + live re-bakes — turning the M.1 graph-authored operators into direct manipulation. (Offset-for-wall-thickness operator not confirmed as a discrete tool — track separately if still wanted.)' },
    { id: 804, bundle: 'B', lane: 1, start: 67.7, weeks: 0.8, priority: 'medium', status: 'todo', title: 'Pro polish (own session each). Snapping + grid; dimensions / light geometric constraints (revisit JSketcher only if dimension-driven constraints become a real need); DXF export (Maker.js native — real CAD handoff); 2D-CSG via model.combine (folds in the old K.58 SVG-CSG idea); mirror/symmetry.' },
    { id: 667, bundle: 'B', lane: 1, start: 67.9, weeks: 0.7, priority: 'high',   status: 'done',   title: 'Graph promotion: promote the composition tree + bindings to source-of-truth, demote the `.asm.ts` body to a derived projection (added 2026-06-03). Surfaced after the user observed that we are hand-rolling a reactive dataflow system on top of JavaScript source text, and the resulting bug class (silent unwired params, name-matching as a magic concept, tagManifold not propagating originalIDs, parse → mutate → re-emit text round-trips that lose information, the K.61/K.66 child-drift problems) is exactly what a graph-based parametric system makes impossible by construction. Every grown-up CAD parametric system (Grasshopper, Houdini, FreeCAD Expression Engine, Onshape FeatureScript references, Blender Geometry Nodes) converged on a dataflow graph as the source-of-truth + a text projection (or no text at all) for the same reason. K.67 is the architectural shift to that model. NEW MODEL: (1) meta.composition stays the TreeNode root from K.62/K.63 but is the ONLY source-of-truth for the assembly\'s shape — no text body fallback. (2) NEW `meta.bindings: [{ from: \'p.<param>\', to: \'<callId>.<paramKey>\' }, ...]` is the first-class edge list: each wire from an assembly-level meta.params row to a child Call\'s arg slot is an entry. Replaces the current text-substitution wiring (literal "p.length" inside a Call arg) with a typed reference object. Removing a param walks edges + warns the user about orphaned slots before deleting. Renaming a param updates every edge\'s `from`. (3) The function body is auto-emitted from the tree+bindings on every save (same as today, but the emit becomes deterministic + the reverse direction is no longer needed because edits go through the editor, not the source text). (4) NEW `src/lib/cad/composition-bake.ts` interpreter consumes the tree + bindings directly to produce a Manifold — skips the JS sandbox + new Function eval entirely for assemblies. Each Call node maps to `loadPrimitiveGeomById(call.src)` → object-args from bindings → wrapped boundary. CSG ops, mv/rot, transforms walk the tree literally. The bake stops being text-eval + becomes a tree walk, removing a whole class of "what string did this parse as" bugs. (5) The /api/primitives/save endpoint keeps writing `.asm.ts` for legibility / grep / git history, but the file format gains a `meta.graph` block carrying the tree + bindings as JSON literal — and on open the editor reads `meta.graph` IF present, falling back to the parsed body otherwise. New saves always include `meta.graph`; old `.asm.ts` files migrate on first save. (6) In the editor (CompositionEditor.svelte), wiring a param to a slot becomes a drag from the param row to the slot (or click "wire" on a slot → pick assembly param), producing an edge object — no more text-substitution-via-ƒ-popup. The ƒ popup stays for ARBITRARY expressions (Math.PI, p.od/2 - p.wall) but a simple `p.X` ref is the typed edge case. (7) Reactivity: Svelte 5 runes wrap the graph as $state — when a dial changes, only downstream Calls re-bake (we already cache builds per-dep in primitive-loader.ts, this just makes the dependency set explicit instead of derived from text). IMMEDIATE BENEFITS that fall out: (a) unwired meta.params row is impossible — adding a row that nothing references shows up as "no outgoing edges, dialing won\'t do anything; add an edge?" the moment you create it; (b) refactor / rename is a graph walk; (c) the K.66 drift detection becomes a node-property hash diff vs an embedded JS-string sniff; (d) the K.62 composition model already IS a tree — we just need to stop pretending the text body is the model; (e) the JS sandbox eval becomes optional (only for arbitrary-expression slots), making typed CAD operations type-checkable; (f) bake parallelization (K.52) becomes obvious because the graph IS a DAG. MIGRATION PATH: ship in 4 phases over 1-2 weeks: Phase 1 (3 days) — `meta.graph` JSON literal + reader/writer; CompositionEditor reads graph first, body as fallback; new saves include graph. Phase 2 (3 days) — `composition-bake.ts` interpreter; `/api/primitives/preview` routes asm parts through the interpreter when meta.graph present; A/B against existing text-eval path. Phase 3 (3 days) — typed `meta.bindings` edge list; drag-to-wire UI; ƒ popup still covers arbitrary expressions; "unwired param" warning becomes a structural impossibility. Phase 4 (3 days) — drop text-fallback path; `.asm.ts` body becomes purely a projection (read-only on disk, regenerated on every save); deprecate the parse-body-as-source flow. Each phase is independently shippable; phases 1-2 produce no UX change while flipping the engine. Replaces a long tail of patches: the K.61 child-drift cache invalidation; the K.66 child-changed alert; the silent-unwired-param bug from this session; the tagManifold mesh-options trick; the partHashId text-emit dance.' },
    { id: 805, bundle: 'B', lane: 1, start: 68.5, weeks: 0.5, priority: 'medium', status: 'done', title: '✅ SHIPPED 2026-06-25 (PR1–3): SketchRepeatNode + SketchRepeatRef model + expandSketchOps (sketch-repeat.ts) flattening upstream of compileSketch + emit (Array.from(...).flat(), two-site agreement test-locked) + + repeat UI in SketchNodeCard/SketchEditorPane + sketch_repeat NodeCard; 13 tests; existing sketch parts byte-identical. LEFT: re-wirable ref↔source SVG sockets (plain coord inputs for now). Sketch REPEAT op (plan docs/plans/sketch-repeat.md, 2026-06-16). A repeat in the sketch editor mirroring the polygon poly_repeat: a free-floating sketch_repeat prototype card + a flat repeat-ref row in the parent sketch, wireable count, tri-modal Δr/Δz advance (self-tiling threads / rack lands / tapers). compileSketch stays UNTOUCHED — the repeat unrolls into a flat op stream upstream via one expandSketchOps helper shared by emit + the live preview (locked by a unit test). First PR = pure model + expandSketchOps + test (hand-unrolled == repeat-expanded); PR-3 UI lands in the extracted SketchEditorPane (after K.65). ✅ UNBLOCKED 2026-06-23 — SketchEditorPane extracted (Phase E Step 2).' },
    { id: 665, bundle: 'B', lane: 1, start: 68.6, weeks: 0.5, priority: 'medium', status: 'done',   title: 'Modularize the big files (added 2026-06-02; REFRESHED + RESEQUENCED 2026-06-16 → docs/plans/modularize.md, a 15-PR plan covering extraction + a stale-code sweep + fragility-hotspot hardening. P1 SHIPPED 2026-06-16: graph-editor-geom.ts extracted from GraphEditorPane (9635→9168 lines) — the socket/wire/card position math is now pure + co-located + tested 16/16, which also de-risked the mv/rot strip work. The original offenders below are STALE — PrimitiveView/CompositionEditor/ProfileFnEditor were archived in the K.63 strip; current top files: GraphEditorPane.svelte ~9168, vocab/+page 1687, composition-graph.ts 1653, primitives/+page ~1800. REMAINING P2+ per the plan: graph-model split, RightPane/SketchEditorPane extraction, NodeCard last). ORIGINAL NOTE: Top offenders (lines): PrimitiveView.svelte 3387, CompositionEditor.svelte 1872, routes/primitives/+page.svelte 1410, ProfileFnEditor.svelte 1149, plan/details.ts 929, composition-tree.ts 774, builder.ts 741. Three of those (PrimitiveView, CompositionEditor, ProfileFnEditor) shrink mostly through the K.63 strip (worktree-agent PR in flight as of 2026-06-02 evening, drops the OLD composite UI from PrimitiveView once .prim.ts editing is gone). Post-strip targets: (1) PrimitiveView splits into PartView (param accordion + 3D viewer + source tab) + StdlibViewer (read-only banner + the kind-dispatched mounts). (2) CompositionEditor extracts the per-row Call accordion (props grid + mv/rot editors + Transform/Method toolbar + color swatches) into CompositionCallRow.svelte, and the imports section into CompositionImportsList.svelte. (3) ProfileFnEditor extracts composeSource + parseBody + bodyTooComplexToDecompose into src/lib/shared/profile-fn-compose.ts (pure functions, easier to unit-test the round-trip after the 2026-06-02 fix chain 60a1f30 / 4901e49 / 7f98a13). composition-tree.ts can stay near 800 lines but split into composition-parse.ts / composition-emit.ts / composition-mutate.ts so docs/COMPOSITION.md three-section API maps 1:1 to file boundaries. builder.ts loses its dead-after-strip primitive-composite render branch. routes/primitives/+page.svelte gets cleaner once typedCreate stops mirroring old + new kinds. plan/details.ts is mostly long copy strings; reorganise per-bundle only if it produces merge conflicts. Goal is structural — no file in src/ over 1000 lines without a real reason. Ship in 4 PRs: (a) extract CompositionCallRow + CompositionImportsList (1 day, low risk); (b) extract profile-fn-compose helpers + unit tests (1 day, medium risk because round-trip subtleties); (c) split composition-tree.ts (half day, mechanical); (d) post-strip PrimitiveView split (1 day, needs K.63 strip merged first).' },
    { id: 680, bundle: 'B', lane: 1, start: 69, weeks: 0.6, priority: 'high', status: 'done', title: 'Stack + part-properties cluster (2026-06-14). Stack z-offset is now a GRADED DELTA to the flush position (0 = end-to-end, + = gap, − = overlap by |v|; cursor = tail+ref) — fixed the "non-zero offset hides all but one item" bug (a61b4d7); inline ×N count + z-offset fields on the Stack card (no popover needed) + dropped the KIND column (ccc5fda). NEW collapsible ⚙ Properties card above PARAMS holding z-offset + OUTSIDE colour + INSIDE (bore) colour + material; stack_ref moved out of the param-chip list. Per-part colorOuter/colorInner round-trip through meta + hydrate and are APPLIED to the bake — they substitute the red-outer/grey-bore vertex-colour LUT on BOTH the live-mesh pane (builder.ts finalizeManifold override) AND the GLB pane (manifold-bake.ts COLOR_0). Defaults (#cc2222/#888888) keep unset parts byte-identical.' },
    { id: 650, bundle: 'B', lane: 1, start: 69.1, weeks: 0.7, priority: 'high',   status: 'done',   title: 'Extrude expressivity overhaul (2D-CSG profile composition + (θ, r, z) parametric weld-extrude). One feature surface, three sub-steps that compose into "anything sweepable along z without the warp post-pass." Sub-steps: (a) 2D-CSG before extrude — use Manifold CrossSection to compose multiple cartesian profiles via union/subtract/intersect, then extrude the resulting polygon. New stdlib `r_csg_extrude` takes an array of {kind, params, op ∈ {base, add, subtract, intersect}} (or a profile-level construction tree); demo = rect − ellipse bore − hex bolt-hole pattern → one extruded plate. (b) Weld-extrude with rail-weld geometry — replace Manifold.extrude with gridPatch + capFan + weldAndBuild (same machinery as r_revolve in manifold-mesh.ts). u = around-section param, v = along-z; user supplies x(u, v) / y(u, v) / z(u, v) or — sugar — r(u, v) + θ(u, v). Cross-section can MORPH along z (taper, twist, sinusoidal scaling, blend between two profiles) without warp post-pass that K.13 was parked on; pairs naturally with the visual loop / repeat row (K.47) — same data-driven mental model, one dimension up. Demos: twisted hex bar (θ += twist*v), tapered cylinder (r decays with v), gear with helix angle (the teeth wind around). (c) Composition — the cross-section at each v can itself be a 2D-CSG composite, so (a) feeds (b). Net effect: "extrude" stops meaning "linear sweep of a fixed polygon" and starts meaning "rail-welded swept surface of an arbitrary 2D-CSG cross-section that can vary along v."' },
    { id: 681, bundle: 'B', lane: 1, start: 69.4, weeks: 0.5, priority: 'medium', status: 'done', title: 'Viewer visualization cluster (2026-06-14). View-only X-dia exaggeration + Z-depth compression scales (⚙ scale menu) so long thin tools stay legible. Z-axis lighting: a point-light STRIP spread along the part Z extent (scene.zStripLight, the Phong-compatible default) PLUS a true THREE.RectAreaLight mode (scene.zRectLight — swaps the lit mesh to MeshStandardMaterial only while on); both off by default, byte-identical when off. Z-pan slider now spans the FULL part length (range = partZExtent) and its step scales with zoom, so a long part stays fully scrollable top→bottom at any zoom.' },
    { id: 652, bundle: 'B', lane: 1, start: 69.8, weeks: 0.5, priority: 'medium', status: 'done',   title: 'Parallel-build composite parts via web workers (then CSG sequentially). Today a composite like t_drilled_block builds every component (r_cube_ext, then r_cylinder, then r_cylinder, …) sequentially in ONE sandbox + then runs the CSG chain. The component builds are independent — they can spawn into per-worker subprocesses, run in parallel, and serialize back to a Manifold mesh; the main thread then walks the .add/.subtract/.intersect chain. Win scales with component count and per-component build cost; worth it for dp_stand (3× dp_joint), drill-pipe assemblies, and anything with many r_threads helices. Trade-offs: Manifold WASM must load in each worker (one-time per session, cache); mesh serialization adds bytes (mesh-serial already exists). Likely first pass: a worker pool ~CPU-count, the loader (primitive-loader.ts buildPrimitiveGeom) detects independent named instances and Promise.all-s them through the pool, then folds via the existing CSG chain. SvelteKit + Vite already support web workers (`new Worker(new URL("./prim-worker.ts", import.meta.url))`), so the scaffolding is small.' },
    { id: 682, bundle: 'B', lane: 1, start: 69.8, weeks: 0.5, priority: 'medium', status: 'done', title: 'SVG geometry tab (2026-06-14, docs/plans/svg-geometry-tab.md, Route 1 = three SVGRenderer). New right-pane SVG tab vector-renders the bake: persp ⇄ ORTHO toggle (ortho default — a straight perpendicular elevation looking at origin, the technical-drawing projection), black EdgesGeometry border (gated on showEdges), scrollable natural-aspect render (long part renders tall + scrolls vs squished), coarse|HIGH resolution toggle (coarse 32-seg default), ⤓ .svg download, high-poly warning, active-tab-only render. GPU-SVGRenderer was explored + rejected (category error: SVG is DOM, the DOM build not the math is the bottleneck — bake fewer segments instead). Shiny/specular in SVG not feasible (SVGRenderer is flat-diffuse only). HLR via archived three-svg-renderer = the post-ship quality upgrade.' },
    { id: 683, bundle: 'B', lane: 1, start: 70.2, weeks: 0.8, priority: 'high', status: 'done', title: 'Bake performance for long stacks (2026-06-14, docs/plans/stack-cutaway-perf.md). ROOT CAUSE of the ~27-34s "construction": NOT the geom (collar→tube→pin build+compose is ~133ms) — it was (a) the GLB bake always building the full cutaway subtract (~20s, no 15k skip) blocking Node single thread so the mesh queued behind it, and (b) mesh extraction+serialize being O(total triangles). FIXES SHIPPED: GLB moved to its own LAZY tab — the 3D-bake tab is mesh-only (~1-2s) and never waits on the GLB; mesh-first rebuild sequencing; coarse-segment bake now reaches ASSEMBLY deps via a segment cap clamped at the primitive-loader call boundary (engine prims take segments as an explicit param, not a global) → g_dp_stand 47712→5760 tris (8.2×); SVG tab bakes coarse (32) + a ⚡ draft toggle bakes the live mesh at 64 seg. Net: g_dp_stand ~27s → ~1s. STILL PLANNED: per-part cutaway (decompose→cut each body→merge, distributive over compose, turns the super-linear cutaway linear; preserves color-by-source; one finalizeManifold change covers all 3 bake paths) + raising/dropping the 15k skip.' },
    { id: 655, bundle: 'B', lane: 1, start: 70.3, weeks: 0.7, priority: 'high',   status: 'todo',   title: 'Sweep-along-path (3D path sweep, an extrude variant for non-linear axes). Today r_weld_extrude sweeps a 2D cross-section LINEARLY down z (straight prism, optional twist + taper). The natural generalization: sweep the SAME cross-section along an arbitrary 3D PATH — bends, helices, curved tubes, spline-driven sweeps, pipe runs that follow a hand-drawn 3D trajectory. Manifold-3d does not provide this natively (CrossSection.extrude is linear-only); the implementation is the hand-wound rail-weld path with ring positions placed along the path tangent + per-station local frame (Frenet or RMF — rotation-minimizing frame to avoid twist artifacts on turns). NEW stdlib `r_sweep` takes (profile, path_pts, optional twistFn(s), optional scaleFn(s)). The path is a 3D polyline OR a function s → [x, y, z] sampled at N stations. Each station gets a local frame; the cross-section is laid flat in that frame and the sides are stitched (gridPatch + capFan + weldAndBuild). Demos: U-bend pipe (path is two straights + a quarter-arc), helical coil (path = (cos(t), sin(t), t·pitch)), gooseneck cable run (Bezier 3D path), drill-pipe stand with a tapered bend at the joint. Pairs with the existing sweep/weld bench numbers: native r_weld_extrude does linear in ~1 ms; r_sweep on the same N×M grid should land in the 1.5–2× range (similar to W-twist vs CS-twist) because each station has the same per-vertex math just placed differently. Two builders that emerge: SweepPart (open path with end caps) + SweepLoop (closed path = torus-like). New file type: `<id>.swp.ts` mid-extension, dispatches a SweepPartBuilder (path editor + cross-section editor + 3D preview). Big future win: this enables anything that does not fit a straight extrude/revolve — gooseneck flow lines, coiled tubing, casing strings that follow a wellbore curve. Order it AFTER the K.55-precursor tab dispatch lands (Extrude/Profile/Assembly are simple cases first); then K.55 adds the path-sweep type alongside.' },
    { id: 684, bundle: 'B', lane: 1, start: 70.8, weeks: 1.0, priority: 'high', status: 'done', title: 'GPU instancing for identical repeats (2026-06-14, realises the long-deferred K.43). For a Stack/Repeat of N IDENTICAL children (e.g. 50× one joint) the live mesh today merges into one N× mesh → extraction + serialize + transfer + GPU are O(N) (~47s at N=50). Opt-in instanced:true on /preview → finalizeManifold decompose()s the result, groups bodies identical-up-to-Z-translation, returns ONE child mesh (full+cutVC) + N transform matrices → PrimitiveDualScene renders a THREE.InstancedMesh → O(1)+N. Preserves red/grey + outer/inner vertex colours, the cutVC variant, and the graded-delta z-offsets (per-instance matrix). Single/mixed parts fall back to the merged path byte-identical; SVG/GLB keep merged. Target: 50 joints ~0.5s at FULL 256-seg fidelity (no draft needed). In flight via a worktree subagent; bake side build-verified, InstancedMesh render needs visual validation on merge.' },
    { id: 900, bundle: 'B', lane: 1, start: 71, weeks: 0.3, priority: 'medium', status: 'done', title: 'Plan + survey (2026-06-14, docs/plans/external-api.md + docs/api/README.md). Found cadtrain is already partway there: hooks.server.ts has CORS (CORS_ORIGINS allowlist + preflight) + a coarse AUTH_TOKEN bearer gate on /api/* + a wired-but-empty rate-limit extension point; GET /api/manifest is a hand-authored machine-readable capability catalog (the seed of /api/v1/manifest); POST /api/primitives/describe generates Claude markdown descriptors; geometry endpoints already return mesh-JSON / base64 GLB / coarse-segment SVG. SVTC (sibling repo) has a MATURE external-plugin SDK to adopt wholesale: externalAuth.js hashed/scoped/cached token registry (issue-once reveal), /sdk/llms.txt + /sdk/llms-full.txt + /sdk/version, an MCP server, an external/<devId>/ scoped namespace. Differ: skip SVTC\'s Svelte-compile/import-rewrite/mount pipeline — we serve geometry ops, not hosted plugin UI.' },
    { id: 901, bundle: 'D', lane: 3, start: 71.3, weeks: 0.5, priority: 'medium', status: 'open', title: 'V1.0 read-only API: /api/v1/* facade thin-wrapping the existing handlers (list parts / get part metadata+geometry / bake preview → mesh-JSON·GLB·SVG / query the RAG corpus). No geometry logic duplicated. Versioned resource model + structured errors. Lowest risk (reuses shipped endpoints).' },
    { id: 644, bundle: 'B', lane: 1, start: 71.5, weeks: 0.3, priority: 'medium', status: 'todo',   title: 'D Phase 2 (DEFERRED): repeat_with_data(array, fn) for HETEROGENEOUS instances — BHA with mixed HWDP/drill pipe/stabilizers, per-iteration params from a data array. Sandbox = native data.map (no helper needed); recognizer extension to spot const items = data.map((d,i) => mv(<inst>(...d), [...])); return place(items). Build when a concrete varied use case lands.' },
    { id: 902, bundle: 'D', lane: 3, start: 71.8, weeks: 0.6, priority: 'high', status: 'open', title: 'V1.1 auth: per-app bearer-key registry (ctk_v1_ token, stored as sha256(bearer) hash + metadata at <volume>/apps/_tokens/<id>.json — Rule 15, never plaintext; 60s cache; scopes read⊂bake⊂author⊂admin; CADTRAIN_ADMIN_KEY bootstrap), gated via a new apiKeyHandle composed with sequence(). Orthogonal to the per-USER OAuth (bundle L) — both reuse one owner-scoped subtree resolver.' },
    { id: 685, bundle: 'B', lane: 1, start: 72, weeks: 0.4, priority: 'high', status: 'done', title: 'SVG flat-shading bug fix + PrimitiveSvgView modularization (2026-06-23). The intermittent "initial SVG renders flat/incomplete in /primitives, ok after a param change" bug (TODO PARKED) was a gradient-id COLLISION: the Gouraud emitter numbered <linearGradient> ids g0..gN (local gid, resets per render) and SVG url(#id) resolves DOCUMENT-WIDE; /primitives mounts one PrimitiveSvgView per tab, so the N instances overlapped the g0..gN namespace — whenever 2+ svgs coexisted (panes not torn down, or the transient window on a tab/part switch before the old pane teardown $effect runs) a polygon url(#gK) resolved to ANOTHER instance gradient (different userSpaceOnUse coords, usually off-poly) -> single flat stop -> flat shading, cleared by a re-bake. Verified 4 instances gradients (16.5k) coexisting live; single /graph-editor mounts one instance so it never reproduced there (the tell). FIX (6736f50): each mount gets a unique idPrefix (svgUid) threaded into emitSvg -> ids sNNNN-g0..gN, collision impossible. SURFACED BY the modularization (474e8f5): PrimitiveSvgView 744->523-line shell + pure svg-emit.ts (434, the Gouraud emitter: project/shade/2-stop-gradient/painter-sort/build) + svg-camera.ts (102, ortho/persp camera from bbox + scene). Dead first-paint rAF re-raster band-aid (workaround for the misdiagnosed paint glitch) stripped (3ff4dfc). Took ~5 wrong diagnoses before modularizing made the emitter reviewable; the static-DOM snapshot had missed the transient multi-instance window. Memories: svg_gradient_id_collision, feedback_verify_the_right_scenario.' },
    { id: 613, bundle: 'B', lane: 1, start: 72.2, weeks: 0.3, priority: 'medium', status: 'done',   title: 'Warp z-spline revisit (PARKED): give the warp path its OWN popup (open polyline anchored at origin, not the closed-profile ProfileEditor) + fix the suspected interpretation bug (Z-down anchor z0=min.z=top→s=0; planar-only frame; x-centered assumption).' },
    { id: 903, bundle: 'D', lane: 3, start: 72.4, weeks: 0.8, priority: 'medium', status: 'open', title: 'V1.2 author/execute + per-app namespace: app-scoped writes under apps/<appId>/primitives/... resolved by the SAME primitive-paths.ts (parameterized root, kept out of VOLUME_PROXY_PATHS). Highest risk — the write surface + the R2–R4 holes from the customize-dir plan. IP protection: per-part meta.visibility:baked-only serves geometry+metadata but withholds source/graph (bridges to the WASM-conceal idea).' },
    { id: 692, bundle: 'B', lane: 1, start: 73, weeks: 0.8, priority: 'high', status: 'done', title: 'Sidebar + row UX overhaul (2026-06-16). /primitives rebuilt as a Windows-Explorer expand/collapse FILE TREE (folders open in place, state persisted) with a left vertical TAB rail that SCOPES the tree to one top-level folder. Compact rows: the four hover buttons (rename/move/copy/trash) clubbed into ONE ⋯ kebab + right-click context menu (Rename · Move to… · Copy to… · Archive/Delete); dropped the redundant `vol` tag (only arch/src/stale badge). MOVE a part to another folder (drag-to-folder/tab + a Move-to dialog; backend findPrim fallback for archive↔basic) and COPY (duplicate under a new id — rewrites meta.id/name + the export fn). Drag-selection / sticky-drag fix (onNodePointerDown preventDefault + canvas user-select:none).' },
    { id: 904, bundle: 'D', lane: 3, start: 73.2, weeks: 0.6, priority: 'medium', status: 'open', title: 'V1.3 LLM manifest + MCP: /api/v1/manifest (evolve /api/manifest) + /sdk/llms.txt + tool-call JSON schemas per operation + an MCP server (adopt SVTC\'s) so an agent can discover + drive cadtrain. Worked examples (author from description → bake → fetch GLB/SVG). V1.4 (later): embeddable canvas (iframe-postMessage or published web-component).' },
    { id: 686, bundle: 'B', lane: 1, start: 73.8, weeks: 0.6, priority: 'high', status: 'done', title: 'BREP tab parity + cutaway (2026-06-16). The BREP (server-side OCCT) tab now reuses the SAME PrimitiveDualCanvas chrome as the 3D-bake tab (backend="brep": canvas/camera/lights/orbit, ⚙ scale, SceneControls, Z-pan, stats, 🔄, cached/fresh badge); bespoke PrimitiveBrepView archived; new brep-adapter.ts (OCCT response→THREE.BufferGeometry). BREP cutaway switched from a HALF cut to a QUARTER (+x,+y quadrant) to match the Manifold getCutBox; getCutBox itself is now bbox-derived (spans the part\'s full Z + margin) instead of a fixed [20,20,100]@z[-50,50] that under-cut tall stacks.' },
    { id: 687, bundle: 'B', lane: 1, start: 74.4, weeks: 0.7, priority: 'high', status: 'done', title: 'Smooth warp via build-time weld segmentation + Rule 25 (2026-06-16). Warp on coarse revolves was faceted (manifold.warp only moves existing verts). FIRST attempt — post-bake MeshGL subdivide — OOB-crashed the WASM core (corrupts the singleton → every part 500s); REVERTED. Durable fix: subdivide the 2D (r,z) PROFILE along Z BEFORE the revolve, inside the welded revolveProfile/weldAndBuild pipeline — crash-safe (can\'t make a non-manifold mesh), geometrically identical solid, just denser. GATED on warp-enabled via /preview (freq-driven density, ~16 samples/cycle) so non-warp revolve bakes stay light (always-on made g_dp_stand 26s/751k verts). Codified as CLAUDE.md Rule 25: the welded-mesh system is the PRIMARY geometry builder; segmentation/warp resolution belongs at BUILD time, never a post-bake mesh rewrite.' },
    { id: 688, bundle: 'B', lane: 1, start: 75.1, weeks: 0.8, priority: 'high', status: 'done', title: 'mv/rot transform strips + PARAMS/PROPS tabs (2026-06-16). Inline mv/rot transforms render as compact STRIPS off the Call card\'s right edge: labels-above-inputs (narrow), no spinners, flush, sockets outward. AUTO-ATTACH — any standalone Mv/Rot node whose .child chain bottoms out at a Call now renders as a cascading strip on that Call (chain-walk: transformChainBase / attachedTransforms / transformBaseCall in graph-editor-geom.ts) and is hidden as a free-floating card. Small SEQUENCE ARROWS trace the op order (card→rot→↓mv→…→output). Separately: the PROPERTIES + PARAMS left cards merged into ONE tabbed card (Params | Properties) — CARD_Y0 re-anchored under the tab header so sockets/wires follow; param content + wires gated to the Params tab; auto-layout obstacle collapsed to one rect (PROPERTIES/PARAMS now repel node cards).' },
    { id: 689, bundle: 'B', lane: 1, start: 75.9, weeks: 0.2, priority: 'medium', status: 'done', title: 'r_weld_extrude promoted stdstale→stdlib (2026-06-16). It is an ACTIVE meta.uses dependency of g_cube / g_spiral / g_star / g_star_claude / g_barrel (+ engines r_extrude / r_loft) — confirmed by searching the PROD volume (an earlier agent\'s "unused" verdict came from the stale local .dev-volume mirror; lesson: usage searches must hit the proxied prod volume, never the local mirror). An actively-used engine belongs in stdlib/ (active), not stdstale/ (deprecated). Registry globs both dirs so resolution is unchanged; verified origin=stdlib + g_cube still bakes.' },
    { id: 917, bundle: 'B', lane: 1, start: 76.5, weeks: 0.5, priority: 'medium', status: 'done', title: "UX fixes (shipped e09932e): sidebar empty-folder visibility (filter gated on !filter.trim()), z-slider step=\"any\" (was a value-dependent step re-snapping the thumb), node-drag rAF-coalesce (full-graph re-render per pointermove → trailing). Plan: docs/plans/ux-bug-triage.md." },
    { id: 691, bundle: 'B', lane: 1, start: 77.2, weeks: 0.3, priority: 'medium', status: 'done', title: 'Edges-not-warping fix. On INSTANCED stacks the warp used to be baked into the canonical body\'s LOCAL z while instance copies were only translated, so copies 2+ carried the wrong warp phase and their edges stayed straight (non-instanced parts warped fine). ✅ DONE 2026-06-XX (9fd6556 "bake warp as a real Manifold deformation — edges follow geometry"): builder.ts tryInstanceFinalize now applyWarp()s the canonical body as a whole (edges included) BEFORE instancing, so every copy + its edges bend — the edges-stay-straight symptom is gone. Deliberate trade-off taken: all instances bend IDENTICALLY in their local frame (option (a)-flavoured) rather than each following its GLOBAL z-offset (option (b)); a true per-copy global-z phase is a separate future refinement, not this bug. builder.ts:53.' },
    { id: 905, bundle: 'A', lane: 0, start: 77.5, weeks: 1.5, priority: 'high', status: 'open', title: "Tab-aware multi-shot RAG assistant: build the Anthropic edit loop (ge-assist.svelte.ts) on the shipped Phase-1 tool registry + pure dispatcher; inject route/active-tab/open-graph + populate selectedId so \"edit THIS node\" works. Two bugs to fix: add /api/rag/assist to VOLUME_PROXY_PATHS; split buildAssistSystem so volatile graph state sits after the cache_control breakpoint. Plan: docs/plans/ai-rag-system.md." },
    { id: 906, bundle: 'A', lane: 0, start: 79, weeks: 1, priority: 'medium', status: 'open', title: "Local web-llm backend (no data leaves org): web-llm (MLC) + XGrammar constrained decoding, Qwen2.5-1.5B in a Web Worker, default-OFF, gated by a bench (>=90% tool / >=85% args); local TF-IDF few-shot DB in IndexedDB. Reference Functionary's prompt format but do NOT deploy it (server-side vLLM, not WebGPU). Plan: docs/research/web-llm-functionary.md." },
    { id: 907, bundle: 'B', lane: 1, start: 80, weeks: 2, priority: 'high', status: 'done', title: "Modularize round 2 — shell cleanup + dead-code sweep. ✅ COMPLETE 2026-06-26 (GEP 9455→5070, −46%; R2 knip + 6 unused-helper sweep f0344c3; R6a/R6b/R7/R8/R9 all done). ✅ R6a DONE 2026-06-25 (2 steps): PolyPreviewState class (poly-preview-state.svelte.ts — state + 24 handlers) + PolyPreview.svelte (overlay markup + .ge-poly-preview* CSS) lifted out of GraphEditorPane; coord ƒ-popover stays in the shell (shared by poly_repeat + mv/rot/txfmn axes). GEP 6191 → 5500, browser-verified on g_collar. TARGET RESET 2026-06-25 (after a read-only progress review): ≤1500 is unreachable by shell cleanup alone — the residual is must-stay pan/zoom infra (~300) + genuine features (expr builder ~250, profile-coord editor ~250, repeat editor ~250). HONEST TARGET = ~2,500–3,000 lines; reaching ≤1500 would need one more LARGE feature carve (Expr-builder + Repeat-editor components as a unit). ✅ MORE CARVES DONE 2026-06-25: RepeatEditorPane.svelte (repeat overlay), CanvasMenu.svelte (⚙ settings) + AiMenu.svelte (✨ generate). ✅ R6b DONE 2026-06-25: module-map header on GEP + $state audit (GEP state is ALL component-local/per-instance — the only cross-pane singleton is `expected`, intentional + idempotent). GEP FINAL = 5070 lines (9455 → 5070, −46%). The CLEAN component carves are essentially complete; remaining bulk is must-stay shell (pan/zoom, bake $effects, SVG wire overlay, launcher glue) + the expr launcher glue (~70 lines, NOT worth a component since the popup+menu are already extracted) + the tricky profile-coord 2D resolve (~200, node-card↔global-editor boundary). Ghost toggles are NOT carvable (ghostSet/ghostIds feed emit/bake). Hitting ~2500-3000 would need carving the profile-coord block — deferred. GEP-independent tracks (isolated-worktree subagents): R2 knip dead-code prune (builder.ts/library.ts legacy chain + 12 unused deps + 90 unused exports + mime.ts/temp-file.ts), R3 /design link from landing (being rebuilt as the interactive xyflow graph), R4 primitives → Sidebar + TabStrip, R7 builder.ts → builder-legacy + render-helpers then retire library.ts (✅ R7 DONE 2026-06-26 — library.ts deleted, builder.ts renamed render-helpers.ts, dead ComponentDef path cut, bake-proof verified; MODULARIZE ROUND 2 COMPLETE), ✅ R8 DONE 2026-06-25 (vocab/+page 1687→1005, 4 _tabs/* components + ~130 dead CSS), ✅ R9 DONE 2026-06-25 (pure profile-fn-compose.ts: parseBody/composeBody/bodyTooComplex + 11 round-trip tests incl. the PINNED lossy multi-Array.from case; ProfileFnEditor 1156→925, byte-identical output across all 6 branches), R10 warp-subdivide retire + WASM-health banner. Plan: docs/plans/modularize-round2.md (§6 sequencing table)." },
    { id: 908, bundle: 'B', lane: 1, start: 82, weeks: 0.5, priority: 'low', status: 'done', title: "Right-nav restructure: ❌ DROPPED 2026-06-23 — user prefers the flat 6-tab rail as-is. Was: group the RightPane vertical rail into VIEW (3D/SVG/GLB/BREP) + DATA (SRC/MD) with a pinned settings entry + sectioned settings panel. Plan doc docs/plans/right-nav-menu.md kept for reference but not pursued." },
    { id: 909, bundle: 'B', lane: 1, start: 82.5, weeks: 1, priority: 'medium', status: 'done', title: "/design svelte-flow architecture graph: rebuild /design as an interactive @xyflow/svelte graph of routes/api/lib/store. ✅ DONE 2026-06-23: ArchGraph + ArchNode (source/target Handles) + curated architecture.ts (29 nodes / 26 edges), @xyflow/svelte@1.6.1, legend + minimap + controls; page made scrollable (height:100% + overflow-y). Proves the svelteflow pilot. ENRICHED + COLLAPSIBLE 2026-06-25: C4 container view grown to 56 nodes / 65 edges (corrected stale /fem,/forge → archived; added /research + /api/brep) then rebuilt as a COLLAPSIBLE auto-layout TREE — system→containers→components, recursive LR layout, collapsed-by-default, useSvelteFlow().fitView re-frame on every toggle (SvelteFlowProvider in +page). TWO VIEW TABS 2026-06-25: Tree (the collapsible L-R tree, compact mfmesh-style nodes + minimap + draggable + solid-flow/dashed-depends/dotted-hierarchy edges) + C4 model (formal C4 diagram — Context→Container→Component level switcher, proper notation, muted externals from c4.ts). FOLLOW-UPS (TODO #16): tune the expand re-center + spacing/styling toward the mfmesh.up.railway.app/architecture reference; legend overlaps the rightmost column at fit-zoom. Plans: docs/plans/design-route-svelteflow.md." },
    { id: 910, bundle: 'B', lane: 1, start: 83.5, weeks: 2, priority: 'high', status: 'done', title: "Sketch repeat + Repeat windowed editor: (1) add poly_repeat-style repeat to the sketch; (2) open the Repeat card in its own in-tab window (sketch-overlay pattern) with PARAMS + iterators on top and two tabs — Loop body + graphical modifiers (NodeTransform[]). ✅ UNBLOCKED 2026-06-23 — the SketchEditorPane the repeat UI lands in is now extracted (Phase E Step 2). Plan: docs/plans/repeat-and-sketch-repeat.md." },
    { id: 911, bundle: 'B', lane: 1, start: 85.5, weeks: 2.5, priority: 'large', status: 'done', title: "Client-side execution: server stays the compiler (graph->script, IP boundary, dep-inlined script-hash cache — also kills the deja-vu bug); client executes in a Web Worker. Manifold-client first (low risk); OCCT-client via replicad (lazy worker, ~11MB WASM, fallback). PRESERVE the server Manifold+OCCT builder under /api/server-builder/ (git mv + shims, never deleted). ✅ PR1–3 SHIPPED 2026-06-17: /api/primitives/compile (GET saved + POST live source) → dep-inlined Manifold script + scriptHash; bake-worker(-core).ts + bake-client.ts (one Worker, latest-wins cancel, IDB cache); PrimitiveDualCanvas routes to the Worker behind a 💻/☁ rail toggle (scene.clientBake) with /preview fallback; ⚡client/☁server badge + SRC ⚡compiled subtab; client-side compile cache (param scrubs skip /compile — verified 0 fetches). Verified g_collar/g_nipple/g_dp_stand. LEFT: vert-weld vs non-indexed parity, PR4 server-builder relocate, PR5 OCCT-in-worker, PR6 default-flip. Plan: docs/plans/client-side-execution.md." },
    { id: 912, bundle: 'B', lane: 1, start: 88, weeks: 0.5, priority: 'low', status: 'done', title: "Repo cleanup: archive ~19 stale scripts + 6 stale test specs + rm tests/results (105MB) + git mv training_data (175MB) -> archive; keep FEM + forge (forge flagged experimental). ✅ DONE 2026-06-16 (5bc6ae4): 20 stale scripts + 6 dead e2e specs → archive/, tests/results removed (regenerable). training_data KEPT at root by design — it's a static symlink referenced in vite.config + Dockerfile, not movable. Plan: docs/plans/repo-cleanup.md." },
    { id: 913, bundle: 'B', lane: 1, start: 88.5, weeks: 1, priority: 'medium', status: 'done', title: "TXFMN transform card: one TxfmnNode {child, rot[3], offset[3]} replacing composed Mv+Rot, re-expanded at emit to byte-identical mv(rot(child)); compact ROT/MV table with per-row f-expr + param socket; hydrate-time migration of legacy mv/rot. ✅ DONE 2026-06-16 — MODEL (e267231): TxfmnNode type + emit (identity-elision) + setTxfmnAxis/addTxfmn + hydrate fold + 11 tests. CARD RENDER (e4bc3c9): standalone 6-row ROT/MV card (rx/ry/rz·x/y/z, ƒ expr-toggle, param sockets, child+output) + 'xform' picker entry; browser-verified on g_shaft. Plan: docs/plans/transform-card.md." },
    { id: 914, bundle: 'B', lane: 1, start: 89.5, weeks: 1, priority: 'medium', status: 'done', title: "Expression DEFINITIONS + instances (per-part library, v3) — ✅ DONE + working 2026-06-25. Reusable expr def (graph.exprDefs[]) with four sections PARAMS/CONSTS/VARIABLES/OUTPUTS edited in a tabs-or-accordions builder (no graph p.* shown); ExprNode{defId,bindings} instances (edit-def propagates); emit per-instance V_* namespacing + topo params→consts→vars→outputs; migration of v2 block + v1 graph.exprs. Σ rail popover = Expressions menu (+ define · ✎ edit · ⦻ drop-instance · delete-guard). WIRING both ways: param → expr input (bind + rendered line), and expr OUTPUT → ANY card input (Call arg, polygon coord, mv/rot/txfmn axis, repeat/poly_repeat count, sketch coord/point — bind + rendered line). mathjs validation; 23 expr unit tests. Commits a95e762→1fd0754. PARKED polish: dangling-def recovery, migrated-def invalid-formula cleanup, Σ two-click/tooltip, global expr library (TODO PARKED #8). Plan: docs/plans/expression-builder.md (v3)." },
    { id: 920, bundle: 'B', lane: 1, start: 91.5, weeks: 0.3, priority: 'low', status: 'done', title: "CLOSED 2026-06-25 — accepted the workaround (clear localStorage prim-open-tabs), NOT root-caused. /primitives multi-tab restore FREEZE (regression introduced with the expr v3 merge). Restoring a /primitives session that reopens several persisted tabs at once hard-hangs the renderer (synchronous loop — no console error, screenshot times out). /graph-editor single-pane is fine; /primitives loads fine with NO tabs and works when you open one part. So it's a MULTI-PANE / specific-migrated-part interaction with the v3 mount (a WELLS part carrying migrated v1 graph.exprs → exprDefs is the prime suspect). Workaround: clear localStorage prim-open-tabs. INVESTIGATION 2026-06-25 (static read): RULED OUT (a) the modularize-review's profile-singleton hypothesis — profileResolveErr/profileMetaParams/profilePts/profileSet are declared INSIDE GEP's <script> → per-instance, NOT a cross-pane leak; (b) the `expected` shared-singleton (graph-editor-bake.svelte.ts) → bake-storm cascade — the bake effects are dedupe+debounce guarded and don't read `expected`, and loadExpectedParamsFor has the attempted-once guard. The main GEP $effects (bake L507, loader L1796, auto-bake L991, first-bake L980) are each individually bounded/guarded. So it's NOT a single static loop — it's a multi-pane × specific-migrated-part INTERACTION that only manifests at runtime. NEXT (needs runtime, can't be pinned by reading): bisect — reopen the 7 parts (g_barrel/g_mandrel/g_shaft/g_cube/g_dp_joint/casing_sudo/casing_schematic) ONE at a time to find the offender, capture data DURING the hang (not a calm snapshot), suspect the hydrate/migration (v1 graph.exprs→exprDefs) or an instance-card $effect that only cycles when ≥2 panes share reactive state. HIGH priority — main working surface." },
    { id: 915, bundle: 'B', lane: 1, start: 90.5, weeks: 0.5, priority: 'low', status: 'done', title: "Normals + BREP.io: expose creaseAngle (re-bake, cache-keyed) + the smoothShade toggle (mesh normals are ALREADY crease-aware via Manifold.calculateNormals(3,60) — not a missing-normals bug). ✅ smoothShade QUICK-TOGGLE added to the 3D bake pane 2026-06-17 (◐ auto/smooth/flat, wired to the SAME scene.smoothShade the gear's Shade control uses — render-time, no re-bake). BREP.io = no spike (OCCT already server-side). ✅ Build-time ◯ round toggle (smoothOut(crease).refineToTolerance) SHIPPED 2026-06-23 (d587417) — gear Shade row, /preview + client worker, cache-keyed. ENHANCEMENT (future): only refines below ~28 segments (fixed 0.4%-of-OD tolerance → no-op at 32/96/192); tighten tolerance + expose a roundness strength dial. Plans: docs/research/normals-smoothing.md + brep-io.md + docs/plans/smooth-surfaces-and-brep.md." },
    { id: 916, bundle: 'B', lane: 1, start: 91, weeks: 0.5, priority: 'low', status: 'done', title: "/research route: index + viewer for docs/research/*.md via the already-present marked dep + import.meta.glob (no need to revive the archived MarkdownView); landing-page link. ✅ DONE 2026-06-16 (a00fb44 index+viewer, 8f9f874 tabbed + node-editor study): src/routes/research/ {+page.svelte, docs.ts, [slug]/+page.svelte}, 396 lines. Plan: docs/plans/research-route.md." },
    { id: 918, bundle: 'B', lane: 1, start: 91.5, weeks: 1, priority: 'high', status: 'done', title: "Bake perf (coarse-during-drag + smooth normals): MEASURED 2026-06-17 (client bake of g_dp_stand — build/mesh/cutaway all scale with the CIRCUMFERENTIAL seg, not vertical; compile cache → 0.3ms; deserialize 0.8ms). ✅ SHIPPED (19cd6b0 + this commit): P0 gate the timing logs behind localStorage.cad-bake-timings; P1 coarse-during-drag (bake seg 64 instantly, snap to full on 220ms settle — rebuildMesh segArg NOT in the keyed effect so it can't re-trigger); P1b smooth-normals shade quick-toggle (◐ auto/smooth/flat) on the bake pane wired to scene.smoothShade; P2 lazy-cutVC (cutaway:false force-skip when Cross-section OFF — saved the ~45ms cut on medium parts the threshold still computed). P3 (serialize/transfer) MEASURED + DROPPED — deserialize 0.8ms, not the bottleneck. Plan: docs/plans/bake-perf.md." },
    { id: 921, bundle: 'B', lane: 1, start: 92, weeks: 0.5, priority: 'medium', status: 'done', title: "UI polish wave (2026-06-25/26) — a parallel batch of 7 isolated-worktree subagents + landing/expr/design before it. SHIPPED: global top-right nav menu (NavMenu.svelte in +layout — route dropdown on every page, click-outside/Esc close, current-route highlight); /wells SVTC-style left tool rail (WellToolbar.svelte, 10 grouped well-component tools mirroring SVTC's WsonToolbar + active-tool state, scaffold — placement is W3); /primitives sidebar collapse → thin ~40px vertical-tab activity rail + » expand chip (was occupying too much width); SVG view fit + dia(xScale) + depth(zScale) controls matching the 3D pane (reuses shared scene state so SVG tracks 3D); bake z-slider travel = 2× the part's z-length + ½ height, and the z/x-dia scale popover now dismisses on click-outside; repeat NodeCard de-cluttered (dropped verbose descriptor + code-body subtext, ellipsis on the overflowing count chip/part labels); sketch per-axis X/Y scale ⚙ toolbar popover (engine already had scaleX/scaleY — added the missing UI). Plus the landing remodel (:5173/meshing format), the expression-builder redesign (vertical rail + OUTPUTS pane), and the /design Tree+C4 tabs. Confirm-on-delete (card/param/node, in-app two-step) ✅ SHIPPED (#15, b2054b1). All disjoint-file, each browser-verified, merged sequentially. FOLLOW-UPS shipped: Output node card redesigned to a minimal box+arrow (centered sockets + per-socket x delete, no title/labels/order/cog); repeat z-move BUG fixed (mv/rot accept scalar args mv(B,x,y,z) + addRepeatChild txfmn-aware so reloaded z-moves survive); R7 retired builder/library = modularize round 2 COMPLETE; /fem+/forge archived-reality reconciled in CLAUDE.md/design/memory." },
    { id: 922, bundle: 'B', lane: 1, start: 92.5, weeks: 0.5, priority: 'medium', status: 'done', title: "Expression builder POPOVER redesign + bake-viz tuning (2026-06-26, live screenshot-driven iteration). Reworked ExpressionBuilderPopup from the four-section tabbed layout into a 30/70 split: LEFT 30% = a plain PARAMS table (no tabs); RIGHT 70% = OUTPUTS as a clickable LIST column + a wide MULTI-LINE function-body editor (cond?a:b ternary). DROPPED CONSTS entirely — a param with a default replaces them (NOT backward-compatible by design: a def referencing a bare const name now fails validation; kept the code simple per user). Popover cleanup: no socket dots (it's a popover, not a node), header is just 'ƒ' + the def NAME field + expand/close, no 'OUTPUT · name' heading / '→ out' chip. Header is a DRAG handle (pointer-capture, pos overrides the click anchor) + the popup is RESIZABLE (CSS corner grip, resize:both, min 520×320). Data model + emit UNCHANGED (UI-only). Doc: docs/plans/expression-builder.md §v3.10. ALSO this batch: output-card wire→socket alignment fix (shared centered rootOutputSockY for render+wire); z-slider range 2×→1.1× part length (5% overshoot/side, finer pan on long parts) + ⇕ fit recentres the slider; knip dead-code sweep (6 unused exports + 16 unused files). Commits c1d2028 / c7e0611 / 294ef84 / d6a034a / a9669b0 / 830287d / d90045d / 546ae6f." },
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
  let viewMode = $state<'open' | 'done'>('open');
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
    viewMode === 'done'
      ? tasks.filter(t => t.status === 'done')
      : tasks.filter(t => t.status !== 'done')
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
  /** The work frontier — latest END (start + weeks) among done items.
   *  Drives the "Now" marker; self-maintains as items flip to done. */
  const doneFrontier = $derived.by(() => {
    let f = 0;
    for (const t of tasks) if (t.status === 'done') f = Math.max(f, t.start + t.weeks);
    return Math.round(f * 10) / 10;
  });

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
  const doneCount = $derived(tasks.filter(t => t.status === 'done').length);
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
        {#if viewMode === 'done'}
          {doneCount} shipped · click any item for detail
        {:else}
          {openCount} open · {BUNDLES.length} bundles · today = {fmtDate(TODAY)} · horizon {fmtDate(dateForWeek(maxEnd))}
        {/if}
      </p>
    </div>
    <div class="head-controls">
      <div class="toggle">
        <button class:on={viewMode === 'open'} onclick={() => (viewMode = 'open')}>Open ({openCount})</button>
        <button class:on={viewMode === 'done'} onclick={() => (viewMode = 'done')}>✓ Done ({doneCount})</button>
      </div>
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
    <span class="mono">{viewMode === 'done' ? 'Shipped' : 'Total'}: {visibleTasks.reduce((s, t) => s + t.weeks, 0).toFixed(1)}w across {new Set(visibleTasks.map(t => t.lane)).size} lanes</span>
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
