<script lang="ts">
  /**
   * Gantt-style view of cadtrain's roadmap. Mirrors the pattern in
   * sister-repo SVTC at src/routes/plan/+page.svelte but stripped of
   * Tailwind — cadtrain uses scoped Svelte styles and the same red-on-
   * dark navbar as the rest of the app.
   *
   * Edit `tasks` below to add/move/close items. Bundle-relative codes
   * (A.1, B.3, …) are computed at render time from each task's index
   * within its bundle, so renumbering happens automatically when you
   * insert or reorder tasks. The numeric `id` field is the canonical
   * key into ./details.ts and never changes.
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
    { id: 'A', name: 'Prompt-based CAD engine', tint: '#dc2626', desc: 'The geometry + recognition core of a prompt-driven CAD engine (describe or show a part → primitive + params). Geometry: ManifoldCAD primitives + /components viewer + tool viewers (Bottom Sub, Ratch-Latch). Recognition (former bundle B): pHash + CLIP hybrid retrieval, /api/identify, /api/refine, the training cache, and the synthetic-data generator.' },
    { id: 'D', name: 'Wells → SVTC WSON',      tint: '#0891b2', desc: 'New: extract well-engineering documents into WSON for SVTC drawing apps' },
    { id: 'F', name: 'Meta + UX',              tint: '#ec4899', desc: 'this /plan route, navigation, documentation' },
    { id: 'G', name: 'Vendor catalog ingest',  tint: '#f59e0b', desc: 'Halliburton/Baker Hughes catalog PDFs → per-page assets → SVG schematics + spec-table JSON. Output now feeds bundle H (constrained parametrization), not cache.jsonl' },
    { id: 'I', name: '4-level hierarchy + composite generators (DROPPED — re-planning)', tint: '#0ea5e9', desc: 'DROPPED for now 2026-05-24 — remaining work deferred, to be re-planned. Shipped already: per-tier registries, rules files (tubing/drill_pipe), in-tab Threlte rendering. Aim was Primitive → Composition → Component → Assembly with KB-anchored composite generators.' },
    { id: 'J', name: '/components polish + warp', tint: '#06b6d4', desc: 'Inspector/stage/canvas UX pass on the runes /components page: merge Params into Parts with per-part accordion, drag-scrub number inputs, stacked 4-col card layout, 3D-only canvas with in-stage Mesh/GLB toggle, GLB cutaway + vertex-colours + Z× compression + brighter material, geom-accumulator DSL, sinusoidal Z-warp experiment (TEMP, behind a master checkbox).' },
    { id: 'K', name: '/primitives visual editor', tint: '#84cc16', desc: 'Turn /primitives into a visual CAD editor: single canvas (mesh+GLB side-by-side, one WebGL context), instantiable components (meta.profiles + props), collapsible + foldered sidebar (Basic / Completions), inspector accordion with popup profiles, transform editing, r_threads taper, and a visual CSG/BODMAS composition tree. Supersedes bundle H — parametrization via source.ts components, not a JSON DesignSpace.' },
    { id: 'L', name: 'Identity & sharing', tint: '#10b981', desc: 'Per-user identity — port SVTC\'s Google OAuth → event.locals.userId — unlocking public + private customized parts on the volume. Plans: docs/plans/oauth-identity.md + customize-directory.md. Blocked only on the user provisioning Google OAuth credentials.' },
  ];

  const tasks: Task[] = [
    // ───── A. Primitives + viewers ─────
    { id:  1, bundle: 'A', lane: 0, start: -8, weeks: 4,   priority: 'large',  status: 'done', title: '18 parametric primitives in src/lib/cad/library.ts' },
    { id:  2, bundle: 'A', lane: 0, start: -6, weeks: 2,   priority: 'medium', status: 'done', title: 'ManifoldCAD geometry pipeline (buildComponent + finalizeManifold)' },
    { id:  3, bundle: 'A', lane: 0, start: -5, weeks: 1.5, priority: 'medium', status: 'done', title: '/components viewer — cutaway, edges, SVG export, PNG capture' },
    { id:  4, bundle: 'A', lane: 0, start: -4, weeks: 1,   priority: 'medium', status: 'done', title: 'Dedicated /tools/bottom-sub viewer (HAL10408)' },
    { id:  5, bundle: 'A', lane: 0, start: -3, weeks: 1,   priority: 'medium', status: 'done', title: 'Dedicated /tools/ratch-latch viewer' },
    { id:  6, bundle: 'A', lane: 0, start: 0,  weeks: 0.3, priority: 'medium', status: 'done', title: 'URL-driven /components (?p=&cam=) for synthetic data generator' },
    { id:  7, bundle: 'A', lane: 0, start: 1,  weeks: 1.5, priority: 'high',   status: 'done', title: 'Re-render primitives with red-outer/grey-internal coloring + shading before pHash/CLIP — shelved: cold-classification 17/18 killed CLIP rationale' },
    { id:  8, bundle: 'A', lane: 0, start: 2,  weeks: 0.5, priority: 'low',    status: 'on-demand', title: 'Add new primitive types as drilling needs surface' },

    // ───── B. Retrieval (RAG + CLIP) ─────
    { id: 20, bundle: 'A', lane: 1, start: -7, weeks: 1.5, priority: 'medium', status: 'done', title: 'pHash 2D-DCT perceptual hash + hamming distance' },
    { id: 21, bundle: 'A', lane: 1, start: -6, weeks: 1,   priority: 'medium', status: 'done', title: 'TrainingCache (JSONL, atomic write, feedback weighting)' },
    { id: 22, bundle: 'A', lane: 1, start: -5, weeks: 1.5, priority: 'high',   status: 'done', title: '/api/identify — RAG few-shot prompt + Claude vision' },
    { id: 23, bundle: 'A', lane: 1, start: -4, weeks: 1,   priority: 'medium', status: 'done', title: '/api/refine — SSIM loop + Claude param updates' },
    { id: 24, bundle: 'A', lane: 1, start: -3, weeks: 0.5, priority: 'medium', status: 'done', title: '/api/accept + /api/feedback — user-validated cache growth' },
    { id: 25, bundle: 'A', lane: 1, start: -2, weeks: 1,   priority: 'medium', status: 'done', title: 'HAL catalog ingest into cache.jsonl (1,772 records) — scaffolding only; 1,646 unknown-component records deleted 2026-05-11 (chore 0cdd687)' },
    { id: 26, bundle: 'A', lane: 1, start:  0, weeks: 0.5, priority: 'large',  status: 'done', title: 'CLIP retrieval rollout — embed module, hybrid scoring, identify wiring' },
    { id: 27, bundle: 'A', lane: 1, start:  0, weeks: 0.3, priority: 'medium', status: 'done', title: 'Synthetic data generator — Playwright × 5 angles × 7 styles (700 samples)' },

    // ───── D. Wells → SVTC WSON ─────
    { id: 60, bundle: 'D', lane: 3, start:  0,   weeks: 0.2, priority: 'high',   status: 'done', title: 'WSON schema + validateWson — mirrored from SVTC src/lib/apps/wson/CLAUDE.md' },
    { id: 61, bundle: 'D', lane: 3, start:  0.2, weeks: 0.2, priority: 'high',   status: 'done', title: '/api/wells/extract — Claude (Opus 4.7) vision → WSON; type:document for PDFs; rate-limited' },
    { id: 62, bundle: 'D', lane: 3, start:  0.4, weeks: 0.2, priority: 'high',   status: 'done', title: '/wells UI — upload, extract, render section cards, download JSON' },

    // ───── F. Meta + UX ─────
    { id: 100, bundle: 'F', lane: 5, start:  0,   weeks: 0.2, priority: 'medium', status: 'done', title: '/plan Gantt route — this page' },
    { id: 101, bundle: 'F', lane: 5, start:  0.2, weeks: 0.1, priority: 'medium', status: 'done', title: 'Navbar: Wells + Meta segments added' },
    { id: 102, bundle: 'F', lane: 5, start:  0.4, weeks: 0.5, priority: 'low',    status: 'done', title: 'Per-task plan details — populate ./details.ts entries for in-flight items' },

    // ───── F. Two-product split (CAD / Wells / Archive) ─────
    { id: 110, bundle: 'F', lane: 5, start:  1,   weeks: 0.4, priority: 'high',   status: 'done',   title: 'Phase 0 — Extract shared API/CLI infra (identify + wells backends → src/lib/shared/)' },
    { id: 111, bundle: 'F', lane: 5, start:  1.4, weeks: 0.4, priority: 'high',   status: 'done',   title: 'Phase 1 — Move all current routes under /archive/* (preserve as reference, mark "old work")' },
    { id: 112, bundle: 'F', lane: 5, start:  1.8, weeks: 0.1, priority: 'medium', status: 'done',   title: 'Phase 1.3 — Navbar rewrite: CAD | Wells | Archive | Meta segments' },
    { id: 113, bundle: 'F', lane: 5, start:  1.9, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Phase 2 — Empty /cad and /wells stubs + new two-product landing' },
    { id: 114, bundle: 'F', lane: 5, start:  2.1, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Phase 3 — Update CLAUDE.md (route table, methodology section, lib map for shared/)' },
    { id: 115, bundle: 'F', lane: 5, start:  2.3, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Playwright e2e suite — routes/navbar/archive-links specs (44 tests, headless 15s)' },
    { id: 116, bundle: 'F', lane: 5, start:  2.6, weeks: 0.5, priority: 'medium', status: 'done',   title: 'Expand e2e: backend smoke tests (upload to /archive/wells + /archive/reverse)' },
    { id: 117, bundle: 'F', lane: 5, start:  3.1, weeks: 0.5, priority: 'low',    status: 'done',   title: 'Wire e2e suite into CI / pre-commit (currently manual via bun run test:e2e)' },
    { id: 118, bundle: 'F', lane: 5, start:  3.6, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Rule 12 implementation — harvest_e2e_videos.ts + video playback in /plan popups (record:task script)' },
    { id: 119, bundle: 'F', lane: 5, start:  3.8, weeks: 0.1, priority: 'medium', status: 'done',   title: 'Home page = SVTC-style menu only; promote Tests to top-level navbar; longest-prefix active state' },
    { id: 120, bundle: 'F', lane: 5, start:  3.9, weeks: 0.2, priority: 'medium', status: 'done',   title: 'Mobile responsive (≤900px stack vertical) + collapsible side panels (params/meta/parts) on components + author' },
    { id: 121, bundle: 'F', lane: 5, start:  4.1, weeks: 0.1, priority: 'high',   status: 'done',   title: 'Promote /author + /library to top-level (out of /archive); add to navbar' },
    { id: 122, bundle: 'F', lane: 5, start:  4.2, weeks: 0.3, priority: 'high',   status: 'done',   title: 'Multi-mesh render path for compose.ts (mirror bottom-sub) — fixes mobile WebKit OOM on Opus assemblies; restores 192-segment precision' },
    { id: 123, bundle: 'F', lane: 5, start:  4.5, weeks: 0.5, priority: 'medium', status: 'done',   title: 'GLB-via-REST: server-side ManifoldCAD writes <id>.glb (or <paramhash>.glb on Apply); client just GLTFLoads — no WASM in the browser at all' },
    { id: 124, bundle: 'F', lane: 5, start:  5.0, weeks: 1.0, priority: 'low',    status: 'done',   title: 'Explore GPU-based CSG (compute-shader booleans) for the giant-mesh path — would let /author do live edits on assemblies that today exceed WASM heap' },

    // ───── G. Vendor catalog ingest ─────
    { id: 200, bundle: 'G', lane: 6, start:  1.5, weeks: 0.2, priority: 'medium', status: 'done',   title: 'G.0 — Storage convention: static/eval/catalog/<vendor>/ + manifest.json; PDFs gitignored, structure committed' },
    { id: 201, bundle: 'G', lane: 6, start:  1.7, weeks: 0.5, priority: 'high',   status: 'done',   title: 'G.1 — PDF inspector: per-page detection of vector vs raster vs hybrid (PyMuPDF page.get_drawings + get_images + get_text)' },
    { id: 205, bundle: 'G', lane: 6, start:  3.9, weeks: 0.5, priority: 'medium', status: 'done',   title: 'G.5 — Catalog indexer: COMPLETE-BY-DELETION (chore 0cdd687, 2026-05-11) — 1,646 unknown records dropped; KB tables (H bundle) replace cache as vendor-data source of truth' },

    // ───── H. Constrained Parametrization (designing not building) ─────

    // ───── I. 4-level hierarchy + composite generators ─────
    { id: 400, bundle: 'I', lane: 8, start: 10.0, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.0 — /components sidebar restructure: 4 hierarchy tabs (Primitives / Compositions / Components / Assemblies) + KB tab; tab-strip-on-left, in-tab Threlte canvas + scene controls' },
    { id: 401, bundle: 'I', lane: 8, start: 10.4, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.1 — Variation generator in library.ts: ComponentDef.parent + deriveVariation(spec) + buildPrimitiveManifold parent-chain fallback. SC/LC/BC box+pin variants generated from one spec table' },
    { id: 402, bundle: 'I', lane: 8, start: 10.7, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.2 — Tubing rules file (src/lib/cad/rules/tubing.ts): TubingInputs → resolveTubing (KB lookup + formula fallback) → buildTubingSpec → AuthoredComponent. Box on top, pin on bottom convention encoded' },
    { id: 403, bundle: 'I', lane: 8, start: 11.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.3 — Drill-pipe identification KB (static/kb/api/drill-pipe-identification.json) + drill_pipe_tool_joint primitive (parametric tong-area marking) + rules/drill_pipe.ts mirroring the tubing pipeline' },
    { id: 404, bundle: 'I', lane: 8, start: 11.5, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.4 — KB row → composite preview: optional rowAction prop on KbTableViewer; casing-tubing rows get a ▶ button → generateTubingComponent → opens as composite tab' },
    { id: 405, bundle: 'I', lane: 8, start: 11.8, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.5 — Catalog-inspired primitives: window_cutout (LatchRite multilateral), whipstock, sliding_sleeve (HS-ICV / MCC-ICV pattern), drill_pipe_tool_joint' },

    // ───── J. /components polish + warp (2026-05-15 session) ─────
    { id: 500, bundle: 'J', lane: 9, start: 15.0, weeks: 0.3, priority: 'high',   status: 'done',   title: 'J.0 — Inspector overhaul: param-group accordion · "+ Add primitive" picker w/ search · empty-stub for new components (no cylinder) · GLB stage tab added' },
    { id: 501, bundle: 'J', lane: 9, start: 15.3, weeks: 0.2, priority: 'high',   status: 'done',   title: 'J.1 — Cross-section + Edges toggles relocated from the bottom stage strip into the SceneControls gear popup; Params · Script shortcuts dropped' },
    { id: 502, bundle: 'J', lane: 9, start: 15.5, weeks: 0.3, priority: 'high',   status: 'done',   title: 'J.2 — Params folded into Parts tab; slider replaced with `dragNumber` Svelte action (mouse-drag scrub + keyboard typing); stacked 4-col card layout (label-on-top, drag-input full width, unit in brackets)' },
    { id: 503, bundle: 'J', lane: 9, start: 15.8, weeks: 0.3, priority: 'high',   status: 'done',   title: 'J.3 — Geom accumulator DSL: "+" opens the parts picker; snippets emit `geom = geom.add(...)`; `ensureGeomScaffold` auto-injects `let geom = empty(); ... return geom;`; new-primitive stub uses the same shape; `Manifold.prototype.add` sugar alias + `empty()` helper' },
    { id: 504, bundle: 'J', lane: 9, start: 16.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'J.4 — GLB pipeline overhaul: per-component cut-variant bake (`<id>.cut.glb`) honouring the same `getCutBox()` the live cutaway uses · per-face red-outer/grey-bore vertex colours · Z× compression via `scale.z` · flat-shading + brighter specular (full GLB stays indexed)' },
    { id: 505, bundle: 'J', lane: 9, start: 16.5, weeks: 0.2, priority: 'high',   status: 'done',   title: 'J.5 — Parts-tab accordion is PER PART: each used helper / composed component is one collapsible bar (name · sig · count · × remove); content = params with matching `group` field; orphan params collapse into a trailing General section' },
    { id: 506, bundle: 'J', lane: 9, start: 16.7, weeks: 0.2, priority: 'high',   status: 'done',   title: 'J.6 — Stage subtabs collapse to two (3D · Picture); in-canvas pill toggle picks Mesh ↔ GLB; same SceneControls/camera/cutaway state across both' },
    { id: 507, bundle: 'J', lane: 9, start: 16.9, weeks: 0.4, priority: 'medium', status: 'done',   title: 'J.7 [TEMP] — Sinusoidal Z-warp experiment: `MeshPhongMaterial.onBeforeCompile` injects `sin(z * freq)` displacement; edge-split z-subdivider so the mesh has samples to bend through; master `scene.warpEnabled` checkbox + axis/amp/freq controls in SceneControls. Grep-tagged `// TEMP warp experiment` for clean retirement' },
    { id: 508, bundle: 'J', lane: 9, start: 17.3, weeks: 0.1, priority: 'medium', status: 'done',   title: 'J.8 — E2E spec cleanup: navbar layout, /author removed, /runes → /components GLB path, stage-name landing-tab regex loosened; stale `static/components/*.glb` artefacts deleted (conn_pin, e2e_stubs, curl-test files)' },
    { id: 511, bundle: 'J', lane: 9, start: 17.9, weeks: 0.2, priority: 'high',   status: 'done',   title: 'J.11 — AI refine Level 1: dynamic prompt from discoverHelpers/discoverOperators; teaches accumulator-form defineGeom(meta, (p, geom) => …), cross-instance refs, top-model stacking, and warns AI off the loader-managed meta fields (instanceColors/instanceOps/instanceTopMode/instanceTopOffset)' },
    { id: 512, bundle: 'J', lane: 9, start: 57.5, weeks: 0.4, priority: 'high',   status: 'todo',   title: 'J.12 — AI refine Level 2: post-generation validation in the refine endpoint (imports allowlist · denylist scan · undefined-instance detection · syntax check · optional live-bake · retry-once-with-errors-fed-back)' },
    { id: 513, bundle: 'J', lane: 9, start: 57.9, weeks: 0.2, priority: 'high',   status: 'todo',   title: 'J.13 — AI refine Level 3: live-bake gate on the inspector Accept button — status pill ("✓ Builds" green / "✗ Bake failed: <msg>" red); Accept disabled on failure. Uses the existing /api/components/bake-preview endpoint, no backend changes' },
    { id: 514, bundle: 'J', lane: 9, start: 58.1, weeks: 0.3, priority: 'medium', status: 'todo',   title: 'J.14 — AI refine Level 4: assembly-aware prompt — when refining a composition, glob docs/assemblies/README.md + matching <assembly>.md into the system prompt. Today nothing in src/ reads docs/assemblies/ so the AI re-invents known recipes every refine' },

    // ───── K. /primitives visual editor ─────
    { id: 600, bundle: 'K', lane: 10, start: 19.0, weeks: 0.3, priority: 'high',   status: 'done',   title: 'K.0 — Single canvas: live mesh + baked GLB side-by-side in ONE WebGL context (PrimitiveDualCanvas/Scene); dropped the stacked 2nd canvas → closes the WebGL context leak' },
    { id: 601, bundle: 'K', lane: 10, start: 19.3, weeks: 0.3, priority: 'high',   status: 'done',   title: 'K.1 — Instantiable components: meta.profiles defaults + a props override object so compositions stay clean (t_valve_port)' },
    { id: 602, bundle: 'K', lane: 10, start: 19.6, weeks: 0.2, priority: 'medium', status: 'done',   title: 'K.2 — Collapsible /primitives sidebar (persisted localStorage, SVTC-style « / » toggle)' },
    { id: 603, bundle: 'K', lane: 10, start: 19.8, weeks: 0.2, priority: 'medium', status: 'done',   title: 'K.3 — Transform editing: ＋transform below the chain (sequential) + ✕ delete (unwrap op(inner,args)→inner)' },
    { id: 604, bundle: 'K', lane: 10, start: 20.0, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.4 — r_threads radial taper: taper_angle param reduces radius along length (NPT-style); 0° = straight, regression-safe' },
    { id: 605, bundle: 'K', lane: 10, start: 20.3, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.5 — Inspector accordion: merged Params+Parts into a /components-style accordion (Build · Source · AI tabs); dropped Profile tabs → profile editing via ✎ popup everywhere' },
    { id: 606, bundle: 'K', lane: 10, start: 20.8, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.6 — Sidebar directory restructure: tests→Industrial + Completions family folders + Basic folder for r_* primitives — all shipped' },
    { id: 607, bundle: 'K', lane: 10, start: 21.2, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.7 — Visual CSG/BODMAS composition tree (read-first): recognizer parses the return expr → ConstructionTree.svelte renders bracketed BODMAS ((L − h1) − h2) + op/leaf nodes + warp-at-end root. Editable drag/reparent splice tracked as K.15.' },
    { id: 608, bundle: 'K', lane: 10, start: 21.8, weeks: 0.5, priority: 'medium', status: 'done',   title: 'K.8 — Inspector UX polish: exclusive accordion (one row open unless pinned 📌), 2-col param layout (less padding/narrower cols), primitive title inside canvas (Threlte HTML) + hover description, profile shape-icon w/ hover preview + popup w/ 2dp coordinates, prominent tooltips (black bg/white text)' },
    { id: 609, bundle: 'K', lane: 10, start: 22.3, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.9 — Warp-at-end transform: warpSpline(comp, path, opts) bends the assembled solid along an (x,z) spline as the final op; no-stretch 1:1 arc-length map (was elongating ~2×). Toggle in the Parts tab; shows as the construction-tree root.' },
    { id: 610, bundle: 'K', lane: 10, start: 22.7, weeks: 0.4, priority: 'medium', status: 'done',   title: 'K.10 — Searchable profile palette: SVG-thumbnail grid (built-in PROFILE_REGISTRY ∪ volume profiles, filterable) + volume-saved profiles (/api/primitives/profiles/{list,save}) + save-as-profile in the popup.' },
    { id: 611, bundle: 'K', lane: 10, start: 23.1, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.11 — Volume consolidated to 4 dirs (archive/components/ai/primitives): kb+kb-sources+training_data+eval → ai/, empty library/ husk deleted; code repointed (no alias) + docker-entrypoint + CLAUDE.md Rule 13.' },
    { id: 612, bundle: 'K', lane: 10, start: 23.4, weeks: 0.2, priority: 'low',    status: 'done',   title: 'K.12 — Drag-resizable /primitives left sidebar (160–560px, persisted; double-click resets) so long primitive names are readable.' },
    { id: 613, bundle: 'K', lane: 10, start: 68.3, weeks: 0.5, priority: 'medium', status: 'deferred',   title: 'K.13 — Warp z-spline revisit (PARKED): give the warp path its OWN popup (open polyline anchored at origin, not the closed-profile ProfileEditor) + fix the suspected interpretation bug (Z-down anchor z0=min.z=top→s=0; planar-only frame; x-centered assumption).' },
    { id: 616, bundle: 'K', lane: 10, start: 25.6, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.16 — Profile popup redesign: ~20% smaller, vertical editor|coords-table split, searchable shape DROPDOWN (thumbnail-as-you-type) replacing the preset "tabs" + <select>; applied to leaf + composite popups.' },
    { id: 617, bundle: 'K', lane: 10, start: 26.1, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.17 — "+ new primitive" sidebar popup (FloatingPanel, not native prompt): name + searchable r_* BASE picker → composes the r_* via meta.uses + a NAMED instance (const body = r_*(...)). Rule 20 (author from r_*, never raw cyl/tube). Tree-aware delete fix (archive basic/completions parts).' },
    { id: 618, bundle: 'K', lane: 10, start: 26.6, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.18 — BODMAS tree expands intermediate composition variables (const geom = ball.add(body) → named sub-composite node; ((ball ∪ body) ∪ revolve2)).' },
    { id: 619, bundle: 'K', lane: 10, start: 26.9, weeks: 0.8, priority: 'high',   status: 'done',   title: 'K.19 — Profile EXPRESSIONS: parametric profile params drivable by expressions referencing the composite params (rMajor: od/2) via the ƒ expression builder (reuse openFx, lists composite params + Math); profile arg → resolveProfile({kind, params:{exprs}}) spliced into source (no resolver change — evaluated in scope). Composite profiles; later hooks P3 custom-fn. See docs/plans/profile-expressions.md.' },
    { id: 620, bundle: 'K', lane: 10, start: 27.7, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.20 — Parametric drill-pipe connection profile KINDS: drill_pipe_pin (male) + drill_pipe_box (female) in PROFILE_REGISTRY (revolve half-section computed from bore/wall=body-thickness/tjOD/lengths/taper, box adds counterbore). Pick in the profile dropdown → r_revolve renders the connection; profile visible. Kind params are a compact 2-col grid of draggable number boxes (dragNumber, no spinner arrows) like the Parts panel, live-redraw. Kinds live in src (curated library); saved dimensioned configs → volume.' },
    { id: 621, bundle: 'K', lane: 10, start: 28.3, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.21 — r_threads internal/external switch (side param) + taper: external/male threads sit on the OD with ridges inward (subtract cuts the outer pin surface); internal (default) unchanged. Enables male tapered threaded joints on pin connections.' },
    { id: 623, bundle: 'K', lane: 10, start: 29.0, weeks: 0.8, priority: 'high',   status: 'done',   title: 'K.23 — New-primitive create fixed + function-first: stub generator serialized polygon array defaults unbracketed (default: 0,0,1,0) → invalid meta → save 400; now JSON.stringify + type:polygon (pure src/lib/cad/primitive-stub.ts, unit + e2e tests). Raw r_revolve/r_extrude removed from the create picker. Fancy var-name profile inputs in the part row + top panel. Delete params from the Parameters section (FloatingPanel confirm). Optimistic-create: just-created parts show immediately despite the laggy prod list (pendingCreated/mergePending).' },
    { id: 624, bundle: 'K', lane: 10, start: 29.8, weeks: 1.2, priority: 'high',   status: 'done',   title: 'K.24 — File-based P0. SHIPPED 2026-05-26: flat typed files <id>.{prim,asm}.ts + profiles <id>.{prvl,prex}.ts (mid-ext=type); prod volume MIGRATED (42 prims source.ts→.prim.ts, 4 profiles profile.json+source.ts→one .prvl.ts module); single resolver primitive-paths.ts (dual-read legacy); endpoints source/save/list/delete/restore + profiles/* rewritten. REMAINING (P0b): content-hash bake cache keyed on content+params+dep-hashes, busted on save. See docs/plans/file-based-architecture.md.' },
    { id: 629, bundle: 'K', lane: 10, start: 35.0, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.29 — Components product DELETED (2026-05-27): /primitives is now the ONE CAD UI. Removed the /components route, all 12 /api/components/* endpoints, src/lib/cad/components/ (bundle registry + families.ts + components-l3), server/library.ts + component-loader.ts, the dead recipe chain (part-recipe/primitive-recipe/recipe-preview), /archive/**/components, and the industrial category. builder.ts kept (live preview render helpers) but detached from the bundle registry. Nav + landing → /primitives; e2e specs updated (runes/instance-ops deleted). Also finished the half-applied profile-swap refactor (▾ selector → ProfilePalette popup) + r_rotate function-first scaffold. ~22.5k lines removed.' },
    { id: 630, bundle: 'K', lane: 10, start: 35.5, weeks: 0.8, priority: 'high',   status: 'done',   title: 'K.30 — stdlib primitives in src (2026-05-27): r_revolve + r_extrude moved OUT of the volume INTO src/lib/cad/stdlib/ (git-tracked, type-checked, READ-ONLY), made FUNCTION-ONLY parametric (type:profile → profile selector + lifted params, no vertex grid). New stdlib registry (src/lib/server/stdlib.ts; import.meta.glob ?raw → source baked into build, no runtime COPY) + dual-source resolver: /api/primitives/{source,list} serve stdlib FIRST + dedupe volume copies; save/delete refuse stdlib ids. Dedicated read-only "stdlib" sidebar group (blue src tag). Create picker now offers r_revolve/r_extrude function-first bases (buildFnProfileStub wraps the stdlib base w/ a profile-selector param); r_rotate retired + archived; volume r_revolve/r_extrude archived. ALSO unfroze Railway: a stale Dockerfile COPY of the deleted src/lib/cad/components broke image assembly (Vite build passed) → auto-deploy restored. See memory stdlib_primitives_in_src + dockerfile_stale_copy_freezes_deploy.' },
    { id: 631, bundle: 'K', lane: 10, start: 36.3, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.31 — Self-contained function-profile parts + part-building fixes (2026-05-27): a revolve/extrude part now carries its profile INLINE (const X_profile = resolveProfile({kind,params}) → r_revolve(X_profile, dial)); the profile + params live ON the part (selector in the accordion head + ✎ fn editor), NOT lifted to the top Parameters section. Fixes: (1) loadPrimitive scaffolds the inline profile for r_revolve/r_extrude (was the dead r_rotate branch; generic path String(obj)d the descriptor → [object Object] → 400, blocking a 2nd revolve); (2) defaultArgFor emits resolveProfile() for object defaults; (3) buildFnProfileStub create stub = empty meta.params + inline profile; (4) fetchLeafProfile detects type:profile; (5) recognize errors are a non-destructive banner (keep the last-good accordion); (6) swapPartProfile repoints the kind in place (no regenRevolveSource → no appliedArgs desync → re-renders); (7) loadProfileBuild merges each VOLUME profile’s own d.params defaults (else resolveProfile({kind}) with partial params → NaN → "Not manifold"; all revolve profiles are volume-materialized). Shipped 2373f6f + 41c4acd. See memory self_contained_profile_parts.' },
    { id: 632, bundle: 'K', lane: 10, start: 36.9, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.32 — Color-by-source rendering (2026-05-27 evening; 397d44b..3d6df51): each part colored by its r_* source via Manifold mesh relation (runOriginalID/runIndex) — survives CSG + calculateNormals + cut-box subtract. Stamped with hashId (part-id.ts FNV-1a, biased into the 0x40000000..0x7FFFFFFF source band); LUT built by analyzeParts (server/part-colors.ts); applied to live mesh + GLB bake (cut walls = body color, not the tool color). Per-part outer/inner colors via two swatches in each accordion title (square=outer, circle=inner) → meta.instanceColors[name]={outer,inner}.' },
    { id: 633, bundle: 'K', lane: 10, start: 37.3, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.33 — Drill-pipe spec profiles + r_threads threadType (2026-05-27 evening): drill_pipe_pin profile trimmed 9→5 params (std upset + 45° nose); NEW dp_spec_pin (pipeOD/jointOD/wall→ri, flat jtUpset shoulder, 45° upset + 5° thread taper, thread length DERIVED — terminates at ri+wall); NEW dp_spec_box (counterbore + flat internal makeup shoulder, faces UP). r_threads adds threadType selector (NC38/NC40/NC46/NC50/FH — presets form + OD; values APPROX, refine vs API 7-2).' },
    { id: 634, bundle: 'K', lane: 10, start: 37.7, weeks: 0.4, priority: 'medium', status: 'done',   title: 'K.34 — Inspector UX polish (2026-05-27 evening): one-click searchable profile selector (grid, not nested combobox); viewport-clamped FloatingPanels; ProfileFnEditor "Save" leftmost + red dirty button; vertical/trapezoidal Build/Source/AI tabs + shared icon action bar (Delete/Save/Save as/Save defaults/Duplicate w/ tooltips). Fixes: edge outlines re-added to live canvas; uniqueInstName guards <name>_profile companion; live profile params from inline descriptor; defaultsDirty pill ("Save defaults" when applied≠source defaults); GLB warp-on-load gated by scene.warpEnabled.' },
    { id: 635, bundle: 'K', lane: 10, start: 38.1, weeks: 0.3, priority: 'high',   status: 'done',   title: 'K.35 — Connection-datum layer (2026-05-28, ad76ffc): ref(m, head, tail) declares a part\'s connection planes; head(m)/tail(m) read them (fallback = bbox faces); mate(a, b, gap)/align(b, aZ, bZ) chain. mv() carries _refHead/_refTail under translate. The structured-wiring path that powers dp_joint (box+pipe+pin stacked via mv(b, [0,0,tail(a)])) and dp_stand. Sandbox-injected via primitive-sandbox.ts.' },
    { id: 636, bundle: 'K', lane: 10, start: 38.4, weeks: 0.2, priority: 'medium', status: 'done',   title: 'K.36 — Vertical Z-pan camera slider (2026-05-28, M1, 89b6c9a): vertical range slider on the canvas\'s left edge drives scene.zFocus. OrbitControls target follows ([0,0,zFocus]) and the camera position pans by the same delta — composes with orbit; pure pan along Z. Useful for tall assemblies (dp_stand, dp_inst_stand). ⊙ button resets.' },
    { id: 637, bundle: 'K', lane: 10, start: 38.6, weeks: 0.2, priority: 'medium', status: 'done',   title: 'K.37 — Sidebar folder glyphs + sharpened titles (2026-05-28, C, b2a246c + 98c9b44): Heroicons folder/folder-open glyph (amber) on group/family headers (open vs closed signals expand state). ▾/▸ caret removed (the folder glyph IS the signal). Titles black #1a1a1a, 14/13px, antialiased — file-manager look.' },
    { id: 638, bundle: 'K', lane: 10, start: 38.8, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.38 — Move parts between folders from the sidebar (2026-05-28, B, 3e280b0): new /api/primitives/move?id&to endpoint (atomic fsp.rename via primitive-paths.findPrim; EXDEV-safe copy+unlink fallback; refuses stdlib ids 403; allowlists basic | archive | completions/<family>). UI: 📁 picker per part row (FloatingPanel folder list, current folder excluded). Since location = category (Rule 16), the move regroups the part in the sidebar. Added to VOLUME_PROXY_PATHS (single live store).' },
    { id: 639, bundle: 'K', lane: 10, start: 39.2, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.39 — Vertical sidebar section tabs (2026-05-28, E, f0948b6 + 5b75748): three trapezoidal, vertical-text tabs in the sidebar — Primitives (Profile builder + stdlib + Basic) · Components (Completions families, flattened — no outer wrapper) · Archive (always visible, empty state when none). Editor-rail format (clip-path trapezoid, writing-mode: vertical-rl, narrow 24px rail). Profile-builder link moved from header into the Primitives tab. Active section persists in localStorage. Tabpanel scrolls; vrail stays fixed.' },
    { id: 640, bundle: 'K', lane: 10, start: 39.6, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.40 — place() instancing + dp_inst_stand (2026-05-28, A, 629a04f): new place(parts) sandbox helper → Manifold.compose (a purely topological combine, NO boolean union). Parts stay SEPARATE bodies ("connected/placed, not fused") and each keeps its source originalID so color-by-source survives. dp_inst_stand on the volume = BUILD dp_joint ONCE + N cheap translates + place(); geom cost FLAT in joint count (~58ms vs dp_stand\'s 147ms 3× build + union, growing linearly). finalize still scales with total triangles (the Phase-2 boundary). Spike TEST 5 (scripts/spike_csg_originalid.ts) verifies compose preserves per-body originalID + survives cutaway. Also documents: translate() reads originalID()=-1 but PRESERVES the mesh-relation id (mv keeps colors).' },
    { id: 641, bundle: 'K', lane: 10, start: 40.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.41 — Repeat × N construction-tree node (2026-05-28, D Phase 1, 461af39): recognize-composite spots the canonical instanced-assembly idiom (const ARR = []; for (let i=0; i<N; i++) ARR.push(mv(<inst>, [0,0,<step>])); return place(ARR);). New RecognizedRepeat exposes { arrayName, instName, countText, stepText + source spans }. ConstructionTree renders a green ⟳ "Repeat × <count>" node with the inner instance as child + Δz badge. dp_inst_stand now shows as Repeat × p.joints over joint :dp_joint. The count is already a live param so dragging the joints slider IS editing the loop count — visualization was the missing piece.' },
    { id: 642, bundle: 'K', lane: 10, start: 40.5, weeks: 0.2, priority: 'medium', status: 'done',   title: 'K.42 — forge branch merged into main (2026-05-28, 0b1b6b3): the parked image→3D exploration brought onto main — /forge route + src/lib/forge/{pipeline,types}.ts + /api/forge/generate (FAL Hunyuan3D v2, REST, no SDK). Nav + landing get a Forge entry. Half-built — needs FAL_API_KEY in Railway when actually used. forge branch backed up to origin/forge as a safety net before merging. Auto-merge was clean (no conflicts) + build verified before the merge commit.' },
    { id: 643, bundle: 'K', lane: 10, start: 66.1, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.43 — A Phase 2 (DEFERRED): true GPU InstancedMesh for the live mesh + GLB renderer. place(parts) today CONCATENATES mesh data (no GPU instancing); finalize/upload scales linearly with total triangles (~2s at 12 joints, 211ms at 3). True InstancedMesh = one geometry + N transform matrices = flat memory/upload. Only build when long strings (50+ joints) become felt pain.' },
    { id: 644, bundle: 'K', lane: 10, start: 66.7, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.44 — D Phase 2 (DEFERRED): repeat_with_data(array, fn) for HETEROGENEOUS instances — BHA with mixed HWDP/drill pipe/stabilizers, per-iteration params from a data array. Sandbox = native data.map (no helper needed); recognizer extension to spot const items = data.map((d,i) => mv(<inst>(...d), [...])); return place(items). Build when a concrete varied use case lands.' },
    { id: 645, bundle: 'K', lane: 10, start: 67.3, weeks: 1.0, priority: 'low',    status: 'todo',   title: 'K.45 — D Phase 3 (DEFERRED): true enter/update/exit reconciliation runtime inside the bake pipeline. D3-style: array diffing by identity, incremental rebuild only on changed instances, cached per-iteration sub-builds. Significant runtime layer (only worth building when D Phase 2 strains long strings).' },
    { id: 646, bundle: 'K', lane: 10, start: 42.2, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.46 — Subfolders inside completions/<family>/ + 📁+ folder-create button + dp_test_* parts (2026-05-28, ddbcab5 + 4c6a7ee). primitive-paths.findPrim walks a 3rd level; /api/primitives/list returns completionSubfolders so empty folders surface; save/move TARGET_RE accepts the nested form. UI: per-family 📁+ FloatingPanel POSTs /api/volume?action=mkdir (no new endpoint), nested fold per subfolder in the sidebar, move-to-folder picker includes subfolders as targets. Test parts authored to primitives/completions/drill_pipe/test/ on prod: dp_test_2_7_8_g105_nc31, dp_test_4_5_g105_nc46, dp_test_4_5_20_g105_nc50 (Perforator API spec rows pp 6-7, 14-15, 16-17) + dp_test_hwdp_5_spiral (3 helical wear pads via r_threads at wide pitch + 120° rotations).' },
    { id: 647, bundle: 'K', lane: 10, start: 42.6, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.47 — Visual loop (repeat row) in the profile editor — D3-join style without D3 (2026-05-28, 2659296 + 352bec5 + bbc48d3 + 6df44f6 + c0ff807 + 83a152e). + repeat cmd added to ProfileFnEditor Move type with a/b/c = count, x(i), y(i). composeSource emits Array.from spread when any repeat row present (mixed with mv/line static rows). parseBody Phase 2 recognizes Array.from({length: N}, (_, i) => BODY) — inline + block-with-local-calcs forms — with chained-calc inlining to fixpoint; parseCalc fixed to track brace depth (was leaking inner callback consts as top-level). Stacked layout: N + cmd + delete on row 1, x(i) and y(i) each get their own full-width row with monospace 13px for math readability. Three polar-pattern volume samples on prod: ngon_v2 (uniform r), star_v2 (alternating r via i%2), gear_v2 (sinusoidal rBase + amp*cos(teeth·θ)) — all decompose into one editable repeat row + render correctly (6/10/96 points). Curated Ellipse also decomposes into one repeat row with rMajor*cos((i/n)·2π) / rMinor*sin((i/n)·2π).' },
    { id: 648, bundle: 'K', lane: 10, start: 43.2, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.48 — Cartesian profile fix + parseBody return-array decomposition (2026-05-28, 4c6a7ee + 05fa017 + e95a97c). ProfileFnEditor DEFAULT_BODY + seedRows fallback branch on the `set` prop — cartesian + New profile now scaffolds a centered {w, h} rectangle (was the revolve half-section + r/len, which threw "build(p) must return ≥ 3 [r,z] points"). profile-fn validator error message neutralized to mention both axes. parseBody extended to extract structured moves from a tail return-array literal (rect/l/t/plus/cylinder/tube/cone/barrel/drill_pipe_pin all decompose). Procedural bodies (ellipse/ngon/star before K.47) preserved verbatim by composeSource so they still render via /profiles/resolve.' },
    { id: 649, bundle: 'K', lane: 10, start: 43.5, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.49 — Basic subfolders (Revolved / Extruded / test_primitives) + 6 extrude samples (2026-05-28, e96201e). /api/primitives/list returns basicSubfolders[] + tags entries with subfolder; save/move regexes accept basic/<sub>. Sidebar Primitives tab Basic group nests subfolder folds the same way Components families do; 📁+ button mirrors the per-family one; mkdir popup generalized to take parent ∈ {basic, completions/<family>}. Volume reorg on prod: 9 existing r_* → basic/revolved/; 6 extrude samples authored to basic/extruded/ — r_cube_ext (rect), r_cylinder_ext (ellipse), r_hex_prism (ngon_v2 polar), r_star_prism (star_v2 polar), r_gear_prism (gear_v2 polar), r_l_beam (l cartesian); basic/test_primitives/ empty playground. All six preview-build end-to-end against r_extrude(profile, length).' },
    { id: 653, bundle: 'K', lane: 10, start: 65.8, weeks: 0.3, priority: 'medium', status: 'todo',   title: 'K.53 — Responsive editor layout (mobile / small-screen stacking). The profile editor (and /primitives sidebar) currently use a fixed multi-column grid; below some viewport width the columns squish unreadably. Plan: a CSS container query / breakpoint (~720px) that switches `.fn-ed.fill` to one column with sections STACKED top-to-bottom (params · expressions · path · 2D SVG · 3D Threlte), and the /primitives sidebar collapses into a top-level section bar (Primitives | Components | Archive across the top instead of in a vertical rail). Touch-friendly hit targets along the way. Useful for tablet / mobile iteration on the field.' },
    { id: 655, bundle: 'K', lane: 10, start: 64.4, weeks: 1.4, priority: 'high',   status: 'todo',   title: 'K.55 — Sweep-along-path (3D path sweep, an extrude variant for non-linear axes). Today r_weld_extrude sweeps a 2D cross-section LINEARLY down z (straight prism, optional twist + taper). The natural generalization: sweep the SAME cross-section along an arbitrary 3D PATH — bends, helices, curved tubes, spline-driven sweeps, pipe runs that follow a hand-drawn 3D trajectory. Manifold-3d does not provide this natively (CrossSection.extrude is linear-only); the implementation is the hand-wound rail-weld path with ring positions placed along the path tangent + per-station local frame (Frenet or RMF — rotation-minimizing frame to avoid twist artifacts on turns). NEW stdlib `r_sweep` takes (profile, path_pts, optional twistFn(s), optional scaleFn(s)). The path is a 3D polyline OR a function s → [x, y, z] sampled at N stations. Each station gets a local frame; the cross-section is laid flat in that frame and the sides are stitched (gridPatch + capFan + weldAndBuild). Demos: U-bend pipe (path is two straights + a quarter-arc), helical coil (path = (cos(t), sin(t), t·pitch)), gooseneck cable run (Bezier 3D path), drill-pipe stand with a tapered bend at the joint. Pairs with the existing sweep/weld bench numbers: native r_weld_extrude does linear in ~1 ms; r_sweep on the same N×M grid should land in the 1.5–2× range (similar to W-twist vs CS-twist) because each station has the same per-vertex math just placed differently. Two builders that emerge: SweepPart (open path with end caps) + SweepLoop (closed path = torus-like). New file type: `<id>.swp.ts` mid-extension, dispatches a SweepPartBuilder (path editor + cross-section editor + 3D preview). Big future win: this enables anything that does not fit a straight extrude/revolve — gooseneck flow lines, coiled tubing, casing strings that follow a wellbore curve. Order it AFTER the K.55-precursor tab dispatch lands (Extrude/Profile/Assembly are simple cases first); then K.55 adds the path-sweep type alongside.' },
    { id: 657, bundle: 'K', lane: 10, start: 46.2, weeks: 0.1, priority: 'low',     status: 'done',   title: 'K.57 — A/B/C instance naming on drag-into-assembly + Mesh-Live label drop in legacy view (2026-05-29, NEXT). Per user — short alphabetical instance names (Excel-column-style: A, B, …, Z, AA, AB, …) in place of the current childId-derived ones (rod_4, my_try_extreude2). Easier to read in chained .add(A).add(B).subtract(C) expressions. Plus the \"Mesh (live)\" label chip in PrimitiveDualCanvas now hidden in the legacy AssemblyEditor view (already hidden in the typed-builder dispatch). Only one scene per pane so the label is visual noise.' },
    { id: 654, bundle: 'K', lane: 10, start: 44.3, weeks: 0.6, priority: 'medium', status: 'done',   title: 'K.54 — Visual Repeat block for Array.from + place(ring) at the PARTS layer (sister to K.47 at the profile layer). Today w_test_ring_of_pegs / w_test_cube_grid / w_test_bolt_row author the polar/grid placement idiom directly in source — `const ring = Array.from({ length: p.count }, (_, i) => { const a = (i / p.count) * 2 * PI; return mv(peg, [cos(a) * p.ring_r, sin(a) * p.ring_r, 0]); }); return place(ring);` — and the user has to mentally simulate what each `i` produces. The recognizer already spots a Repeat × N node in the ConstructionTree (D Phase 1, K.45, dp_inst_stand case) but the Parts/Composition editor does NOT yet expose it as an editable visual block the way the ProfileFnEditor does for repeat ROWS in 2D profiles. Goal: lift the parts-layer Array.from idiom into a first-class visual block. Three halves: (a) RECOGNIZE — extend recognize-composite.ts to detect the Array.from({length}, (_, i) => …) form WITH inline calc consts (currently only for-loop), capturing {count, perInstance: {translateX(i), translateY(i), translateZ(i), rotX(i), …}, basePart}. (b) RENDER — new RepeatBlock row in the Parts accordion of PrimitiveView with editable count + x(i)/y(i)/z(i)/rot(i) expression slots (textareas, same monospace style as K.47), small ⓘ helper with common patterns (linear, polar ring, polar disk, cartesian grid, fibonacci spiral, helical). (c) ROUND-TRIP — composeSource emits the same Array.from + place(...) shape back so the source stays hand-editable. Connects to deferred D Phase 2 (repeat_with_data heterogeneous, memory `todo_*` notes) — same visual block, the loop pulls from a data array instead of a literal range. One dimension up from K.47 (2D points) to 3D placement.' },
    { id: 652, bundle: 'K', lane: 10, start: 63.4, weeks: 1.0, priority: 'medium', status: 'todo',   title: 'K.52 — Parallel-build composite parts via web workers (then CSG sequentially). Today a composite like t_drilled_block builds every component (r_cube_ext, then r_cylinder, then r_cylinder, …) sequentially in ONE sandbox + then runs the CSG chain. The component builds are independent — they can spawn into per-worker subprocesses, run in parallel, and serialize back to a Manifold mesh; the main thread then walks the .add/.subtract/.intersect chain. Win scales with component count and per-component build cost; worth it for dp_stand (3× dp_joint), drill-pipe assemblies, and anything with many r_threads helices. Trade-offs: Manifold WASM must load in each worker (one-time per session, cache); mesh serialization adds bytes (mesh-serial already exists). Likely first pass: a worker pool ~CPU-count, the loader (primitive-loader.ts buildPrimitiveGeom) detects independent named instances and Promise.all-s them through the pool, then folds via the existing CSG chain. SvelteKit + Vite already support web workers (`new Worker(new URL("./prim-worker.ts", import.meta.url))`), so the scaffolding is small.' },
    { id: 650, bundle: 'K', lane: 10, start: 62.0, weeks: 1.4, priority: 'high',   status: 'open',   title: 'K.50 — Extrude expressivity overhaul (2D-CSG profile composition + (θ, r, z) parametric weld-extrude). One feature surface, three sub-steps that compose into "anything sweepable along z without the warp post-pass." Sub-steps: (a) 2D-CSG before extrude — use Manifold CrossSection to compose multiple cartesian profiles via union/subtract/intersect, then extrude the resulting polygon. New stdlib `r_csg_extrude` takes an array of {kind, params, op ∈ {base, add, subtract, intersect}} (or a profile-level construction tree); demo = rect − ellipse bore − hex bolt-hole pattern → one extruded plate. (b) Weld-extrude with rail-weld geometry — replace Manifold.extrude with gridPatch + capFan + weldAndBuild (same machinery as r_revolve in manifold-mesh.ts). u = around-section param, v = along-z; user supplies x(u, v) / y(u, v) / z(u, v) or — sugar — r(u, v) + θ(u, v). Cross-section can MORPH along z (taper, twist, sinusoidal scaling, blend between two profiles) without warp post-pass that K.13 was parked on; pairs naturally with the visual loop / repeat row (K.47) — same data-driven mental model, one dimension up. Demos: twisted hex bar (θ += twist*v), tapered cylinder (r decays with v), gear with helix angle (the teeth wind around). (c) Composition — the cross-section at each v can itself be a 2D-CSG composite, so (a) feeds (b). Net effect: "extrude" stops meaning "linear sweep of a fixed polygon" and starts meaning "rail-welded swept surface of an arbitrary 2D-CSG cross-section that can vary along v."' },
    { id: 660, bundle: 'K', lane: 10, start: 48.0, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.60 — Atomic rename for primitives (file + meta.id + meta.name + function-name + downstream uses all in one operation). Today the rename operation surfaced via the GUI / volume PUT only changes the FILENAME (`tube.asm.ts` → `tube_new.asm.ts`). The source body still says `id: \'tube\'`, `name: \'tube\'`, `export function tube(od) {...}`, AND every assembly that already declared `uses: [\'tube\']` keeps pointing at the OLD name. The downstream effect when nesting: the loader\'s `p`-injection regex (primitive-loader.ts:140-146) matches `function NAME(args)` where NAME = the requested-id. After a partial rename, NAME (`tube_new`) doesn\'t match the function-name (`tube`), so the regex doesn\'t inject `const p = {od};` and the body throws `"p is not defined"` at runtime as soon as it tries to read `p.od`. Standalone bake superficially worked (sometimes — depending on whether `p` was needed) which made the bug INVISIBLE until nesting surfaced it. Plan: NEW endpoint `/api/primitives/rename` that takes `{oldId, newId}` and atomically (a) walks every `.asm.ts` / `.exp.ts` / `.rev.ts` on the volume, rewrites `uses: [...]` entries that mention oldId + every `oldId(...)` call site in the body → newId; (b) opens the target file, rewrites `id: \'oldId\'` → `id: \'newId\'`, `name: \'oldId\'` → `name: \'newId\'`, AND `export function oldId(` → `export function newId(`; (c) renames the file. All three under one temp-file+rename txn so partial state is impossible. Surface in the GUI as a ✎-name button on the primitive\'s title chip; a confirm popup lists the N downstream assemblies that will be rewritten before applying. Also handle the collision-detection edge — if `newId` already exists OR is a SANDBOX_ARG_NAMES helper, refuse with a clear message. Surfaced 2026-05-29 when the `tube` collision investigation forced an in-flight rename to `tube_new`; ate ~30 minutes of debugging before the function-name mismatch was visible. Pairs with K.59 / K.61.' },
    { id: 662, bundle: 'K', lane: 10, start: 46.5, weeks: 1.0, priority: 'high',   status: 'done',   title: 'K.62 — Assembly composition model overhaul: lists-are-groups + per-row CSG chain + nested sub-lists + import/expression rows (2026-05-29..31, six commits 72786dc / 5fbb96f / b8c0de5 / 7a8e2fd / 247a9d2 / b3206aa). User-driven model shift away from K.56-D\'s single-op-per-row pill (▢add ▣subtract ◫intersect ▤place) which was unintuitive once the "list IS group" mental model was on the table. NEW MODEL — what the user sees in source: `return [A, B];` is the canonical compose (sandbox auto-place wraps any returned Array in a recursive Manifold.compose); CSG ops are authored as a LEFT-to-RIGHT chain per row (`const A = A_raw.subtract(B).intersect(C);`); groups are inner arrays (`[A, [C, B, D.intersect(E)]]` ⇒ nested place()). PHASE E.1 (72786dc) — sandbox wrapper installed in buildPrimitiveGeom auto-places Array returns recursively; Instance.ops {op, arg}[] data field; two-pass emitter (PASS1 `const NAME_raw = <placement>` + downstream tail/head refs lock onto `_raw` so a .subtract doesn\'t crop the column\'s stacking math; PASS2 ops chains); Instance.hidden field excludes operand-only rows from the return list; backward-compat migration on parse lifts legacy `op:\'subtract\'|\'intersect\'` to the previous row\'s ops chain + marks operands hidden. PHASE E.2 (5fbb96f) — per-row ⊕⊖∩ mini-toolbar: click an op button opens a FloatingPanel typeahead listing sibling row names; pick one and it appends to Instance.ops; existing ops render as `[∆ C ×]` chips with × to remove; auto-hide on append + auto-un-hide when the last reference is removed; 👁 toggle on hidden rows to also show them in the scene as an override; the single-op `<select>` and the currentOpForInstance / setInstanceOp helpers are GONE. PHASE E.3 data (b8c0de5) — Instance.children?: Instance[] for nested groups; recursive emit walks groups depth-first (children first, then `const NAME = [child names];`); sequential mate cursor is LOCAL to each group (entering resets, exiting locks onto the last visible child\'s tail); ops chains + overlay anchors cross groups freely (every binding in the same function scope); parser STRIPS `children: [...]` BEFORE other field scans so a regex field-getter doesn\'t reach into nested rows and pull a child\'s src/args up to the group; walkInstances / flatInstances public iterators. PHASE E.3 UI (7a8e2fd) — `+ Group (sub-list)` button at the top of the add-part popup creates an empty {children: []} at top level; group marker rows render as `🗂 G [B] [C] ✕` chips in the Sequential subtab; ✕ deletes the group AND promotes children back to top level so nothing\'s lost; filteredAsmParts excludes any row inside a group\'s children list. PHASE E.3.1 (247a9d2) — drag-into-group: 🗂 group markers become drop targets for the existing instance drag MIME (\'application/x-instance-name\'); drop a row onto a group → it reparents as last child; each child chip gains a ↗ button to promote back to top level; immutable tree manipulators removeFromTree / findInTree / moveIntoGroup / moveToTopLevel land in the data layer. PHASE E.4 (b3206aa) — IMPORT (alias) + EXPRESSION rows: user-proposed model shift. The classic tube case collapses from two atom instances + ops chain to ONE import (\`{name:\'A\', kind:\'import\', src:\'shaft\'}\` → \`const A = shaft;\`) + ONE expression (\`{name:\'tube_body\', mode:\'custom\', expr:\'A(p.od,p.len).subtract(A(p.id,p.len))\'}\` → \`const tube_body = A(p.od,p.len).subtract(A(p.id,p.len));\`). Recursive expressions fall out for free — each row binds a name in scope so later expressions reference earlier ones (\`whole = core.add(wing)\`). The + popup gains stacked buttons: 🗂 Group / 📥 Import (with sub-mode "pick primitive to alias") / ƒ Expression. Definitions section (blue) renders import rows above the subtabs; Expression section (amber) renders custom rows with inline blur-commit textarea. Bake-verified end-to-end: tube_new shape via /api/primitives/bake-preview 25532 bytes visible. DEFERRED to E.3.2 — RECURSIVE NESTED ACCORDION RENDERING: render each group\'s children as full per-row accordions inside the group\'s body (their own ops bar / mode pickers / drag handles / color swatches), not the flat chip list; needs a Svelte 5 snippet `{#snippet renderRow(inst, depth)}` that recursively renders + the per-row machinery extracted into a reusable inner snippet (~200 lines of markup extraction). DEFERRED to E.4.1 — expression-row authoring polish: typeahead autocomplete on sibling names + known methods (.subtract / .add / .intersect / mv / rot / tail / head / p.*); syntax highlight; live error annotation. DEFERRED to E.3.3 — DRAG-TO-SIBLING-GROUP (move a child from group A directly into group B); GROUP-LEVEL ops on the group ITSELF (\`const G_raw = [B, C]; const G = G_raw.subtract(F);\`) since groups are first-class composables too. All deferred items are pure UI/polish on the data-layer foundation (b8c0de5 + b3206aa shipped the runtime); they\'re independent of further runtime work. Bake regression baseline confirmed at each phase: legacy flat assemblies still produce 297712-byte GLB through the new wrapper; new-shape assemblies bake equivalently or better. Tracks K.56 → K.62 evolution; supersedes the per-row op pill model from K.56-D entirely (the op-pill markup is removed from PrimitiveView).' },
    { id: 675, bundle: 'K', lane: 10, start: 57.3, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.75 — g_* Round 2 + g_dt_joint composition showcase (#167). Blocker first: the graph emit path must handle `place([...])` cleanly (multi-Call compose returning an instanced list) — that is what deferred g_dt_joint out of Round 1. Then: g_dt_joint as the multi-part graph exemplar (box + tube + pin via place/tail), seeded from the salvaged draft at docs/parts/g_dt_joint.md + scripts/build_g_parts.ts. Round 2 migrations: g_dt_stand, g_tube (consolidate dt_tube + dt_tube_v2 + e_tube into one), g_dt_collar_{flat,tapered,rounded} (style enum like template_collar). Also wire the RAG prompt-loop flywheel: each ACCEPTED ✨ generation gets saved + the corpus rebuilt (↻) so it becomes a retrievable exemplar — the compounding loop from docs/plans/rag-prompt-builder.md.' },
    { id: 674, bundle: 'K', lane: 10, start: 57.0, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.74 — Stability fixes + instruction-surface modernization (2026-06-11 PM, 3c3d4c6..15697d5). FOUR FIXES from live use: (1) polygon card socket alignment (#168) — left-edge r/z + repeat-ref sockets assumed uniform 39px rows but CSS renders vertex rows at 45px / loop-ref rows at 38px; new polyRowTop() cumulative walk mirrors the CSS; wires + auto-height use it. (2) WebGL context budget (#169) — only the ACTIVE /primitives tab mounts PrimitiveDualCanvas (new `active` prop); inactive tabs keep all editor state but release their context (renderer.dispose + forceContextLoss on unmount); module-scope LRU fetch cache (12 entries, keyed on full request body) makes switching back instant with zero server round-trips. CLOSES the long-standing todo_webgl_context_leak (~16-context browser cap). (3) profiles/resolve 400 spam (#170) — both resolve $effects re-fire every render; identical request bodies are now skipped (bakeNonce still forces retry). (4) infinite-loop regression fix (84dc204) — the fetch cache made rebuilds synchronous, closing an identity-churn loop on the fresh-args prop → effect_update_depth_exceeded; rebuild effect now keys on serialized {id, args, source} content. Canonical pattern in memory fresh-array-props-effect-loops (same trap as the /vocab zoom loop). DOCS MODERNIZATION (Fable-5 era cleanup, background agent + main session): root CLAUDE.md rewritten ~330→158 lines — current architecture snapshot (GraphEditorPane one-editor-two-surfaces, stdlib/stdstale, tracked archive/), deduped rules with stable numbers, shipped-session ledgers moved to NEW docs/HISTORY.md; api/shared/cad CLAUDE.md refreshed vs actual code; MEMORY.md index trimmed 28.5KB→8.3KB (grouped by theme; topic files kept on disk). HYGIENE: all 12 stale agent worktrees removed + 18 merged/superseded branches deleted local+GitHub (verified each for unmerged work first); kept refactor/strip-old-composite-editor (5 unmerged commits = the K.65 strip starting point); salvaged g_dt_joint.md + build_g_parts.ts from failed agent A\'s worktree (→ K.75).' },
    { id: 673, bundle: 'K', lane: 10, start: 56.6, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.73 — RAG generative authoring Phases 1 + 2 — describe a part → graph in a tab (2026-06-11, f144c81..5355374). The L2-cache slice of K.68 realized as a working prompt→part loop. PHASE 1 (subagent B): corpus extractor src/lib/server/rag-corpus.ts walks the volume parts → one JSONL record each ({id, kind, description, tags, params, structure_summary}) at <volume>/ai/rag/parts.jsonl; POST /api/rag/rebuild + GET /api/rag/stats; ↻ rebuild button next to the sidebar filter + quiet "RAG corpus · N parts · Xm ago" footnote. Prod corpus = 29 records on first rebuild. PHASE 2 (5355374; modules salvaged from crashed subagent D\'s worktree): src/lib/server/rag-query.ts — corpus loader + pure BM25 (k1=1.5 b=0.75, doc text = description+tags+structure, zero-score cutoff) + topK(query, 5); src/lib/server/rag-prompt.ts — system prompt teaches the graph schema BY EXAMPLE (trimmed g_spiral literal: polygon + poly_repeat + call + params) + hard JSON-only rules, user prompt = top-k exemplars one-line each + the description; NEW POST /api/rag/prompt — BM25 → one Claude call (RAG_MODEL env, default claude-sonnet-4-6) → parseJsonLoose → validated {id, candidates, graph}. Proxied to prod in VOLUME_PROXY_PATHS (corpus + ANTHROPIC_API_KEY live prod-side; X-Volume-Local forces local). UI: violet ✨ prompt input under the sidebar filter row — Enter generates; the proposed graph opens in a NEW tab via the seedGraph prop (GraphEditorPane hydrates + auto-layouts it INSTEAD of fetching by id; exemplarId pre-set so first Save lands under the suggested name; volume untouched until then; seeded tabs excluded from tab persistence). Footnote doubles as status (generating… / from: <exemplar ids> / error). Verified live: "hexagonal prism with a central round bore" → g_hex_prism_bore with hex + bore poly_repeat loops, param-wired across-flats + length + subtract node. PHASE 3 (embeddings) deferred until the catalog passes ~200 parts. Plan doc: docs/plans/rag-prompt-builder.md.' },
    { id: 672, bundle: 'K', lane: 10, start: 56.0, weeks: 0.8, priority: 'high',   status: 'done',   title: 'K.72 — Polygon + PolyRepeat loop architecture overhaul + sidebar UX cluster + g_* migration Round 1 (2026-06-10/11, ~30 commits e0ff295..e14f00f, 3 of 4 parallel subagents shipped clean). LOOP ARCHITECTURE (#155–#157): PolyRepeatNode as a SEPARATE node type with its own canvas card (Params · Bindings · Loop sections); polygons embed loops via {kind:\'repeat-ref\', sourceId} entries interleaving with literal vertices in any order — each ref splices N points at its row position; hydrate auto-migrates legacy inline repeats. NPts auto-injected as a const in every loop arrow body (theta = i*tau/NPts Just Works); bindings emit after NPts + cascade left-to-right per-iteration. Wire sockets: poly_repeat output (violet) → polygon per-row repeat-ref input; NPts input (amber) accepts p.<name> drops. 3-state vertex colours (red literal · violet parametric · purple loop-generated). SVG popover: ⋮⋮ drag grip + ↩ snap-back + frozen viewBox + click-to-insert with edge-hover (green/🚫) + click-to-delete. Expression popover: r/z (x/y) tab strip + ƒ on loop slots + mode-aware axis labels; mv/rot ƒ buttons route to the same shared popover. CRITICAL per-point UI rule: always entryIdxForEvalIdx(node, i) — direct points[i] silently breaks on repeat expansions (memory entry_idx_eval_idx_gotcha). Also: NaN guard in resolveProfile (mid-edit typos → degenerate geometry instead of WASM crash); usesOf + extractParamsBlock regex fixes accept JSON-quoted keys (unblocks ALL programmatic build scripts — memory json_stringify_meta_regex_traps). G_* ROUND 1 (graph-authored .asm.ts exemplars, per-part docs at docs/parts/g_<id>.md): g_spiral (flat coil, 2 interleaved loops), g_star (extruded star prism, conditional i%2 binding), g_collar (revolved hollow chamfered tube); g_dt_joint DEFERRED → K.75. SIDEBAR UX (subagent C): A↓ global alpha-sort toggle (localStorage); ✎ inline rename via POST /api/primitives/rename; broken-refs scan + repair via NEW POST /api/rag/scan-refs (toast after rename lists N dependents + [Repair all] rewrites their src:\'<old>\' refs); drag-from-sidebar onto canvas creates a Call seeded with meta.params defaults at the drop point (clientToCanvas inverts pan+zoom); call-card title hyperlink opens that primitive in a new tab (onOpenTab). Detail: memories polygon_repeat_loop_architecture + session_handoff_2026-06-11.' },
    { id: 671, bundle: 'K', lane: 10, start: 57.9, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.71 — Graph-editor follow-ups (TODO queue surfaced 2026-06-09 evening). Open items: (a) LIFTED profile params — the profile-picker chip on a Call arg only switches the profile KIND; the kind\'s own params (r, len, h, …) still need hand-edited JSON. Render each profile param as an extra arg row under the chip so the dials surface. (b) Volume profiles in picker — load .prvl.ts / .prex.ts from /api/primitives/profiles/list so saved custom profiles appear alongside the curated kinds. (c) DONE 2026-06-10/11 — visual (r, z) point editing shipped as the Polygon card + SVG popover + PolyRepeat loops (K.72). (d) Source-tab text edit — make the SRC pane editable for hand-tweaks (currently read-only). (e) Ghost translucency — actual alpha on the ghost overlay (today it renders opaque in the per-source color, not see-through). (f) Auto-bake debounce when a slider is being dragged. (g) Bake cache LRU — the cache volume is at ~91 MB; trigger Phase-3 eviction before the 500 MB ceiling. (h) Lightweight floating nav button now that the top Navbar is gone — restore cross-page nav without the redundant chrome.' },
    { id: 670, bundle: 'K', lane: 10, start: 54.0, weeks: 1.5, priority: 'high',   status: 'done',   title: 'K.70 — /primitives multi-tab wrapper + GraphEditorPane extraction + UI polish session (2026-06-09, ~30 commits, c8b5a82..21338a4 + 37ce44a..e6252a2). MAJOR session: rebuilt /primitives as a multi-tab editor around the extracted GraphEditorPane.svelte (no iframes — tabs mount the component directly, isolated WASM state per tab). Sidebar of primitives groups (basic / completions / stdlib / stdstale / archived) + filter + per-tab close + persisted open-tabs state (localStorage prim-open-tabs / prim-active-tab-id). Trim chain: removed redundant "Graph editor" title above the canvas; removed the top Flowbite Navbar (CAD Train | Primitives | Vocab | Wells | FEM | Forge | Volume | Plan); content row now fills the full viewport. Layout overflow fix: `.layout` + `.prim-root` switched from `grid-template-rows: 1fr` to `minmax(0, 1fr)` (the `1fr` default of `minmax(auto, 1fr)` let canvas content force expansion to 1343px on a 598px viewport — clamped back to viewport with this + `min-height: 0` cascade). Camera/scene fix: PrimitiveDualScene auto-centers the OrbitControls target on the geometry bbox each refresh (scene.partCenter); cam.y bumped to 50; Z-pan slider range expanded -50..200. Mule_shoe build chain (the originating goal): composed via r_tube + r_cuboid + rot + mv + subtract — saved to basic/, 5 nodes, z 1.00. Profile picker authoring MVP (#119): chip on Call args that switches the profile kind via the descriptor. SRC + MD tabs in the editor right pane (#118); MD tab gains an AI icon that generates a description of the part. Vertical toolbar on the canvas left edge (+, save, bake, auto, ghost-clear, undo, ⚙ settings, reset). Push-apart with wire repulsion + boundary half-planes (#116, merged from worktree subagent). Per-card 👁 ghost mode (auto-translucent during composition); resize handles on cards (width persisted to graph.layout, snaps to label-fit floor); status badges in canvas bottom-left (save state + node count + zoom); sort dropdown for the primitive list (A-Z / Recent / Source via localStorage ge-picker-sort); profile arg detection in dep paramKeys regex (842fa8c fixed the quoted-JSON-keys bug behind the WASM "memory access out of bounds"). UX polish: ⚙ canvas-settings menu rebuilt as a Flowbite-style dropdown anchored to the button\'s getBoundingClientRect (was a wide button-list panel at hardcoded top:220px that drifted as ghost-clear/undo buttons appeared above it); two action rows (Auto-layout, Push apart) + separator + two boolean checkbox rows (Left/Right boundary repellant). + picker also anchored to its rail button\'s bounding rect + outer wrapper height:480px overflow:hidden so only the inner Call list scrolls (the CSG/Transform/Container sections stay pinned at top). Edge-bound indicators: the small circular ⏹/🔺/🔒 buttons pinned to the canvas edges were removed (redundant with the ⚙ menu checkboxes); BoundState simplified from \'off\'|\'repellant\'|\'confiner\' to \'off\'|\'repellant\' (legacy confiner persisted values read as off). /primitives sidebar gains overflow-y:auto + min-height:0 cascade so the rail scrolls when 100+ entries load. Pairs with K.69 (the /vocab editor uses the same Flowbite-style chrome); will be consolidated under K.67 (graph promotion) once the .asm.ts body becomes a derived projection.' },
    { id: 669, bundle: 'K', lane: 10, start: 53.0, weeks: 1.0, priority: 'high',   status: 'done',   title: 'K.69 — Vocabulary editor /vocab + boolean_modify rule + 41 completion seeds + mule_shoe exemplar (2026-06-06, pushed d3b696e..9ef94e9). First wave of K.68 phase 1 lands as a working editor + a new rule kind. 41 completion-parts seeds ingested from SVTC `comp_list.xlsx` into `docs/parts/vocabulary.seeds.json` (57 catalogue rows → 41 unique terms; multi-size variants kept in `variants[]`; 39 carry `compjson_ref` to the matching 2D silhouette at `static/svtc-compjson/*.json`, 72 files ~2.9MB). New script: `scripts/sync-svtc-compjson.ts` + `scripts/ingest-comp-list.ts`. /vocab page rebuilt as the vocabulary editor: Topology / Browse left tabs; right pane has Inferred / Proposed vertical trapezoidal rail (matches /primitives chrome), 30/70 outer split + 40/60 inner split (canvas / params+rule details). Definition + chip groups encapsulated in a ⓘ Definition & tags popover so the tab body focuses on params + 3D bake. Inline Bake + Promote in the title row. Parameters use ParamGrid in a .pg-acc-wrap accordion (identical to /primitives Build tab). Layout contracts captured in src/routes/vocab/CLAUDE.md (the zoom-loop bug fix from display:flex column + flex:1 1 auto + min-height:480px on .bake-body — needed to prevent the canvas auto-fit feedback loop). 2D→3D inference pipeline: `src/lib/authoring/compjson-to-profile.ts` reads SVTC compjson half-section drawings (LEFT = section cut / bore, RIGHT = OD silhouette), classifies elements by x-midpoint, transforms the dominant section polyline to [r,z] pairs via OD-calibrated scale. Pure deterministic, no ML weights. Tested live on 4 seeds: mule_shoe 5-vert chamfered tip, tubing_pup / flow_coupling plain cylinders, nipple_r_landing auto-captures 4 landing grooves on the OD as alternating r-bands. New `boolean_modify` rule kind: `src/lib/authoring/proposal-translator.ts` translates `proposed-vocab-entries.json` entries into source. Rule body = a polygon_inline primitive + a `modifiers[]` chain of {op, shape}. First shape: tilted_slab (rectangular slab whose top face is the cut plane, rotated around an axis by an angle, anchored at a Z — carves one half-space). First use: mule_shoe\'s 45° angled bottom cut on a hollow tube + box top. Future shape slots: cylindrical_hole_ring (perforated pups), thin_slot_ring (slotted liners), lateral_pocket (side-pocket mandrels), j_slot_grooves (indexing). Each new shape = a multiplier across many parts. mule_shoe end-to-end as the exemplar — bakes to 3456 verts · z=9 · r=2 with the slanted cut visible. Endpoints: POST /api/vocab/infer?term=<slug>, POST /api/vocab/bake-proposed?term=<slug> (body {params?:[]} for slider-driven re-bake), POST /api/vocab/promote-proposed?term=<slug> (writes the full entry into vocabulary.json + bumps version + saves dt_<slug>.prim.ts to volume + flips seed status to promoted). Three new CLAUDE.mds: src/routes/vocab/, src/lib/authoring/, src/routes/api/vocab/.' },
    { id: 668, bundle: 'K', lane: 10, start: 58.5, weeks: 1.5, priority: 'high',   status: 'open',   title: 'K.68 — Generative authoring (vocabulary → translator → multi-tier cached generation with WebGPU local LLM, supervised) (added 2026-06-05). User-driven pivot away from hand-authored parts and ad-hoc rewrites — every dp_* this session was either hand-written or imported from a legacy backup, none were GENERATED from a description, and that doesn\'t scale. THE VOCABULARY: a compositional grammar of part terms — shaft = cylindrical profile; tube = larger shaft .subtract( smaller shaft ); collar = revolve profile with locally-larger OD; pin = shaft + tapered nose; box = tube + counterbore (female complement of pin); joint = ordered composition of pin+body+box via tail() datum; stand = N joints stacked. Each entry has a definition, synonyms (RAG aliases), a structured rule (in the K.62 IR shape — imports + composition tree + param mapping), an exemplar part id, and expected bake metrics. THE TRANSLATOR (`src/lib/authoring/rule-translator.ts`): pure deterministic function `Rule → AsmSource` that compiles a vocabulary rule (or any rule conforming to the schema) into a runnable `.asm.ts` / `.rev.ts` via the existing `composition-tree.ts` data layer (applyToSource + addAssemblyParam + the K.62 emit pipeline). NO LLM IN THE TRANSLATOR — it\'s pure compile. THE FIVE-TIER CACHE (descending cost): L1 vocabulary term/synonym lookup (0 tokens, 0ms, client-side JSON match) → L2 cached generations vector lookup against IndexedDB authoring_cache + the existing $APP_DATA_DIR/ai/training_data pattern (0 tokens, ~50ms embed match) → L3 translator-from-rule (0 tokens, ~5ms deterministic compile when a vocab rule matched) → L4 WebGPU LLM emits a RULE conforming to the vocabulary schema (NOT raw source) and the translator compiles it (0 tokens, ~1-5s in-browser, structured-output mode for constrained generation) → L5 Claude API `/api/author` server fallback when WebGPU low-confidence or unavailable (token-cost, ~1s, highest quality). The translator is the SAME for all five tiers — rule comes from different sources but compiles the same way. CRITICAL INSIGHT: constrained generation (LLM emits structured RULE matching the schema, not raw `.asm.ts`) is dramatically smaller output + validatable + the deterministic translator handles correctness — far better than asking the LLM to emit runnable source. SUPERVISION PANEL (Phase 5 — equally critical, not afterthought): meaningful + fast human-in-the-loop oversight on every generation. Side-by-side: description input + generated rule JSON + live 3D bake preview + cited exemplars + trust signal badge ("L1 vocab hit · pin" / "L4 WebGPU · 87% confidence · 2 exemplars"). Keyboard-bound Accept (Y — caches to L2) / Reject (N — logs failure mode + opens refine) / Refine (R — edit rule fields in place, re-translate, see diff). Diff view between generations: which rule fields changed + bake-metric delta (verts, z-extent, etc.). Always reversible. The supervision panel makes generative authoring trustable + scalable — without it, the whole stack is a black-box source dumper users can\'t validate at speed. SVTC chatbot integration via the same panel: chat suggests, supervisor approves. SIX-PHASE ROLLOUT: Phase 1 (3 days) — vocabulary.json + vocabulary.md + synonym map (docs/parts/), with the dp_test pipeline parts (shaft/tube/collar/pin/box/joint/stand) as the first rule set. Phase 2 (3 days) — rule-translator.ts + regenerate every dt_* part from its vocab entry as the validation contract (translator passes iff bake metrics match the manual baseline). Phase 3 (2 days) — client-author.ts orchestrator with L1+L2+L3 wired (IndexedDB / training-data cache for L2). Phase 4 (4 days) — WebGPU LLM integration: model selection (Mistral-7B-Instruct via web-llm, Llama-3-8B-Instruct, or a domain-tuned small model), structured-output constrained decoding for the rule schema, prompt engineering with vocab + retrieved exemplars as context. Skipped gracefully when WebGPU unavailable (falls to L5). Phase 5 (3 days) — supervision panel UI inside CompositionEditor; side-by-side preview; diff view; keyboard shortcuts; trust signals. Phase 6 (2 days) — /api/author server (Claude) as L5 fallback + the SVTC-style chatbot panel binding. WIN: a "drill pipe pin, 4 1/2" OD, NC50 thread" description hits L1 (vocab match on "pin") → translator generates source from the pin rule → user supervises (≤1s of input) → cached for next time. Repeat description = 0 tokens, 50ms total. Novel description = WebGPU 1-5s offline → cached. Token-expensive Claude calls only for hard cases. REPLACES the hand-rewrite anti-pattern observed during the dp_test session (every non-curated profile triggered an ad-hoc `/tmp/dt_*_swap.ts` script — the right architecture pushes that into the vocabulary + lets the system absorb new rules over time).' },
    { id: 667, bundle: 'K', lane: 10, start: 60.0, weeks: 1.2, priority: 'high',   status: 'open',   title: 'K.67 — Graph promotion: promote the composition tree + bindings to source-of-truth, demote the `.asm.ts` body to a derived projection (added 2026-06-03). Surfaced after the user observed that we are hand-rolling a reactive dataflow system on top of JavaScript source text, and the resulting bug class (silent unwired params, name-matching as a magic concept, tagManifold not propagating originalIDs, parse → mutate → re-emit text round-trips that lose information, the K.61/K.66 child-drift problems) is exactly what a graph-based parametric system makes impossible by construction. Every grown-up CAD parametric system (Grasshopper, Houdini, FreeCAD Expression Engine, Onshape FeatureScript references, Blender Geometry Nodes) converged on a dataflow graph as the source-of-truth + a text projection (or no text at all) for the same reason. K.67 is the architectural shift to that model. NEW MODEL: (1) meta.composition stays the TreeNode root from K.62/K.63 but is the ONLY source-of-truth for the assembly\'s shape — no text body fallback. (2) NEW `meta.bindings: [{ from: \'p.<param>\', to: \'<callId>.<paramKey>\' }, ...]` is the first-class edge list: each wire from an assembly-level meta.params row to a child Call\'s arg slot is an entry. Replaces the current text-substitution wiring (literal "p.length" inside a Call arg) with a typed reference object. Removing a param walks edges + warns the user about orphaned slots before deleting. Renaming a param updates every edge\'s `from`. (3) The function body is auto-emitted from the tree+bindings on every save (same as today, but the emit becomes deterministic + the reverse direction is no longer needed because edits go through the editor, not the source text). (4) NEW `src/lib/cad/composition-bake.ts` interpreter consumes the tree + bindings directly to produce a Manifold — skips the JS sandbox + new Function eval entirely for assemblies. Each Call node maps to `loadPrimitiveGeomById(call.src)` → object-args from bindings → wrapped boundary. CSG ops, mv/rot, transforms walk the tree literally. The bake stops being text-eval + becomes a tree walk, removing a whole class of "what string did this parse as" bugs. (5) The /api/primitives/save endpoint keeps writing `.asm.ts` for legibility / grep / git history, but the file format gains a `meta.graph` block carrying the tree + bindings as JSON literal — and on open the editor reads `meta.graph` IF present, falling back to the parsed body otherwise. New saves always include `meta.graph`; old `.asm.ts` files migrate on first save. (6) In the editor (CompositionEditor.svelte), wiring a param to a slot becomes a drag from the param row to the slot (or click "wire" on a slot → pick assembly param), producing an edge object — no more text-substitution-via-ƒ-popup. The ƒ popup stays for ARBITRARY expressions (Math.PI, p.od/2 - p.wall) but a simple `p.X` ref is the typed edge case. (7) Reactivity: Svelte 5 runes wrap the graph as $state — when a dial changes, only downstream Calls re-bake (we already cache builds per-dep in primitive-loader.ts, this just makes the dependency set explicit instead of derived from text). IMMEDIATE BENEFITS that fall out: (a) unwired meta.params row is impossible — adding a row that nothing references shows up as "no outgoing edges, dialing won\'t do anything; add an edge?" the moment you create it; (b) refactor / rename is a graph walk; (c) the K.66 drift detection becomes a node-property hash diff vs an embedded JS-string sniff; (d) the K.62 composition model already IS a tree — we just need to stop pretending the text body is the model; (e) the JS sandbox eval becomes optional (only for arbitrary-expression slots), making typed CAD operations type-checkable; (f) bake parallelization (K.52) becomes obvious because the graph IS a DAG. MIGRATION PATH: ship in 4 phases over 1-2 weeks: Phase 1 (3 days) — `meta.graph` JSON literal + reader/writer; CompositionEditor reads graph first, body as fallback; new saves include graph. Phase 2 (3 days) — `composition-bake.ts` interpreter; `/api/primitives/preview` routes asm parts through the interpreter when meta.graph present; A/B against existing text-eval path. Phase 3 (3 days) — typed `meta.bindings` edge list; drag-to-wire UI; ƒ popup still covers arbitrary expressions; "unwired param" warning becomes a structural impossibility. Phase 4 (3 days) — drop text-fallback path; `.asm.ts` body becomes purely a projection (read-only on disk, regenerated on every save); deprecate the parse-body-as-source flow. Each phase is independently shippable; phases 1-2 produce no UX change while flipping the engine. Replaces a long tail of patches: the K.61 child-drift cache invalidation; the K.66 child-changed alert; the silent-unwired-param bug from this session; the tagManifold mesh-options trick; the partHashId text-emit dance.' },
    { id: 665, bundle: 'K', lane: 10, start: 61.2, weeks: 0.8, priority: 'medium', status: 'open',   title: 'K.65 — Modularize the big files (added 2026-06-02). Top offenders (lines): PrimitiveView.svelte 3387, CompositionEditor.svelte 1872, routes/primitives/+page.svelte 1410, ProfileFnEditor.svelte 1149, plan/details.ts 929, composition-tree.ts 774, builder.ts 741. Three of those (PrimitiveView, CompositionEditor, ProfileFnEditor) shrink mostly through the K.63 strip (worktree-agent PR in flight as of 2026-06-02 evening, drops the OLD composite UI from PrimitiveView once .prim.ts editing is gone). Post-strip targets: (1) PrimitiveView splits into PartView (param accordion + 3D viewer + source tab) + StdlibViewer (read-only banner + the kind-dispatched mounts). (2) CompositionEditor extracts the per-row Call accordion (props grid + mv/rot editors + Transform/Method toolbar + color swatches) into CompositionCallRow.svelte, and the imports section into CompositionImportsList.svelte. (3) ProfileFnEditor extracts composeSource + parseBody + bodyTooComplexToDecompose into src/lib/shared/profile-fn-compose.ts (pure functions, easier to unit-test the round-trip after the 2026-06-02 fix chain 60a1f30 / 4901e49 / 7f98a13). composition-tree.ts can stay near 800 lines but split into composition-parse.ts / composition-emit.ts / composition-mutate.ts so docs/COMPOSITION.md three-section API maps 1:1 to file boundaries. builder.ts loses its dead-after-strip primitive-composite render branch. routes/primitives/+page.svelte gets cleaner once typedCreate stops mirroring old + new kinds. plan/details.ts is mostly long copy strings; reorganise per-bundle only if it produces merge conflicts. Goal is structural — no file in src/ over 1000 lines without a real reason. Ship in 4 PRs: (a) extract CompositionCallRow + CompositionImportsList (1 day, low risk); (b) extract profile-fn-compose helpers + unit tests (1 day, medium risk because round-trip subtleties); (c) split composition-tree.ts (half day, mechanical); (d) post-strip PrimitiveView split (1 day, needs K.63 strip merged first).' },
    { id: 659, bundle: 'K', lane: 10, start: 47.5, weeks: 0.4, priority: 'medium', status: 'done',   title: 'K.59 — Implement `taper` in r_weld_extrude (DONE 2026-06-02, commits 947a72d + 6c8eb80). Wired the long-dropped 5th arg through CrossSection.extrude\'s scaleTop tuple (the Vec2 `[s, s]` form works fine WITHOUT a follow-up .warp — the bug we deferred for was the scalar-1 + warp combo, memory: manifold_extrude_scaletop_warp_bug). Branch matrix on (twist, taper): tw=0/tp=0 → bare extrude(h); tw=0/tp≠0 → extrude(h, 1, 0, [s, s]) where nDivisions=1 + non-1 scaleTop sidesteps the coincident-slice degeneracy; tw≠0 → twist morphing with or without taper. Followup (6c8eb80) moved the formula INTO the part body — buildExtrudeSource now emits `const scaleTop = [1 - taper, 1 - taper];` so users can see + edit the math directly; r_weld_extrude gained an optional 7th positional scaleTopOverride that wins over the legacy taper-only path. Sign flipped to drilling convention (positive taper narrows the bottom, classic shaft / drill-bit shape). taper schema gained `unit: \'\'` so the dimensionless scale factor stops being tagged as mm. The loader-side sig-rewrite was also fixed to preserve trailing optional args past meta.params (otherwise scaleTopOverride got stripped, fix landed in same commit chain). Verified via /tmp/probe_taper2.ts on a rect profile: taper=+0.5 narrows bottom (0.375 vs top 0.75), taper=-0.5 flares bottom (1.125), taper=0 straight prism. Existing parts (taper=0 by default) unaffected; existing parts with non-zero taper get the new behaviour through the legacy fallback path. The user observation that prompted the fix: "the taper does not work in the assembly". Hand-wound rail-weld variant (the K.50(b)\' alternative described in the original plan note) is still future work IF non-linear per-v taper is needed (the per-v multiplicative form mentioned there).' },
    { id: 700, bundle: 'L', lane: 11, start: 57.5, weeks: 1.0, priority: 'high',   status: 'open',   title: 'L.1 — OAuth identity port from SVTC: Google OAuth + signed-session → event.locals.userId via sequence() in hooks (existing AUTH_TOKEN/proxy/rate-limit unchanged). Plan ready: docs/plans/oauth-identity.md. Blocked on user-provisioned Google OAuth creds.' },
    { id: 701, bundle: 'L', lane: 11, start: 58.5, weeks: 0.3, priority: 'medium', status: 'open',   title: 'L.2 — Public parts category: add `public` to LIBRARY_CATEGORIES (resolvers iterate the tuple) + visibility:public on save. Ships without identity.' },
    { id: 702, bundle: 'L', lane: 11, start: 58.8, weeks: 1.0, priority: 'high',   status: 'open',   title: 'L.3 — Private per-user parts under components/<userId>/ (REQUIRES L.1): user-scoped resolvers + owner enforcement; close R2 (/api/volume path guard), R3 (private out of proxy), R4 (list-cache by userId), R5 (id-collision scoped).' },
  ];

  // Bundle-relative codes (A.1, B.3, …) computed from index within bundle.
  const codeById = new Map<number, string>();
  {
    const idx = new Map<string, number>();
    for (const t of tasks) {
      const next = (idx.get(t.bundle) ?? 0) + 1;
      idx.set(t.bundle, next);
      codeById.set(t.id, `${t.bundle}.${next}`);
    }
  }
  const codeFor = (id: number) => codeById.get(id) ?? `#${id}`;

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
  const LABEL_W  = 320;
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
  const minStart = $derived.by(() => {
    let m = 0;
    for (const t of visibleTasks) m = Math.min(m, t.start);
    return Math.floor(m);
  });
  const maxEnd = $derived.by(() => {
    let m = 0;
    for (const t of visibleTasks) m = Math.max(m, t.start + t.weeks);
    return Math.ceil(m + 0.5);
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
    <div>
      <h1>Plan</h1>
      <p class="sub">
        {#if viewMode === 'done'}
          {doneCount} shipped · click any item for detail
        {:else}
          {openCount} open · {BUNDLES.length} bundles · weeks since May 2026 · now ≈ W{doneFrontier} · horizon W{maxEnd}
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
  </div>

  <!-- Controls + priority legend -->
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

  <div class="chart-wrap">
    <svg
      width={LABEL_W + chartWidth}
      height={chartHeight}
      class="gantt"
      role="img"
      aria-label="cadtrain Gantt"
    >
      <!-- Grid + week labels -->
      <g transform="translate({LABEL_W}, 0)">
        {#each Array(totalWeeks + 1) as _, w}
          <line x1={w * WEEK_PX} y1={0} x2={w * WEEK_PX} y2={chartHeight}
                stroke={w % 4 === 0 ? '#cbd5e1' : '#e2e8f0'} stroke-width={w % 4 === 0 ? 1 : 0.5} />
          {#if w < totalWeeks}
            <text x={w * WEEK_PX + 6} y={16} fill="#64748b" style="font: 10px ui-monospace, monospace">
              W{(w + minStart) >= 0 ? '+' : ''}{w + minStart}
            </text>
          {/if}
        {/each}

        <line x1={0} y1={HEAD_H - 2} x2={chartWidth} y2={HEAD_H - 2} stroke="#cbd5e1" stroke-width="1" />

        <!-- Now marker — the work frontier, derived as the latest END
             among done items (self-maintaining; was hardcoded weekX(0),
             which pinned "Today" to the May-2026 epoch forever). -->
        <line x1={weekX(doneFrontier)} y1={HEAD_H} x2={weekX(doneFrontier)} y2={chartHeight}
              stroke="#ef4444" stroke-width="2" stroke-dasharray="4 3" />
        <text x={weekX(doneFrontier) + 4} y={HEAD_H + 12} fill="#dc2626" style="font: 10px system-ui; font-weight: 600">Now · W{doneFrontier}</text>
      </g>

      <!-- Left label column header -->
      <rect x={0} y={0} width={LABEL_W} height={HEAD_H - 2} fill="#f8fafc" />
      <text x={12} y={18} fill="#334155" style="font: 11px system-ui; font-weight: 600">#</text>
      <text x={48} y={18} fill="#334155" style="font: 11px system-ui; font-weight: 600">Task</text>
      <text x={LABEL_W - 60} y={18} fill="#334155" style="font: 11px system-ui; font-weight: 600">Bundle</text>
      <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={chartHeight} stroke="#cbd5e1" stroke-width="1" />

      <!-- Bundle headers + task rows -->
      <g transform="translate(0, {HEAD_H + 8})">
        {#each flatRows as row, i}
          {@const yOff = rowYAt(i)}
          {#if row.type === 'header'}
            {@const expanded = expandedBundles.has(row.bundle.id)}
            <rect x={0} y={yOff} width={LABEL_W + chartWidth} height={HEADER_ROW_H} fill={row.bundle.tint} fill-opacity="0.12" />
            <rect x={0} y={yOff} width={6} height={HEADER_ROW_H} fill={row.bundle.tint} />
            <rect x={0} y={yOff} width={LABEL_W + chartWidth} height={HEADER_ROW_H}
                  fill="transparent" onclick={() => toggleBundle(row.bundle.id)} style="cursor: pointer">
              <title>Click to {expanded ? 'collapse' : 'expand'} {row.bundle.id} — {row.bundle.name}</title>
            </rect>
            <text x={20} y={yOff + HEADER_ROW_H / 2 + 4} fill="#334155"
                  style="font: 12px system-ui; font-weight: 700; pointer-events: none">{expanded ? '▾' : '▸'}</text>
            <rect x={36} y={yOff + HEADER_ROW_H / 2 - 9} width={22} height={18} rx={3} fill={row.bundle.tint} />
            <text x={47} y={yOff + HEADER_ROW_H / 2 + 4} fill="#fff"
                  style="font: 11px system-ui; font-weight: 700; text-anchor: middle; pointer-events: none">{row.bundle.id}</text>
            <text x={68} y={yOff + HEADER_ROW_H / 2 + 4} fill="#1e293b"
                  style="font: 12px system-ui; font-weight: 600; pointer-events: none">
              {row.bundle.name}
            </text>
            <text x={68 + row.bundle.name.length * 6.8 + 14} y={yOff + HEADER_ROW_H / 2 + 4}
                  fill="#64748b" style="font: 10px system-ui; pointer-events: none">
              · {row.count} task{row.count !== 1 ? 's' : ''} · {row.totalWeeks.toFixed(1)}w{row.activeCount ? ` · ${row.activeCount} active` : ''}
            </text>
          {:else}
            {@const t = row.task}
            {@const barX = LABEL_W + weekX(t.start)}
            {@const barW = Math.max(t.weeks * WEEK_PX, 12)}
            {@const color = PRIORITY_COLOR[t.priority] ?? '#64748b'}
            {@const active = activeIds.has(t.id)}
            {@const isHover = hoverId === t.id}

            <text x={32} y={yOff + ROW_H / 2 + 4} fill="#64748b" style="font: 11px ui-monospace, monospace">
              {codeFor(t.id)}
            </text>
            <text x={68} y={yOff + ROW_H / 2 + 4} fill="#1e293b" style="font: 12px system-ui">
              {t.title.length > 46 ? t.title.slice(0, 44) + '…' : t.title}
            </text>
            <rect x={LABEL_W - 28} y={yOff + ROW_H / 2 - 8} width={20} height={16} rx={3}
                  fill={BUNDLES.find(b => b.id === t.bundle)?.tint ?? '#94a3b8'} />
            <text x={LABEL_W - 18} y={yOff + ROW_H / 2 + 4} fill="#fff"
                  style="font: 10px system-ui; font-weight: 700; text-anchor: middle">{t.bundle}</text>

            <rect
              x={barX} y={yOff}
              width={barW} height={ROW_H}
              rx={4} ry={4}
              fill={color}
              fill-opacity={t.status === 'deferred' ? 0.35 : t.status === 'done' ? 0.55 : isHover ? 1 : 0.85}
              stroke={active ? '#f59e0b' : (isHover ? '#0f172a' : 'none')}
              stroke-width={active ? 2.5 : (isHover ? 1.5 : 0)}
              onmouseenter={() => hoverId = t.id}
              onmouseleave={() => hoverId = null}
              onclick={() => selectedId = t.id}
              style="cursor: pointer; transition: fill-opacity 120ms"
            >
              <title>{codeFor(t.id)} (#{t.id}) — {t.title}
Bundle: {t.bundle} · Priority: {t.priority} · Status: {t.status}
W{t.start} + {t.weeks}w
Click for plan details</title>
            </rect>

            {#if t.status === 'done'}
              <text x={barX + barW / 2} y={yOff + ROW_H / 2 + 4} fill="#fff"
                    style="font: 10px system-ui; font-weight: 700; text-anchor: middle; pointer-events: none">✓</text>
            {/if}

            <text x={barX + barW + 6} y={yOff + ROW_H / 2 + 4} fill="#64748b"
                  style="font: 10px ui-monospace, monospace">{t.weeks}w</text>
          {/if}
        {/each}
      </g>
    </svg>
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
          <span>W{selectedTask.start} → W{Math.round((selectedTask.start + selectedTask.weeks) * 10) / 10}</span>
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
  .head h1 { margin: 0; font-size: 24px; font-weight: 600; color: #1e293b; }
  .sub { margin: 2px 0 0; font-size: 13px; color: #64748b; }
  .head-controls { display: flex; align-items: center; gap: 12px; }
  .toggle { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; font-size: 12px; }
  .toggle button { padding: 4px 12px; border: none; background: #fff; color: #475569; cursor: pointer; font: inherit; }
  .toggle button:hover { background: #f1f5f9; }
  .toggle button.on { background: #334155; color: #fff; font-weight: 600; }

  .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .legend-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px;
    border: 1px solid #e2e8f0; border-radius: 4px; background: #f1f5f9; font-size: 11px; color: #334155; cursor: pointer; }
  .legend-chip.active { background: #fff; border-color: #cbd5e1; }
  .legend-chip:hover { background: #fff; }
  .legend-chip .bid { font-weight: 700; }
  .legend-chip .bname { color: #475569; }
  .legend-chip .bcount { color: #94a3b8; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }

  .controls { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; font-size: 13px; color: #475569; }
  .controls select, .controls button { padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; font: inherit; cursor: pointer; }
  .controls button { font-size: 12px; color: #475569; }
  .controls button:hover { background: #f1f5f9; }
  .pri-legend { margin-left: auto; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pri-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #475569; }
  .active-dot { border: 2px solid #f59e0b; background: #fff; }

  .chart-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); overflow: auto; }
  .gantt { display: block; user-select: none; }

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
