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
    { id: 'M', name: 'Professional 2D sketcher', tint: '#9333ea', desc: 'Upgrade the hand-rolled SVG profile editor into a professional parametric 2D CAD sketcher: curve / fillet / chamfer / offset operators that live IN the composition graph (compile to the (r,z) points r_revolve/r_extrude already consume), a dedicated FULL-TAB editor with its own toolbar, built on Maker.js (Microsoft MIT). Plan: docs/plans/profile-sketcher.md.' },
    { id: 'N', name: 'External / embeddable API', tint: '#7c3aed', desc: 'Expose cadtrain as an importable API/SDK another app or an LLM agent can build on: serve parts, geometry (mesh-JSON / GLB / SVG), the authoring methodology + build mechanism; per-app authorization (hashed bearer keys + scopes) and a per-app on-volume namespace; OpenAPI docs + an LLM-friendly capability manifest. Facade over the existing endpoints (CORS, AUTH_TOKEN gate, /api/manifest already exist); adopts SVTC\'s shipped external-plugin SDK pattern. Plan: docs/plans/external-api.md.' },
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
    { id:  8, bundle: 'A', lane: 0, start: 57.4, weeks: 0.3, priority: 'low',    status: 'on-demand', title: 'Add new primitive types as drilling needs surface' },

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
    { id: 512, bundle: 'J', lane: 9, start: 57.4, weeks: 0.2, priority: 'high',   status: 'todo',   title: 'J.12 — AI refine Level 2: post-generation validation in the refine endpoint (imports allowlist · denylist scan · undefined-instance detection · syntax check · optional live-bake · retry-once-with-errors-fed-back)' },
    { id: 513, bundle: 'J', lane: 9, start: 57.6, weeks: 0.2, priority: 'high',   status: 'todo',   title: 'J.13 — AI refine Level 3: live-bake gate on the inspector Accept button — status pill ("✓ Builds" green / "✗ Bake failed: <msg>" red); Accept disabled on failure. Uses the existing /api/components/bake-preview endpoint, no backend changes' },
    { id: 514, bundle: 'J', lane: 9, start: 57.8, weeks: 0.2, priority: 'medium', status: 'todo',   title: 'J.14 — AI refine Level 4: assembly-aware prompt — when refining a composition, glob docs/assemblies/README.md + matching <assembly>.md into the system prompt. Today nothing in src/ reads docs/assemblies/ so the AI re-invents known recipes every refine' },

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
    { id: 613, bundle: 'K', lane: 10, start: 64.2, weeks: 0.3, priority: 'medium', status: 'deferred',   title: 'K.13 — Warp z-spline revisit (PARKED): give the warp path its OWN popup (open polyline anchored at origin, not the closed-profile ProfileEditor) + fix the suspected interpretation bug (Z-down anchor z0=min.z=top→s=0; planar-only frame; x-centered assumption).' },
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
    { id: 644, bundle: 'K', lane: 10, start: 63.5, weeks: 0.3, priority: 'medium', status: 'todo',   title: 'K.44 — D Phase 2 (DEFERRED): repeat_with_data(array, fn) for HETEROGENEOUS instances — BHA with mixed HWDP/drill pipe/stabilizers, per-iteration params from a data array. Sandbox = native data.map (no helper needed); recognizer extension to spot const items = data.map((d,i) => mv(<inst>(...d), [...])); return place(items). Build when a concrete varied use case lands.' },
    { id: 646, bundle: 'K', lane: 10, start: 42.2, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.46 — Subfolders inside completions/<family>/ + 📁+ folder-create button + dp_test_* parts (2026-05-28, ddbcab5 + 4c6a7ee). primitive-paths.findPrim walks a 3rd level; /api/primitives/list returns completionSubfolders so empty folders surface; save/move TARGET_RE accepts the nested form. UI: per-family 📁+ FloatingPanel POSTs /api/volume?action=mkdir (no new endpoint), nested fold per subfolder in the sidebar, move-to-folder picker includes subfolders as targets. Test parts authored to primitives/completions/drill_pipe/test/ on prod: dp_test_2_7_8_g105_nc31, dp_test_4_5_g105_nc46, dp_test_4_5_20_g105_nc50 (Perforator API spec rows pp 6-7, 14-15, 16-17) + dp_test_hwdp_5_spiral (3 helical wear pads via r_threads at wide pitch + 120° rotations).' },
    { id: 647, bundle: 'K', lane: 10, start: 42.6, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.47 — Visual loop (repeat row) in the profile editor — D3-join style without D3 (2026-05-28, 2659296 + 352bec5 + bbc48d3 + 6df44f6 + c0ff807 + 83a152e). + repeat cmd added to ProfileFnEditor Move type with a/b/c = count, x(i), y(i). composeSource emits Array.from spread when any repeat row present (mixed with mv/line static rows). parseBody Phase 2 recognizes Array.from({length: N}, (_, i) => BODY) — inline + block-with-local-calcs forms — with chained-calc inlining to fixpoint; parseCalc fixed to track brace depth (was leaking inner callback consts as top-level). Stacked layout: N + cmd + delete on row 1, x(i) and y(i) each get their own full-width row with monospace 13px for math readability. Three polar-pattern volume samples on prod: ngon_v2 (uniform r), star_v2 (alternating r via i%2), gear_v2 (sinusoidal rBase + amp*cos(teeth·θ)) — all decompose into one editable repeat row + render correctly (6/10/96 points). Curated Ellipse also decomposes into one repeat row with rMajor*cos((i/n)·2π) / rMinor*sin((i/n)·2π).' },
    { id: 648, bundle: 'K', lane: 10, start: 43.2, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.48 — Cartesian profile fix + parseBody return-array decomposition (2026-05-28, 4c6a7ee + 05fa017 + e95a97c). ProfileFnEditor DEFAULT_BODY + seedRows fallback branch on the `set` prop — cartesian + New profile now scaffolds a centered {w, h} rectangle (was the revolve half-section + r/len, which threw "build(p) must return ≥ 3 [r,z] points"). profile-fn validator error message neutralized to mention both axes. parseBody extended to extract structured moves from a tail return-array literal (rect/l/t/plus/cylinder/tube/cone/barrel/drill_pipe_pin all decompose). Procedural bodies (ellipse/ngon/star before K.47) preserved verbatim by composeSource so they still render via /profiles/resolve.' },
    { id: 649, bundle: 'K', lane: 10, start: 43.5, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.49 — Basic subfolders (Revolved / Extruded / test_primitives) + 6 extrude samples (2026-05-28, e96201e). /api/primitives/list returns basicSubfolders[] + tags entries with subfolder; save/move regexes accept basic/<sub>. Sidebar Primitives tab Basic group nests subfolder folds the same way Components families do; 📁+ button mirrors the per-family one; mkdir popup generalized to take parent ∈ {basic, completions/<family>}. Volume reorg on prod: 9 existing r_* → basic/revolved/; 6 extrude samples authored to basic/extruded/ — r_cube_ext (rect), r_cylinder_ext (ellipse), r_hex_prism (ngon_v2 polar), r_star_prism (star_v2 polar), r_gear_prism (gear_v2 polar), r_l_beam (l cartesian); basic/test_primitives/ empty playground. All six preview-build end-to-end against r_extrude(profile, length).' },
    { id: 655, bundle: 'K', lane: 10, start: 62.3, weeks: 0.7, priority: 'high',   status: 'todo',   title: 'K.55 — Sweep-along-path (3D path sweep, an extrude variant for non-linear axes). Today r_weld_extrude sweeps a 2D cross-section LINEARLY down z (straight prism, optional twist + taper). The natural generalization: sweep the SAME cross-section along an arbitrary 3D PATH — bends, helices, curved tubes, spline-driven sweeps, pipe runs that follow a hand-drawn 3D trajectory. Manifold-3d does not provide this natively (CrossSection.extrude is linear-only); the implementation is the hand-wound rail-weld path with ring positions placed along the path tangent + per-station local frame (Frenet or RMF — rotation-minimizing frame to avoid twist artifacts on turns). NEW stdlib `r_sweep` takes (profile, path_pts, optional twistFn(s), optional scaleFn(s)). The path is a 3D polyline OR a function s → [x, y, z] sampled at N stations. Each station gets a local frame; the cross-section is laid flat in that frame and the sides are stitched (gridPatch + capFan + weldAndBuild). Demos: U-bend pipe (path is two straights + a quarter-arc), helical coil (path = (cos(t), sin(t), t·pitch)), gooseneck cable run (Bezier 3D path), drill-pipe stand with a tapered bend at the joint. Pairs with the existing sweep/weld bench numbers: native r_weld_extrude does linear in ~1 ms; r_sweep on the same N×M grid should land in the 1.5–2× range (similar to W-twist vs CS-twist) because each station has the same per-vertex math just placed differently. Two builders that emerge: SweepPart (open path with end caps) + SweepLoop (closed path = torus-like). New file type: `<id>.swp.ts` mid-extension, dispatches a SweepPartBuilder (path editor + cross-section editor + 3D preview). Big future win: this enables anything that does not fit a straight extrude/revolve — gooseneck flow lines, coiled tubing, casing strings that follow a wellbore curve. Order it AFTER the K.55-precursor tab dispatch lands (Extrude/Profile/Assembly are simple cases first); then K.55 adds the path-sweep type alongside.' },
    { id: 657, bundle: 'K', lane: 10, start: 46.2, weeks: 0.1, priority: 'low',     status: 'done',   title: 'K.57 — A/B/C instance naming on drag-into-assembly + Mesh-Live label drop in legacy view (2026-05-29, NEXT). Per user — short alphabetical instance names (Excel-column-style: A, B, …, Z, AA, AB, …) in place of the current childId-derived ones (rod_4, my_try_extreude2). Easier to read in chained .add(A).add(B).subtract(C) expressions. Plus the \"Mesh (live)\" label chip in PrimitiveDualCanvas now hidden in the legacy AssemblyEditor view (already hidden in the typed-builder dispatch). Only one scene per pane so the label is visual noise.' },
    { id: 654, bundle: 'K', lane: 10, start: 44.3, weeks: 0.6, priority: 'medium', status: 'done',   title: 'K.54 — Visual Repeat block for Array.from + place(ring) at the PARTS layer (sister to K.47 at the profile layer). Today w_test_ring_of_pegs / w_test_cube_grid / w_test_bolt_row author the polar/grid placement idiom directly in source — `const ring = Array.from({ length: p.count }, (_, i) => { const a = (i / p.count) * 2 * PI; return mv(peg, [cos(a) * p.ring_r, sin(a) * p.ring_r, 0]); }); return place(ring);` — and the user has to mentally simulate what each `i` produces. The recognizer already spots a Repeat × N node in the ConstructionTree (D Phase 1, K.45, dp_inst_stand case) but the Parts/Composition editor does NOT yet expose it as an editable visual block the way the ProfileFnEditor does for repeat ROWS in 2D profiles. Goal: lift the parts-layer Array.from idiom into a first-class visual block. Three halves: (a) RECOGNIZE — extend recognize-composite.ts to detect the Array.from({length}, (_, i) => …) form WITH inline calc consts (currently only for-loop), capturing {count, perInstance: {translateX(i), translateY(i), translateZ(i), rotX(i), …}, basePart}. (b) RENDER — new RepeatBlock row in the Parts accordion of PrimitiveView with editable count + x(i)/y(i)/z(i)/rot(i) expression slots (textareas, same monospace style as K.47), small ⓘ helper with common patterns (linear, polar ring, polar disk, cartesian grid, fibonacci spiral, helical). (c) ROUND-TRIP — composeSource emits the same Array.from + place(...) shape back so the source stays hand-editable. Connects to deferred D Phase 2 (repeat_with_data heterogeneous, memory `todo_*` notes) — same visual block, the loop pulls from a data array instead of a literal range. One dimension up from K.47 (2D points) to 3D placement.' },
    { id: 652, bundle: 'K', lane: 10, start: 61.8, weeks: 0.5, priority: 'medium', status: 'todo',   title: 'K.52 — Parallel-build composite parts via web workers (then CSG sequentially). Today a composite like t_drilled_block builds every component (r_cube_ext, then r_cylinder, then r_cylinder, …) sequentially in ONE sandbox + then runs the CSG chain. The component builds are independent — they can spawn into per-worker subprocesses, run in parallel, and serialize back to a Manifold mesh; the main thread then walks the .add/.subtract/.intersect chain. Win scales with component count and per-component build cost; worth it for dp_stand (3× dp_joint), drill-pipe assemblies, and anything with many r_threads helices. Trade-offs: Manifold WASM must load in each worker (one-time per session, cache); mesh serialization adds bytes (mesh-serial already exists). Likely first pass: a worker pool ~CPU-count, the loader (primitive-loader.ts buildPrimitiveGeom) detects independent named instances and Promise.all-s them through the pool, then folds via the existing CSG chain. SvelteKit + Vite already support web workers (`new Worker(new URL("./prim-worker.ts", import.meta.url))`), so the scaffolding is small.' },
    { id: 650, bundle: 'K', lane: 10, start: 61.1, weeks: 0.7, priority: 'high',   status: 'open',   title: 'K.50 — Extrude expressivity overhaul (2D-CSG profile composition + (θ, r, z) parametric weld-extrude). One feature surface, three sub-steps that compose into "anything sweepable along z without the warp post-pass." Sub-steps: (a) 2D-CSG before extrude — use Manifold CrossSection to compose multiple cartesian profiles via union/subtract/intersect, then extrude the resulting polygon. New stdlib `r_csg_extrude` takes an array of {kind, params, op ∈ {base, add, subtract, intersect}} (or a profile-level construction tree); demo = rect − ellipse bore − hex bolt-hole pattern → one extruded plate. (b) Weld-extrude with rail-weld geometry — replace Manifold.extrude with gridPatch + capFan + weldAndBuild (same machinery as r_revolve in manifold-mesh.ts). u = around-section param, v = along-z; user supplies x(u, v) / y(u, v) / z(u, v) or — sugar — r(u, v) + θ(u, v). Cross-section can MORPH along z (taper, twist, sinusoidal scaling, blend between two profiles) without warp post-pass that K.13 was parked on; pairs naturally with the visual loop / repeat row (K.47) — same data-driven mental model, one dimension up. Demos: twisted hex bar (θ += twist*v), tapered cylinder (r decays with v), gear with helix angle (the teeth wind around). (c) Composition — the cross-section at each v can itself be a 2D-CSG composite, so (a) feeds (b). Net effect: "extrude" stops meaning "linear sweep of a fixed polygon" and starts meaning "rail-welded swept surface of an arbitrary 2D-CSG cross-section that can vary along v."' },
    { id: 660, bundle: 'K', lane: 10, start: 48.0, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.60 — Atomic rename for primitives (file + meta.id + meta.name + function-name + downstream uses all in one operation). Today the rename operation surfaced via the GUI / volume PUT only changes the FILENAME (`tube.asm.ts` → `tube_new.asm.ts`). The source body still says `id: \'tube\'`, `name: \'tube\'`, `export function tube(od) {...}`, AND every assembly that already declared `uses: [\'tube\']` keeps pointing at the OLD name. The downstream effect when nesting: the loader\'s `p`-injection regex (primitive-loader.ts:140-146) matches `function NAME(args)` where NAME = the requested-id. After a partial rename, NAME (`tube_new`) doesn\'t match the function-name (`tube`), so the regex doesn\'t inject `const p = {od};` and the body throws `"p is not defined"` at runtime as soon as it tries to read `p.od`. Standalone bake superficially worked (sometimes — depending on whether `p` was needed) which made the bug INVISIBLE until nesting surfaced it. Plan: NEW endpoint `/api/primitives/rename` that takes `{oldId, newId}` and atomically (a) walks every `.asm.ts` / `.exp.ts` / `.rev.ts` on the volume, rewrites `uses: [...]` entries that mention oldId + every `oldId(...)` call site in the body → newId; (b) opens the target file, rewrites `id: \'oldId\'` → `id: \'newId\'`, `name: \'oldId\'` → `name: \'newId\'`, AND `export function oldId(` → `export function newId(`; (c) renames the file. All three under one temp-file+rename txn so partial state is impossible. Surface in the GUI as a ✎-name button on the primitive\'s title chip; a confirm popup lists the N downstream assemblies that will be rewritten before applying. Also handle the collision-detection edge — if `newId` already exists OR is a SANDBOX_ARG_NAMES helper, refuse with a clear message. Surfaced 2026-05-29 when the `tube` collision investigation forced an in-flight rename to `tube_new`; ate ~30 minutes of debugging before the function-name mismatch was visible. Pairs with K.59 / K.61.' },
    { id: 662, bundle: 'K', lane: 10, start: 46.5, weeks: 1.0, priority: 'high',   status: 'done',   title: 'K.62 — Assembly composition model overhaul: lists-are-groups + per-row CSG chain + nested sub-lists + import/expression rows (2026-05-29..31, six commits 72786dc / 5fbb96f / b8c0de5 / 7a8e2fd / 247a9d2 / b3206aa). User-driven model shift away from K.56-D\'s single-op-per-row pill (▢add ▣subtract ◫intersect ▤place) which was unintuitive once the "list IS group" mental model was on the table. NEW MODEL — what the user sees in source: `return [A, B];` is the canonical compose (sandbox auto-place wraps any returned Array in a recursive Manifold.compose); CSG ops are authored as a LEFT-to-RIGHT chain per row (`const A = A_raw.subtract(B).intersect(C);`); groups are inner arrays (`[A, [C, B, D.intersect(E)]]` ⇒ nested place()). PHASE E.1 (72786dc) — sandbox wrapper installed in buildPrimitiveGeom auto-places Array returns recursively; Instance.ops {op, arg}[] data field; two-pass emitter (PASS1 `const NAME_raw = <placement>` + downstream tail/head refs lock onto `_raw` so a .subtract doesn\'t crop the column\'s stacking math; PASS2 ops chains); Instance.hidden field excludes operand-only rows from the return list; backward-compat migration on parse lifts legacy `op:\'subtract\'|\'intersect\'` to the previous row\'s ops chain + marks operands hidden. PHASE E.2 (5fbb96f) — per-row ⊕⊖∩ mini-toolbar: click an op button opens a FloatingPanel typeahead listing sibling row names; pick one and it appends to Instance.ops; existing ops render as `[∆ C ×]` chips with × to remove; auto-hide on append + auto-un-hide when the last reference is removed; 👁 toggle on hidden rows to also show them in the scene as an override; the single-op `<select>` and the currentOpForInstance / setInstanceOp helpers are GONE. PHASE E.3 data (b8c0de5) — Instance.children?: Instance[] for nested groups; recursive emit walks groups depth-first (children first, then `const NAME = [child names];`); sequential mate cursor is LOCAL to each group (entering resets, exiting locks onto the last visible child\'s tail); ops chains + overlay anchors cross groups freely (every binding in the same function scope); parser STRIPS `children: [...]` BEFORE other field scans so a regex field-getter doesn\'t reach into nested rows and pull a child\'s src/args up to the group; walkInstances / flatInstances public iterators. PHASE E.3 UI (7a8e2fd) — `+ Group (sub-list)` button at the top of the add-part popup creates an empty {children: []} at top level; group marker rows render as `🗂 G [B] [C] ✕` chips in the Sequential subtab; ✕ deletes the group AND promotes children back to top level so nothing\'s lost; filteredAsmParts excludes any row inside a group\'s children list. PHASE E.3.1 (247a9d2) — drag-into-group: 🗂 group markers become drop targets for the existing instance drag MIME (\'application/x-instance-name\'); drop a row onto a group → it reparents as last child; each child chip gains a ↗ button to promote back to top level; immutable tree manipulators removeFromTree / findInTree / moveIntoGroup / moveToTopLevel land in the data layer. PHASE E.4 (b3206aa) — IMPORT (alias) + EXPRESSION rows: user-proposed model shift. The classic tube case collapses from two atom instances + ops chain to ONE import (\`{name:\'A\', kind:\'import\', src:\'shaft\'}\` → \`const A = shaft;\`) + ONE expression (\`{name:\'tube_body\', mode:\'custom\', expr:\'A(p.od,p.len).subtract(A(p.id,p.len))\'}\` → \`const tube_body = A(p.od,p.len).subtract(A(p.id,p.len));\`). Recursive expressions fall out for free — each row binds a name in scope so later expressions reference earlier ones (\`whole = core.add(wing)\`). The + popup gains stacked buttons: 🗂 Group / 📥 Import (with sub-mode "pick primitive to alias") / ƒ Expression. Definitions section (blue) renders import rows above the subtabs; Expression section (amber) renders custom rows with inline blur-commit textarea. Bake-verified end-to-end: tube_new shape via /api/primitives/bake-preview 25532 bytes visible. DEFERRED to E.3.2 — RECURSIVE NESTED ACCORDION RENDERING: render each group\'s children as full per-row accordions inside the group\'s body (their own ops bar / mode pickers / drag handles / color swatches), not the flat chip list; needs a Svelte 5 snippet `{#snippet renderRow(inst, depth)}` that recursively renders + the per-row machinery extracted into a reusable inner snippet (~200 lines of markup extraction). DEFERRED to E.4.1 — expression-row authoring polish: typeahead autocomplete on sibling names + known methods (.subtract / .add / .intersect / mv / rot / tail / head / p.*); syntax highlight; live error annotation. DEFERRED to E.3.3 — DRAG-TO-SIBLING-GROUP (move a child from group A directly into group B); GROUP-LEVEL ops on the group ITSELF (\`const G_raw = [B, C]; const G = G_raw.subtract(F);\`) since groups are first-class composables too. All deferred items are pure UI/polish on the data-layer foundation (b8c0de5 + b3206aa shipped the runtime); they\'re independent of further runtime work. Bake regression baseline confirmed at each phase: legacy flat assemblies still produce 297712-byte GLB through the new wrapper; new-shape assemblies bake equivalently or better. Tracks K.56 → K.62 evolution; supersedes the per-row op pill model from K.56-D entirely (the op-pill markup is removed from PrimitiveView).' },
    { id: 679, bundle: 'K', lane: 10, start: 57.4, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.79 — MD AI-describe wired + polygon point-order markers + expr-popover viewport clamp (2026-06-12, 9afedbc..6a1fd80). Live-use batch, attempted as 4 parallel worktree agents — all stalled on an infra watchdog ~600s, so salvaged the one that had written files (MD) + redid the rest by hand. (1) MD-tab ✨ AI describe (#117) — NEW POST /api/primitives/describe: one Claude call (DESCRIBE_MODEL || RAG_MODEL || claude-sonnet-4-6) infers a drawing-descriptor markdown (Purpose · Function · Composition · Parameter table · Drawing notes [Z-down] · See also) from the emitted source + bake stats; button replaces drawingMd, failures prepend an HTML comment so MD is never wiped. Not proxied. Verified live on dt_collar_flat. (2) Polygon point-order markers — both profile-preview SVGs (popup + right-pane) ring the FIRST vertex green with "1" + the LAST orange with the point count so winding is readable; pointer-events:none (drag/click unchanged). (3) clampToViewport action measures polyExprPop + argExprPop after paint + shifts them on-screen so the vertex-edit popover never spills off the bottom/right.' },
    { id: 678, bundle: 'K', lane: 10, start: 58.4, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.78 — Auto-layout separation QUALITY (the post-crash follow-up). K.76 fixed the crash so auto-layout RUNS, but on dense graphs (g_dt_joint) it only partially de-overlaps. Two root causes: (1) `__POLY__<id>` profile references that wire a polygon to its consumer revolve/extrude are NOT modeled as layout edges in composition-layout.ts predecessorsOf/successorsOf — so a polygon and the Call it feeds collapse into the same depth-0 column and stack. Fix: treat an arg of kind expr matching /__POLY__(\\w+)/ as a data-flow edge polygon→call. (2) nodeSize() height estimates undersize the real rendered cards (variable-height param/accordion bodies), so forceSeparate thinks cards clear when they visually overlap. Fix: measure real card heights from the DOM (.ge-node bounding boxes) and pass them as nodeSize to forceSeparate during the push-apart pass. Together these make auto-layout produce a clean, readable arrangement on the polygon-heavy parts that are now the norm.' },
    { id: 677, bundle: 'K', lane: 10, start: 58.0, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.77 — L1 deterministic dictionary for generative authoring (retrieve-and-clone known parts). Surfaced 2026-06-12 when "flat collar" → blank: the prod proxy was down AND we asked Claude to INVENT a graph for a part we already have (g_collar / template_collar). The fix is the K.68 L1 tier: a curated phrase→{partId, paramOverrides} map (docs/parts/aliases.json or extend vocabulary.json synonyms). On a ✨ prompt, check L1 FIRST — exact/synonym match → load that part\'s known-good meta.graph + apply the param overrides (e.g. "flat collar" → template_collar with style=\'flat\'); 0 tokens, instant, OFFLINE (no prod proxy / no Claude), and it CAN\'T bake blank because it clones a graph that already works. Only fall through to the L2 Claude path (existing /api/rag/prompt) on an L1 miss. Incremental growth: each ACCEPTED ✨ generation that the user saves appends a phrase→savedPart alias, so the dictionary compounds (the RAG flywheel, pairs with K.75). Directly fixes the "blank known part" failure + removes the prod-proxy dependency for the common case.' },
    { id: 676, bundle: 'K', lane: 10, start: 57.4, weeks: 0.2, priority: 'high',   status: 'done',   title: 'K.76 — ✨ generate UX relocation + auto-layout crash fix (2026-06-12, e990523..3b6c2a2). UX cluster from live use: (1) the ✨ AI-generate input moved OFF the sidebar onto the graph editor\'s vertical rail — a violet ✨ button CENTERED between ⚙ and reset (equal flex spacers); its popover holds the instructions + a resizable description textarea (360px default, drag-resizable 264-720px, width persisted) and CLAMPS on-screen (measures after tick, never spills below the viewport — it sits at the rail bottom). (2) Generation now hydrates the proposed graph INTO the CURRENT tab (auto-layout + exemplarId set, tab relabeled) instead of opening a new one — the user generates from the open editor and the changes land there; a bad graph shows a visible popover error, not a blank canvas. (3) Push-apart MERGED into auto-layout (one button; the redundant menu row removed) and the auto pass runs PURE separation (useBounds=false) so the viewport boundary walls — which depend on pan/zoom — can\'t fling a card thousands of px off-screen (was sending one to y=4402). autoLayoutGraph rowGap 40→160. (4) THE BIG FIX — auto-layout "does nothing" was a CRASH: composition-layout predecessorsOf() fell through to `n.children.filter(...)` for unhandled node types, but polygon/poly_repeat have NO children → TypeError → autoLayoutGraph threw → the menu onclick aborted before closing + nothing moved. Since every revolve/extrude part has an inline polygon, auto-layout was broken on ALL of them. Fixed: polygon/poly_repeat are leaf producers (return []); container branch guarded (children ?? []). Diagnosed by importing the layout module live in the dev page (`await import("/src/lib/cad/composition-layout.ts")`) and running it on g_dt_joint\'s real graph — the stack pointed straight at the line. Memory: autolayout_predecessors_polygon_crash. Remaining separation-quality work → K.78.' },
    { id: 675, bundle: 'K', lane: 10, start: 57.6, weeks: 0.4, priority: 'medium', status: 'todo',   title: 'K.75 — g_* Round 2 + g_dt_joint composition showcase (#167). Blocker first: the graph emit path must handle `place([...])` cleanly (multi-Call compose returning an instanced list) — that is what deferred g_dt_joint out of Round 1. Then: g_dt_joint as the multi-part graph exemplar (box + tube + pin via place/tail), seeded from the salvaged draft at docs/parts/g_dt_joint.md + scripts/build_g_parts.ts. Round 2 migrations: g_dt_stand, g_tube (consolidate dt_tube + dt_tube_v2 + e_tube into one), g_dt_collar_{flat,tapered,rounded} (style enum like template_collar). Also wire the RAG prompt-loop flywheel: each ACCEPTED ✨ generation gets saved + the corpus rebuilt (↻) so it becomes a retrievable exemplar — the compounding loop from docs/plans/rag-prompt-builder.md.' },
    { id: 674, bundle: 'K', lane: 10, start: 57.0, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.74 — Stability fixes + instruction-surface modernization (2026-06-11 PM, 3c3d4c6..15697d5). FOUR FIXES from live use: (1) polygon card socket alignment (#168) — left-edge r/z + repeat-ref sockets assumed uniform 39px rows but CSS renders vertex rows at 45px / loop-ref rows at 38px; new polyRowTop() cumulative walk mirrors the CSS; wires + auto-height use it. (2) WebGL context budget (#169) — only the ACTIVE /primitives tab mounts PrimitiveDualCanvas (new `active` prop); inactive tabs keep all editor state but release their context (renderer.dispose + forceContextLoss on unmount); module-scope LRU fetch cache (12 entries, keyed on full request body) makes switching back instant with zero server round-trips. CLOSES the long-standing todo_webgl_context_leak (~16-context browser cap). (3) profiles/resolve 400 spam (#170) — both resolve $effects re-fire every render; identical request bodies are now skipped (bakeNonce still forces retry). (4) infinite-loop regression fix (84dc204) — the fetch cache made rebuilds synchronous, closing an identity-churn loop on the fresh-args prop → effect_update_depth_exceeded; rebuild effect now keys on serialized {id, args, source} content. Canonical pattern in memory fresh-array-props-effect-loops (same trap as the /vocab zoom loop). DOCS MODERNIZATION (Fable-5 era cleanup, background agent + main session): root CLAUDE.md rewritten ~330→158 lines — current architecture snapshot (GraphEditorPane one-editor-two-surfaces, stdlib/stdstale, tracked archive/), deduped rules with stable numbers, shipped-session ledgers moved to NEW docs/HISTORY.md; api/shared/cad CLAUDE.md refreshed vs actual code; MEMORY.md index trimmed 28.5KB→8.3KB (grouped by theme; topic files kept on disk). HYGIENE: all 12 stale agent worktrees removed + 18 merged/superseded branches deleted local+GitHub (verified each for unmerged work first); kept refactor/strip-old-composite-editor (5 unmerged commits = the K.65 strip starting point); salvaged g_dt_joint.md + build_g_parts.ts from failed agent A\'s worktree (→ K.75).' },
    { id: 673, bundle: 'K', lane: 10, start: 56.6, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.73 — RAG generative authoring Phases 1 + 2 — describe a part → graph in a tab (2026-06-11, f144c81..5355374). The L2-cache slice of K.68 realized as a working prompt→part loop. PHASE 1 (subagent B): corpus extractor src/lib/server/rag-corpus.ts walks the volume parts → one JSONL record each ({id, kind, description, tags, params, structure_summary}) at <volume>/ai/rag/parts.jsonl; POST /api/rag/rebuild + GET /api/rag/stats; ↻ rebuild button next to the sidebar filter + quiet "RAG corpus · N parts · Xm ago" footnote. Prod corpus = 29 records on first rebuild. PHASE 2 (5355374; modules salvaged from crashed subagent D\'s worktree): src/lib/server/rag-query.ts — corpus loader + pure BM25 (k1=1.5 b=0.75, doc text = description+tags+structure, zero-score cutoff) + topK(query, 5); src/lib/server/rag-prompt.ts — system prompt teaches the graph schema BY EXAMPLE (trimmed g_spiral literal: polygon + poly_repeat + call + params) + hard JSON-only rules, user prompt = top-k exemplars one-line each + the description; NEW POST /api/rag/prompt — BM25 → one Claude call (RAG_MODEL env, default claude-sonnet-4-6) → parseJsonLoose → validated {id, candidates, graph}. Proxied to prod in VOLUME_PROXY_PATHS (corpus + ANTHROPIC_API_KEY live prod-side; X-Volume-Local forces local). UI: violet ✨ prompt input under the sidebar filter row — Enter generates; the proposed graph opens in a NEW tab via the seedGraph prop (GraphEditorPane hydrates + auto-layouts it INSTEAD of fetching by id; exemplarId pre-set so first Save lands under the suggested name; volume untouched until then; seeded tabs excluded from tab persistence). Footnote doubles as status (generating… / from: <exemplar ids> / error). Verified live: "hexagonal prism with a central round bore" → g_hex_prism_bore with hex + bore poly_repeat loops, param-wired across-flats + length + subtract node. PHASE 3 (embeddings) deferred until the catalog passes ~200 parts. Plan doc: docs/plans/rag-prompt-builder.md.' },
    { id: 672, bundle: 'K', lane: 10, start: 56.0, weeks: 0.8, priority: 'high',   status: 'done',   title: 'K.72 — Polygon + PolyRepeat loop architecture overhaul + sidebar UX cluster + g_* migration Round 1 (2026-06-10/11, ~30 commits e0ff295..e14f00f, 3 of 4 parallel subagents shipped clean). LOOP ARCHITECTURE (#155–#157): PolyRepeatNode as a SEPARATE node type with its own canvas card (Params · Bindings · Loop sections); polygons embed loops via {kind:\'repeat-ref\', sourceId} entries interleaving with literal vertices in any order — each ref splices N points at its row position; hydrate auto-migrates legacy inline repeats. NPts auto-injected as a const in every loop arrow body (theta = i*tau/NPts Just Works); bindings emit after NPts + cascade left-to-right per-iteration. Wire sockets: poly_repeat output (violet) → polygon per-row repeat-ref input; NPts input (amber) accepts p.<name> drops. 3-state vertex colours (red literal · violet parametric · purple loop-generated). SVG popover: ⋮⋮ drag grip + ↩ snap-back + frozen viewBox + click-to-insert with edge-hover (green/🚫) + click-to-delete. Expression popover: r/z (x/y) tab strip + ƒ on loop slots + mode-aware axis labels; mv/rot ƒ buttons route to the same shared popover. CRITICAL per-point UI rule: always entryIdxForEvalIdx(node, i) — direct points[i] silently breaks on repeat expansions (memory entry_idx_eval_idx_gotcha). Also: NaN guard in resolveProfile (mid-edit typos → degenerate geometry instead of WASM crash); usesOf + extractParamsBlock regex fixes accept JSON-quoted keys (unblocks ALL programmatic build scripts — memory json_stringify_meta_regex_traps). G_* ROUND 1 (graph-authored .asm.ts exemplars, per-part docs at docs/parts/g_<id>.md): g_spiral (flat coil, 2 interleaved loops), g_star (extruded star prism, conditional i%2 binding), g_collar (revolved hollow chamfered tube); g_dt_joint DEFERRED → K.75. SIDEBAR UX (subagent C): A↓ global alpha-sort toggle (localStorage); ✎ inline rename via POST /api/primitives/rename; broken-refs scan + repair via NEW POST /api/rag/scan-refs (toast after rename lists N dependents + [Repair all] rewrites their src:\'<old>\' refs); drag-from-sidebar onto canvas creates a Call seeded with meta.params defaults at the drop point (clientToCanvas inverts pan+zoom); call-card title hyperlink opens that primitive in a new tab (onOpenTab). Detail: memories polygon_repeat_loop_architecture + session_handoff_2026-06-11.' },
    { id: 671, bundle: 'K', lane: 10, start: 58.7, weeks: 0.4, priority: 'medium', status: 'todo',   title: 'K.71 — Graph-editor follow-ups (TODO queue surfaced 2026-06-09 evening). Open items: (a) LIFTED profile params — the profile-picker chip on a Call arg only switches the profile KIND; the kind\'s own params (r, len, h, …) still need hand-edited JSON. Render each profile param as an extra arg row under the chip so the dials surface. (b) Volume profiles in picker — load .prvl.ts / .prex.ts from /api/primitives/profiles/list so saved custom profiles appear alongside the curated kinds. (c) DONE 2026-06-10/11 — visual (r, z) point editing shipped as the Polygon card + SVG popover + PolyRepeat loops (K.72). (d) Source-tab text edit — make the SRC pane editable for hand-tweaks (currently read-only). (e) Ghost translucency — actual alpha on the ghost overlay (today it renders opaque in the per-source color, not see-through). (f) Auto-bake debounce when a slider is being dragged. (g) Bake cache LRU — the cache volume is at ~91 MB; trigger Phase-3 eviction before the 500 MB ceiling. (h) Lightweight floating nav button now that the top Navbar is gone — restore cross-page nav without the redundant chrome.' },
    { id: 670, bundle: 'K', lane: 10, start: 54.0, weeks: 1.5, priority: 'high',   status: 'done',   title: 'K.70 — /primitives multi-tab wrapper + GraphEditorPane extraction + UI polish session (2026-06-09, ~30 commits, c8b5a82..21338a4 + 37ce44a..e6252a2). MAJOR session: rebuilt /primitives as a multi-tab editor around the extracted GraphEditorPane.svelte (no iframes — tabs mount the component directly, isolated WASM state per tab). Sidebar of primitives groups (basic / completions / stdlib / stdstale / archived) + filter + per-tab close + persisted open-tabs state (localStorage prim-open-tabs / prim-active-tab-id). Trim chain: removed redundant "Graph editor" title above the canvas; removed the top Flowbite Navbar (CAD Train | Primitives | Vocab | Wells | FEM | Forge | Volume | Plan); content row now fills the full viewport. Layout overflow fix: `.layout` + `.prim-root` switched from `grid-template-rows: 1fr` to `minmax(0, 1fr)` (the `1fr` default of `minmax(auto, 1fr)` let canvas content force expansion to 1343px on a 598px viewport — clamped back to viewport with this + `min-height: 0` cascade). Camera/scene fix: PrimitiveDualScene auto-centers the OrbitControls target on the geometry bbox each refresh (scene.partCenter); cam.y bumped to 50; Z-pan slider range expanded -50..200. Mule_shoe build chain (the originating goal): composed via r_tube + r_cuboid + rot + mv + subtract — saved to basic/, 5 nodes, z 1.00. Profile picker authoring MVP (#119): chip on Call args that switches the profile kind via the descriptor. SRC + MD tabs in the editor right pane (#118); MD tab gains an AI icon that generates a description of the part. Vertical toolbar on the canvas left edge (+, save, bake, auto, ghost-clear, undo, ⚙ settings, reset). Push-apart with wire repulsion + boundary half-planes (#116, merged from worktree subagent). Per-card 👁 ghost mode (auto-translucent during composition); resize handles on cards (width persisted to graph.layout, snaps to label-fit floor); status badges in canvas bottom-left (save state + node count + zoom); sort dropdown for the primitive list (A-Z / Recent / Source via localStorage ge-picker-sort); profile arg detection in dep paramKeys regex (842fa8c fixed the quoted-JSON-keys bug behind the WASM "memory access out of bounds"). UX polish: ⚙ canvas-settings menu rebuilt as a Flowbite-style dropdown anchored to the button\'s getBoundingClientRect (was a wide button-list panel at hardcoded top:220px that drifted as ghost-clear/undo buttons appeared above it); two action rows (Auto-layout, Push apart) + separator + two boolean checkbox rows (Left/Right boundary repellant). + picker also anchored to its rail button\'s bounding rect + outer wrapper height:480px overflow:hidden so only the inner Call list scrolls (the CSG/Transform/Container sections stay pinned at top). Edge-bound indicators: the small circular ⏹/🔺/🔒 buttons pinned to the canvas edges were removed (redundant with the ⚙ menu checkboxes); BoundState simplified from \'off\'|\'repellant\'|\'confiner\' to \'off\'|\'repellant\' (legacy confiner persisted values read as off). /primitives sidebar gains overflow-y:auto + min-height:0 cascade so the rail scrolls when 100+ entries load. Pairs with K.69 (the /vocab editor uses the same Flowbite-style chrome); will be consolidated under K.67 (graph promotion) once the .asm.ts body becomes a derived projection.' },
    { id: 680, bundle: 'K', lane: 10, start: 61.0, weeks: 0.6, priority: 'high', status: 'done', title: 'K.71 — Stack + part-properties cluster (2026-06-14). Stack z-offset is now a GRADED DELTA to the flush position (0 = end-to-end, + = gap, − = overlap by |v|; cursor = tail+ref) — fixed the "non-zero offset hides all but one item" bug (a61b4d7); inline ×N count + z-offset fields on the Stack card (no popover needed) + dropped the KIND column (ccc5fda). NEW collapsible ⚙ Properties card above PARAMS holding z-offset + OUTSIDE colour + INSIDE (bore) colour + material; stack_ref moved out of the param-chip list. Per-part colorOuter/colorInner round-trip through meta + hydrate and are APPLIED to the bake — they substitute the red-outer/grey-bore vertex-colour LUT on BOTH the live-mesh pane (builder.ts finalizeManifold override) AND the GLB pane (manifold-bake.ts COLOR_0). Defaults (#cc2222/#888888) keep unset parts byte-identical.' },
    { id: 681, bundle: 'K', lane: 10, start: 61.4, weeks: 0.5, priority: 'medium', status: 'done', title: 'K.72 — Viewer visualization cluster (2026-06-14). View-only X-dia exaggeration + Z-depth compression scales (⚙ scale menu) so long thin tools stay legible. Z-axis lighting: a point-light STRIP spread along the part Z extent (scene.zStripLight, the Phong-compatible default) PLUS a true THREE.RectAreaLight mode (scene.zRectLight — swaps the lit mesh to MeshStandardMaterial only while on); both off by default, byte-identical when off. Z-pan slider now spans the FULL part length (range = partZExtent) and its step scales with zoom, so a long part stays fully scrollable top→bottom at any zoom.' },
    { id: 682, bundle: 'K', lane: 10, start: 61.8, weeks: 0.5, priority: 'medium', status: 'done', title: 'K.73 — SVG geometry tab (2026-06-14, docs/plans/svg-geometry-tab.md, Route 1 = three SVGRenderer). New right-pane SVG tab vector-renders the bake: persp ⇄ ORTHO toggle (ortho default — a straight perpendicular elevation looking at origin, the technical-drawing projection), black EdgesGeometry border (gated on showEdges), scrollable natural-aspect render (long part renders tall + scrolls vs squished), coarse|HIGH resolution toggle (coarse 32-seg default), ⤓ .svg download, high-poly warning, active-tab-only render. GPU-SVGRenderer was explored + rejected (category error: SVG is DOM, the DOM build not the math is the bottleneck — bake fewer segments instead). Shiny/specular in SVG not feasible (SVGRenderer is flat-diffuse only). HLR via archived three-svg-renderer = the post-ship quality upgrade.' },
    { id: 683, bundle: 'K', lane: 10, start: 62.2, weeks: 0.8, priority: 'high', status: 'done', title: 'K.74 — Bake performance for long stacks (2026-06-14, docs/plans/stack-cutaway-perf.md). ROOT CAUSE of the ~27-34s "construction": NOT the geom (collar→tube→pin build+compose is ~133ms) — it was (a) the GLB bake always building the full cutaway subtract (~20s, no 15k skip) blocking Node single thread so the mesh queued behind it, and (b) mesh extraction+serialize being O(total triangles). FIXES SHIPPED: GLB moved to its own LAZY tab — the 3D-bake tab is mesh-only (~1-2s) and never waits on the GLB; mesh-first rebuild sequencing; coarse-segment bake now reaches ASSEMBLY deps via a segment cap clamped at the primitive-loader call boundary (engine prims take segments as an explicit param, not a global) → g_dp_stand 47712→5760 tris (8.2×); SVG tab bakes coarse (32) + a ⚡ draft toggle bakes the live mesh at 64 seg. Net: g_dp_stand ~27s → ~1s. STILL PLANNED: per-part cutaway (decompose→cut each body→merge, distributive over compose, turns the super-linear cutaway linear; preserves color-by-source; one finalizeManifold change covers all 3 bake paths) + raising/dropping the 15k skip.' },
    { id: 684, bundle: 'K', lane: 10, start: 62.8, weeks: 1.0, priority: 'high', status: 'active', title: 'K.75 — GPU instancing for identical repeats (2026-06-14, realises the long-deferred K.43). For a Stack/Repeat of N IDENTICAL children (e.g. 50× one joint) the live mesh today merges into one N× mesh → extraction + serialize + transfer + GPU are O(N) (~47s at N=50). Opt-in instanced:true on /preview → finalizeManifold decompose()s the result, groups bodies identical-up-to-Z-translation, returns ONE child mesh (full+cutVC) + N transform matrices → PrimitiveDualScene renders a THREE.InstancedMesh → O(1)+N. Preserves red/grey + outer/inner vertex colours, the cutVC variant, and the graded-delta z-offsets (per-instance matrix). Single/mixed parts fall back to the merged path byte-identical; SVG/GLB keep merged. Target: 50 joints ~0.5s at FULL 256-seg fidelity (no draft needed). In flight via a worktree subagent; bake side build-verified, InstancedMesh render needs visual validation on merge.' },
    { id: 685, bundle: 'K', lane: 10, start: 65.0, weeks: 0.8, priority: 'high', status: 'done', title: 'K.76 — Sidebar + row UX overhaul (2026-06-16). /primitives rebuilt as a Windows-Explorer expand/collapse FILE TREE (folders open in place, state persisted) with a left vertical TAB rail that SCOPES the tree to one top-level folder. Compact rows: the four hover buttons (rename/move/copy/trash) clubbed into ONE ⋯ kebab + right-click context menu (Rename · Move to… · Copy to… · Archive/Delete); dropped the redundant `vol` tag (only arch/src/stale badge). MOVE a part to another folder (drag-to-folder/tab + a Move-to dialog; backend findPrim fallback for archive↔basic) and COPY (duplicate under a new id — rewrites meta.id/name + the export fn). Drag-selection / sticky-drag fix (onNodePointerDown preventDefault + canvas user-select:none).' },
    { id: 686, bundle: 'K', lane: 10, start: 65.8, weeks: 0.6, priority: 'high', status: 'done', title: 'K.77 — BREP tab parity + cutaway (2026-06-16). The BREP (server-side OCCT) tab now reuses the SAME PrimitiveDualCanvas chrome as the 3D-bake tab (backend="brep": canvas/camera/lights/orbit, ⚙ scale, SceneControls, Z-pan, stats, 🔄, cached/fresh badge); bespoke PrimitiveBrepView archived; new brep-adapter.ts (OCCT response→THREE.BufferGeometry). BREP cutaway switched from a HALF cut to a QUARTER (+x,+y quadrant) to match the Manifold getCutBox; getCutBox itself is now bbox-derived (spans the part\'s full Z + margin) instead of a fixed [20,20,100]@z[-50,50] that under-cut tall stacks.' },
    { id: 687, bundle: 'K', lane: 10, start: 66.4, weeks: 0.7, priority: 'high', status: 'done', title: 'K.78 — Smooth warp via build-time weld segmentation + Rule 25 (2026-06-16). Warp on coarse revolves was faceted (manifold.warp only moves existing verts). FIRST attempt — post-bake MeshGL subdivide — OOB-crashed the WASM core (corrupts the singleton → every part 500s); REVERTED. Durable fix: subdivide the 2D (r,z) PROFILE along Z BEFORE the revolve, inside the welded revolveProfile/weldAndBuild pipeline — crash-safe (can\'t make a non-manifold mesh), geometrically identical solid, just denser. GATED on warp-enabled via /preview (freq-driven density, ~16 samples/cycle) so non-warp revolve bakes stay light (always-on made g_dp_stand 26s/751k verts). Codified as CLAUDE.md Rule 25: the welded-mesh system is the PRIMARY geometry builder; segmentation/warp resolution belongs at BUILD time, never a post-bake mesh rewrite.' },
    { id: 688, bundle: 'K', lane: 10, start: 67.1, weeks: 0.8, priority: 'high', status: 'done', title: 'K.79 — mv/rot transform strips + PARAMS/PROPS tabs (2026-06-16). Inline mv/rot transforms render as compact STRIPS off the Call card\'s right edge: labels-above-inputs (narrow), no spinners, flush, sockets outward. AUTO-ATTACH — any standalone Mv/Rot node whose .child chain bottoms out at a Call now renders as a cascading strip on that Call (chain-walk: transformChainBase / attachedTransforms / transformBaseCall in graph-editor-geom.ts) and is hidden as a free-floating card. Small SEQUENCE ARROWS trace the op order (card→rot→↓mv→…→output). Separately: the PROPERTIES + PARAMS left cards merged into ONE tabbed card (Params | Properties) — CARD_Y0 re-anchored under the tab header so sockets/wires follow; param content + wires gated to the Params tab; auto-layout obstacle collapsed to one rect (PROPERTIES/PARAMS now repel node cards).' },
    { id: 689, bundle: 'K', lane: 10, start: 67.9, weeks: 0.2, priority: 'medium', status: 'done', title: 'K.80 — r_weld_extrude promoted stdstale→stdlib (2026-06-16). It is an ACTIVE meta.uses dependency of g_cube / g_spiral / g_star / g_star_claude / g_barrel (+ engines r_extrude / r_loft) — confirmed by searching the PROD volume (an earlier agent\'s "unused" verdict came from the stale local .dev-volume mirror; lesson: usage searches must hit the proxied prod volume, never the local mirror). An actively-used engine belongs in stdlib/ (active), not stdstale/ (deprecated). Registry globs both dirs so resolution is unchanged; verified origin=stdlib + g_cube still bakes.' },
    { id: 690, bundle: 'K', lane: 10, start: 68.2, weeks: 1.0, priority: 'high', status: 'open', title: 'K.81 — Client-side execution (compiler/executor split) — plan docs/plans/client-side-execution.md (2026-06-16, decided after the dependency-blind bake-cache "deja-vu" bug + the multi-user direction). Server becomes a COMPILER (graph + resolved deps → one self-contained script, cached as TEXT — kills the stale-mesh bug class by construction since the script contains the inlined deps). Client becomes an EXECUTOR (Manifold + OCCT WASM in a Web Worker → mesh, transferable back to Threlte). Wins: server stops being CPU-bound on bakes (multi-user scale), no large meshes over the wire, no stale-dep cache. Cost: a Web Worker is mandatory; OCCT WASM is heavy → Manifold-worker-first behind a flag with server-bake fallback, OCCT second. Both kernels follow the same split; OCCT sweep-along-spline is the durable path for deviated/curved profiles.' },
    { id: 691, bundle: 'K', lane: 10, start: 69.2, weeks: 0.3, priority: 'medium', status: 'todo', title: 'K.82 — Edges-not-warping fix (2026-06-16, diagnosed, not yet fixed). On INSTANCED stacks ONLY, warp is baked into the canonical body\'s LOCAL z but instance copies are only translated, so copies 2+ carry the wrong warp phase and their edges stay straight (non-instanced parts warp fine). Fix options: (a) disable instancing when warp is on (simple, slower stacks) or (b) pass each copy\'s GLOBAL z-offset into the warp callback (keeps instancing fast — preferred). builder.ts tryInstanceFinalize.' },
    { id: 669, bundle: 'K', lane: 10, start: 53.0, weeks: 1.0, priority: 'high',   status: 'done',   title: 'K.69 — Vocabulary editor /vocab + boolean_modify rule + 41 completion seeds + mule_shoe exemplar (2026-06-06, pushed d3b696e..9ef94e9). First wave of K.68 phase 1 lands as a working editor + a new rule kind. 41 completion-parts seeds ingested from SVTC `comp_list.xlsx` into `docs/parts/vocabulary.seeds.json` (57 catalogue rows → 41 unique terms; multi-size variants kept in `variants[]`; 39 carry `compjson_ref` to the matching 2D silhouette at `static/svtc-compjson/*.json`, 72 files ~2.9MB). New script: `scripts/sync-svtc-compjson.ts` + `scripts/ingest-comp-list.ts`. /vocab page rebuilt as the vocabulary editor: Topology / Browse left tabs; right pane has Inferred / Proposed vertical trapezoidal rail (matches /primitives chrome), 30/70 outer split + 40/60 inner split (canvas / params+rule details). Definition + chip groups encapsulated in a ⓘ Definition & tags popover so the tab body focuses on params + 3D bake. Inline Bake + Promote in the title row. Parameters use ParamGrid in a .pg-acc-wrap accordion (identical to /primitives Build tab). Layout contracts captured in src/routes/vocab/CLAUDE.md (the zoom-loop bug fix from display:flex column + flex:1 1 auto + min-height:480px on .bake-body — needed to prevent the canvas auto-fit feedback loop). 2D→3D inference pipeline: `src/lib/authoring/compjson-to-profile.ts` reads SVTC compjson half-section drawings (LEFT = section cut / bore, RIGHT = OD silhouette), classifies elements by x-midpoint, transforms the dominant section polyline to [r,z] pairs via OD-calibrated scale. Pure deterministic, no ML weights. Tested live on 4 seeds: mule_shoe 5-vert chamfered tip, tubing_pup / flow_coupling plain cylinders, nipple_r_landing auto-captures 4 landing grooves on the OD as alternating r-bands. New `boolean_modify` rule kind: `src/lib/authoring/proposal-translator.ts` translates `proposed-vocab-entries.json` entries into source. Rule body = a polygon_inline primitive + a `modifiers[]` chain of {op, shape}. First shape: tilted_slab (rectangular slab whose top face is the cut plane, rotated around an axis by an angle, anchored at a Z — carves one half-space). First use: mule_shoe\'s 45° angled bottom cut on a hollow tube + box top. Future shape slots: cylindrical_hole_ring (perforated pups), thin_slot_ring (slotted liners), lateral_pocket (side-pocket mandrels), j_slot_grooves (indexing). Each new shape = a multiplier across many parts. mule_shoe end-to-end as the exemplar — bakes to 3456 verts · z=9 · r=2 with the slanted cut visible. Endpoints: POST /api/vocab/infer?term=<slug>, POST /api/vocab/bake-proposed?term=<slug> (body {params?:[]} for slider-driven re-bake), POST /api/vocab/promote-proposed?term=<slug> (writes the full entry into vocabulary.json + bumps version + saves dt_<slug>.prim.ts to volume + flips seed status to promoted). Three new CLAUDE.mds: src/routes/vocab/, src/lib/authoring/, src/routes/api/vocab/.' },
    { id: 668, bundle: 'K', lane: 10, start: 59.1, weeks: 0.8, priority: 'high',   status: 'open',   title: 'K.68 — Generative authoring (vocabulary → translator → multi-tier cached generation with WebGPU local LLM, supervised) (added 2026-06-05). User-driven pivot away from hand-authored parts and ad-hoc rewrites — every dp_* this session was either hand-written or imported from a legacy backup, none were GENERATED from a description, and that doesn\'t scale. THE VOCABULARY: a compositional grammar of part terms — shaft = cylindrical profile; tube = larger shaft .subtract( smaller shaft ); collar = revolve profile with locally-larger OD; pin = shaft + tapered nose; box = tube + counterbore (female complement of pin); joint = ordered composition of pin+body+box via tail() datum; stand = N joints stacked. Each entry has a definition, synonyms (RAG aliases), a structured rule (in the K.62 IR shape — imports + composition tree + param mapping), an exemplar part id, and expected bake metrics. THE TRANSLATOR (`src/lib/authoring/rule-translator.ts`): pure deterministic function `Rule → AsmSource` that compiles a vocabulary rule (or any rule conforming to the schema) into a runnable `.asm.ts` / `.rev.ts` via the existing `composition-tree.ts` data layer (applyToSource + addAssemblyParam + the K.62 emit pipeline). NO LLM IN THE TRANSLATOR — it\'s pure compile. THE FIVE-TIER CACHE (descending cost): L1 vocabulary term/synonym lookup (0 tokens, 0ms, client-side JSON match) → L2 cached generations vector lookup against IndexedDB authoring_cache + the existing $APP_DATA_DIR/ai/training_data pattern (0 tokens, ~50ms embed match) → L3 translator-from-rule (0 tokens, ~5ms deterministic compile when a vocab rule matched) → L4 WebGPU LLM emits a RULE conforming to the vocabulary schema (NOT raw source) and the translator compiles it (0 tokens, ~1-5s in-browser, structured-output mode for constrained generation) → L5 Claude API `/api/author` server fallback when WebGPU low-confidence or unavailable (token-cost, ~1s, highest quality). The translator is the SAME for all five tiers — rule comes from different sources but compiles the same way. CRITICAL INSIGHT: constrained generation (LLM emits structured RULE matching the schema, not raw `.asm.ts`) is dramatically smaller output + validatable + the deterministic translator handles correctness — far better than asking the LLM to emit runnable source. SUPERVISION PANEL (Phase 5 — equally critical, not afterthought): meaningful + fast human-in-the-loop oversight on every generation. Side-by-side: description input + generated rule JSON + live 3D bake preview + cited exemplars + trust signal badge ("L1 vocab hit · pin" / "L4 WebGPU · 87% confidence · 2 exemplars"). Keyboard-bound Accept (Y — caches to L2) / Reject (N — logs failure mode + opens refine) / Refine (R — edit rule fields in place, re-translate, see diff). Diff view between generations: which rule fields changed + bake-metric delta (verts, z-extent, etc.). Always reversible. The supervision panel makes generative authoring trustable + scalable — without it, the whole stack is a black-box source dumper users can\'t validate at speed. SVTC chatbot integration via the same panel: chat suggests, supervisor approves. SIX-PHASE ROLLOUT: Phase 1 (3 days) — vocabulary.json + vocabulary.md + synonym map (docs/parts/), with the dp_test pipeline parts (shaft/tube/collar/pin/box/joint/stand) as the first rule set. Phase 2 (3 days) — rule-translator.ts + regenerate every dt_* part from its vocab entry as the validation contract (translator passes iff bake metrics match the manual baseline). Phase 3 (2 days) — client-author.ts orchestrator with L1+L2+L3 wired (IndexedDB / training-data cache for L2). Phase 4 (4 days) — WebGPU LLM integration: model selection (Mistral-7B-Instruct via web-llm, Llama-3-8B-Instruct, or a domain-tuned small model), structured-output constrained decoding for the rule schema, prompt engineering with vocab + retrieved exemplars as context. Skipped gracefully when WebGPU unavailable (falls to L5). Phase 5 (3 days) — supervision panel UI inside CompositionEditor; side-by-side preview; diff view; keyboard shortcuts; trust signals. Phase 6 (2 days) — /api/author server (Claude) as L5 fallback + the SVTC-style chatbot panel binding. WIN: a "drill pipe pin, 4 1/2" OD, NC50 thread" description hits L1 (vocab match on "pin") → translator generates source from the pin rule → user supervises (≤1s of input) → cached for next time. Repeat description = 0 tokens, 50ms total. Novel description = WebGPU 1-5s offline → cached. Token-expensive Claude calls only for hard cases. REPLACES the hand-rewrite anti-pattern observed during the dp_test session (every non-curated profile triggered an ad-hoc `/tmp/dt_*_swap.ts` script — the right architecture pushes that into the vocabulary + lets the system absorb new rules over time).' },
    { id: 667, bundle: 'K', lane: 10, start: 59.9, weeks: 0.7, priority: 'high',   status: 'open',   title: 'K.67 — Graph promotion: promote the composition tree + bindings to source-of-truth, demote the `.asm.ts` body to a derived projection (added 2026-06-03). Surfaced after the user observed that we are hand-rolling a reactive dataflow system on top of JavaScript source text, and the resulting bug class (silent unwired params, name-matching as a magic concept, tagManifold not propagating originalIDs, parse → mutate → re-emit text round-trips that lose information, the K.61/K.66 child-drift problems) is exactly what a graph-based parametric system makes impossible by construction. Every grown-up CAD parametric system (Grasshopper, Houdini, FreeCAD Expression Engine, Onshape FeatureScript references, Blender Geometry Nodes) converged on a dataflow graph as the source-of-truth + a text projection (or no text at all) for the same reason. K.67 is the architectural shift to that model. NEW MODEL: (1) meta.composition stays the TreeNode root from K.62/K.63 but is the ONLY source-of-truth for the assembly\'s shape — no text body fallback. (2) NEW `meta.bindings: [{ from: \'p.<param>\', to: \'<callId>.<paramKey>\' }, ...]` is the first-class edge list: each wire from an assembly-level meta.params row to a child Call\'s arg slot is an entry. Replaces the current text-substitution wiring (literal "p.length" inside a Call arg) with a typed reference object. Removing a param walks edges + warns the user about orphaned slots before deleting. Renaming a param updates every edge\'s `from`. (3) The function body is auto-emitted from the tree+bindings on every save (same as today, but the emit becomes deterministic + the reverse direction is no longer needed because edits go through the editor, not the source text). (4) NEW `src/lib/cad/composition-bake.ts` interpreter consumes the tree + bindings directly to produce a Manifold — skips the JS sandbox + new Function eval entirely for assemblies. Each Call node maps to `loadPrimitiveGeomById(call.src)` → object-args from bindings → wrapped boundary. CSG ops, mv/rot, transforms walk the tree literally. The bake stops being text-eval + becomes a tree walk, removing a whole class of "what string did this parse as" bugs. (5) The /api/primitives/save endpoint keeps writing `.asm.ts` for legibility / grep / git history, but the file format gains a `meta.graph` block carrying the tree + bindings as JSON literal — and on open the editor reads `meta.graph` IF present, falling back to the parsed body otherwise. New saves always include `meta.graph`; old `.asm.ts` files migrate on first save. (6) In the editor (CompositionEditor.svelte), wiring a param to a slot becomes a drag from the param row to the slot (or click "wire" on a slot → pick assembly param), producing an edge object — no more text-substitution-via-ƒ-popup. The ƒ popup stays for ARBITRARY expressions (Math.PI, p.od/2 - p.wall) but a simple `p.X` ref is the typed edge case. (7) Reactivity: Svelte 5 runes wrap the graph as $state — when a dial changes, only downstream Calls re-bake (we already cache builds per-dep in primitive-loader.ts, this just makes the dependency set explicit instead of derived from text). IMMEDIATE BENEFITS that fall out: (a) unwired meta.params row is impossible — adding a row that nothing references shows up as "no outgoing edges, dialing won\'t do anything; add an edge?" the moment you create it; (b) refactor / rename is a graph walk; (c) the K.66 drift detection becomes a node-property hash diff vs an embedded JS-string sniff; (d) the K.62 composition model already IS a tree — we just need to stop pretending the text body is the model; (e) the JS sandbox eval becomes optional (only for arbitrary-expression slots), making typed CAD operations type-checkable; (f) bake parallelization (K.52) becomes obvious because the graph IS a DAG. MIGRATION PATH: ship in 4 phases over 1-2 weeks: Phase 1 (3 days) — `meta.graph` JSON literal + reader/writer; CompositionEditor reads graph first, body as fallback; new saves include graph. Phase 2 (3 days) — `composition-bake.ts` interpreter; `/api/primitives/preview` routes asm parts through the interpreter when meta.graph present; A/B against existing text-eval path. Phase 3 (3 days) — typed `meta.bindings` edge list; drag-to-wire UI; ƒ popup still covers arbitrary expressions; "unwired param" warning becomes a structural impossibility. Phase 4 (3 days) — drop text-fallback path; `.asm.ts` body becomes purely a projection (read-only on disk, regenerated on every save); deprecate the parse-body-as-source flow. Each phase is independently shippable; phases 1-2 produce no UX change while flipping the engine. Replaces a long tail of patches: the K.61 child-drift cache invalidation; the K.66 child-changed alert; the silent-unwired-param bug from this session; the tagManifold mesh-options trick; the partHashId text-emit dance.' },
    { id: 665, bundle: 'K', lane: 10, start: 60.6, weeks: 0.5, priority: 'medium', status: 'active',   title: 'K.65 — Modularize the big files (added 2026-06-02; REFRESHED + RESEQUENCED 2026-06-16 → docs/plans/modularize.md, a 15-PR plan covering extraction + a stale-code sweep + fragility-hotspot hardening. P1 SHIPPED 2026-06-16: graph-editor-geom.ts extracted from GraphEditorPane (9635→9168 lines) — the socket/wire/card position math is now pure + co-located + tested 16/16, which also de-risked the mv/rot strip work. The original offenders below are STALE — PrimitiveView/CompositionEditor/ProfileFnEditor were archived in the K.63 strip; current top files: GraphEditorPane.svelte ~9168, vocab/+page 1687, composition-graph.ts 1653, primitives/+page ~1800. REMAINING P2+ per the plan: graph-model split, RightPane/SketchEditorPane extraction, NodeCard last). ORIGINAL NOTE: Top offenders (lines): PrimitiveView.svelte 3387, CompositionEditor.svelte 1872, routes/primitives/+page.svelte 1410, ProfileFnEditor.svelte 1149, plan/details.ts 929, composition-tree.ts 774, builder.ts 741. Three of those (PrimitiveView, CompositionEditor, ProfileFnEditor) shrink mostly through the K.63 strip (worktree-agent PR in flight as of 2026-06-02 evening, drops the OLD composite UI from PrimitiveView once .prim.ts editing is gone). Post-strip targets: (1) PrimitiveView splits into PartView (param accordion + 3D viewer + source tab) + StdlibViewer (read-only banner + the kind-dispatched mounts). (2) CompositionEditor extracts the per-row Call accordion (props grid + mv/rot editors + Transform/Method toolbar + color swatches) into CompositionCallRow.svelte, and the imports section into CompositionImportsList.svelte. (3) ProfileFnEditor extracts composeSource + parseBody + bodyTooComplexToDecompose into src/lib/shared/profile-fn-compose.ts (pure functions, easier to unit-test the round-trip after the 2026-06-02 fix chain 60a1f30 / 4901e49 / 7f98a13). composition-tree.ts can stay near 800 lines but split into composition-parse.ts / composition-emit.ts / composition-mutate.ts so docs/COMPOSITION.md three-section API maps 1:1 to file boundaries. builder.ts loses its dead-after-strip primitive-composite render branch. routes/primitives/+page.svelte gets cleaner once typedCreate stops mirroring old + new kinds. plan/details.ts is mostly long copy strings; reorganise per-bundle only if it produces merge conflicts. Goal is structural — no file in src/ over 1000 lines without a real reason. Ship in 4 PRs: (a) extract CompositionCallRow + CompositionImportsList (1 day, low risk); (b) extract profile-fn-compose helpers + unit tests (1 day, medium risk because round-trip subtleties); (c) split composition-tree.ts (half day, mechanical); (d) post-strip PrimitiveView split (1 day, needs K.63 strip merged first).' },
    { id: 659, bundle: 'K', lane: 10, start: 47.5, weeks: 0.4, priority: 'medium', status: 'done',   title: 'K.59 — Implement `taper` in r_weld_extrude (DONE 2026-06-02, commits 947a72d + 6c8eb80). Wired the long-dropped 5th arg through CrossSection.extrude\'s scaleTop tuple (the Vec2 `[s, s]` form works fine WITHOUT a follow-up .warp — the bug we deferred for was the scalar-1 + warp combo, memory: manifold_extrude_scaletop_warp_bug). Branch matrix on (twist, taper): tw=0/tp=0 → bare extrude(h); tw=0/tp≠0 → extrude(h, 1, 0, [s, s]) where nDivisions=1 + non-1 scaleTop sidesteps the coincident-slice degeneracy; tw≠0 → twist morphing with or without taper. Followup (6c8eb80) moved the formula INTO the part body — buildExtrudeSource now emits `const scaleTop = [1 - taper, 1 - taper];` so users can see + edit the math directly; r_weld_extrude gained an optional 7th positional scaleTopOverride that wins over the legacy taper-only path. Sign flipped to drilling convention (positive taper narrows the bottom, classic shaft / drill-bit shape). taper schema gained `unit: \'\'` so the dimensionless scale factor stops being tagged as mm. The loader-side sig-rewrite was also fixed to preserve trailing optional args past meta.params (otherwise scaleTopOverride got stripped, fix landed in same commit chain). Verified via /tmp/probe_taper2.ts on a rect profile: taper=+0.5 narrows bottom (0.375 vs top 0.75), taper=-0.5 flares bottom (1.125), taper=0 straight prism. Existing parts (taper=0 by default) unaffected; existing parts with non-zero taper get the new behaviour through the legacy fallback path. The user observation that prompted the fix: "the taper does not work in the assembly". Hand-wound rail-weld variant (the K.50(b)\' alternative described in the original plan note) is still future work IF non-linear per-v taper is needed (the per-v multiplicative form mentioned there).' },
    { id: 700, bundle: 'L', lane: 11, start: 57.4, weeks: 0.5, priority: 'high',   status: 'open',   title: 'L.1 — OAuth identity port from SVTC: Google OAuth + signed-session → event.locals.userId via sequence() in hooks (existing AUTH_TOKEN/proxy/rate-limit unchanged). Plan ready: docs/plans/oauth-identity.md. Blocked on user-provisioned Google OAuth creds.' },
    { id: 701, bundle: 'L', lane: 11, start: 57.9, weeks: 0.2, priority: 'medium', status: 'open',   title: 'L.2 — Public parts category: add `public` to LIBRARY_CATEGORIES (resolvers iterate the tuple) + visibility:public on save. Ships without identity.' },
    { id: 702, bundle: 'L', lane: 11, start: 58.1, weeks: 0.5, priority: 'high',   status: 'open',   title: 'L.3 — Private per-user parts under components/<userId>/ (REQUIRES L.1): user-scoped resolvers + owner enforcement; close R2 (/api/volume path guard), R3 (private out of proxy), R4 (list-cache by userId), R5 (id-collision scoped).' },
    // ───── M. Professional 2D sketcher (docs/plans/profile-sketcher.md) ─────
    { id: 800, bundle: 'M', lane: 12, start: 57.4, weeks: 0.3, priority: 'high',   status: 'done', title: 'M.0 — Spike + package validation. Add makerjs (Microsoft, MIT, pure-JS). Prove a parametric path (line + arc + fillet + Bézier spline) → model.toSVG() render → SAMPLE to (r,z) at the segments dial → bakes through r_revolve unchanged. Bench tessellation cost. DECISION GATE: Maker.js fits (chain.fillet / dogbone-chamfer / expandPaths-offset / BezierCurve / DXF + SVG export, no WASM) vs fall back to Paper.js + hand-rolled CAD ops. Alternatives ruled out for now: JSketcher (full app + constraint solver — too heavy to embed; revisit only if true geometric constraints are needed), @flatten-js (geometry lib, no editor), OpenCascade.js (massive WASM, overkill for 2D).' },
    { id: 801, bundle: 'M', lane: 12, start: 57.7, weeks: 0.6, priority: 'high',   status: 'done', title: 'M.1 — Sketch node model. NEW `sketch` graph node (sits where `polygon` does) whose body is an ordered `ops` list, each op a param/expr-able graph entry: moveTo/lineTo (r,z) · arcTo (r,z,radius,sweep) · spline (through[]/control[]) · fillet (atVertex,radius) · chamfer (atVertex,dist×angle) · offset (dist) · mirror (axis). NEW compileSketch() runs the ops through Maker.js → a chain → samples to the (r,z) point list r_revolve/r_extrude ALREADY consume, so the bake pipeline is untouched. polygon stays as the degenerate all-lineTo case; existing polygon parts auto-migrate (each point → a lineTo op) on first open. composition-emit + hydrate round-trip. No new UI yet — author ops in the graph + verify bake parity vs the old polygon. Because ops are graph entries, a fillet radius wires to p.filletR + re-bakes live.' },
    { id: 802, bundle: 'M', lane: 12, start: 58.3, weeks: 0.8, priority: 'high',   status: 'todo', title: 'M.2 — Full-tab sketch editor + dedicated toolbar. Opening/editing a sketch EXPANDS it to occupy the whole tab content (3D-bake pane collapses to a strip/toggle); ✎ Edit sketch enters, ✓ Done exits back to the graph. Dedicated left toolbar: select · line · arc · spline · fillet · chamfer · offset · mirror · dimension · snap-to-grid · zoom/fit · exit. Maker.js renders the OUTLINE (smooth arcs/splines, visible fillets/chamfers) + an interaction layer (drag points/handles, the black/white hover tooltip + point-order markers already shipped). The current popup/right-pane previews become the read-only "mini" view; the full-tab sketcher is the "max" edit view. DECISION: full-tab overlay inside /primitives (recommended — no route change, keeps tab state) vs a /sketch/[id] route.' },
    { id: 803, bundle: 'M', lane: 12, start: 59.1, weeks: 0.6, priority: 'medium', status: 'done', title: 'M.3 — Operator UX (SHIPPED). Direct-manipulation sketch operators in GraphEditorPane: select/line/spline/fillet/chamfer tools, click a vertex to round/bevel (cornerAtOpIdx), spline through picked points (splineDrag), each writes a sketch op + live re-bakes — turning the M.1 graph-authored operators into direct manipulation. (Offset-for-wall-thickness operator not confirmed as a discrete tool — track separately if still wanted.)' },
    { id: 804, bundle: 'M', lane: 12, start: 59.7, weeks: 0.8, priority: 'medium', status: 'todo', title: 'M.4 — Pro polish (own session each). Snapping + grid; dimensions / light geometric constraints (revisit JSketcher only if dimension-driven constraints become a real need); DXF export (Maker.js native — real CAD handoff); 2D-CSG via model.combine (folds in the old K.58 SVG-CSG idea); mirror/symmetry.' },
    { id: 805, bundle: 'M', lane: 12, start: 60.5, weeks: 0.5, priority: 'medium', status: 'open', title: 'M.5 — Sketch REPEAT op (plan docs/plans/sketch-repeat.md, 2026-06-16). A repeat in the sketch editor mirroring the polygon poly_repeat: a free-floating sketch_repeat prototype card + a flat repeat-ref row in the parent sketch, wireable count, tri-modal Δr/Δz advance (self-tiling threads / rack lands / tapers). compileSketch stays UNTOUCHED — the repeat unrolls into a flat op stream upstream via one expandSketchOps helper shared by emit + the live preview (locked by a unit test). First PR = pure model + expandSketchOps + test (hand-unrolled == repeat-expanded); PR-3 UI lands in the extracted SketchEditorPane (after K.65).' },
    // ───── N. External / embeddable API (docs/plans/external-api.md, 2026-06-14) ─────
    { id: 900, bundle: 'N', lane: 13, start: 63.0, weeks: 0.3, priority: 'medium', status: 'done', title: 'N.0 — Plan + survey (2026-06-14, docs/plans/external-api.md + docs/api/README.md). Found cadtrain is already partway there: hooks.server.ts has CORS (CORS_ORIGINS allowlist + preflight) + a coarse AUTH_TOKEN bearer gate on /api/* + a wired-but-empty rate-limit extension point; GET /api/manifest is a hand-authored machine-readable capability catalog (the seed of /api/v1/manifest); POST /api/primitives/describe generates Claude markdown descriptors; geometry endpoints already return mesh-JSON / base64 GLB / coarse-segment SVG. SVTC (sibling repo) has a MATURE external-plugin SDK to adopt wholesale: externalAuth.js hashed/scoped/cached token registry (issue-once reveal), /sdk/llms.txt + /sdk/llms-full.txt + /sdk/version, an MCP server, an external/<devId>/ scoped namespace. Differ: skip SVTC\'s Svelte-compile/import-rewrite/mount pipeline — we serve geometry ops, not hosted plugin UI.' },
    { id: 901, bundle: 'N', lane: 13, start: 63.3, weeks: 0.5, priority: 'medium', status: 'open', title: 'N.1 — V1.0 read-only API: /api/v1/* facade thin-wrapping the existing handlers (list parts / get part metadata+geometry / bake preview → mesh-JSON·GLB·SVG / query the RAG corpus). No geometry logic duplicated. Versioned resource model + structured errors. Lowest risk (reuses shipped endpoints).' },
    { id: 902, bundle: 'N', lane: 13, start: 63.8, weeks: 0.6, priority: 'high', status: 'open', title: 'N.2 — V1.1 auth: per-app bearer-key registry (ctk_v1_ token, stored as sha256(bearer) hash + metadata at <volume>/apps/_tokens/<id>.json — Rule 15, never plaintext; 60s cache; scopes read⊂bake⊂author⊂admin; CADTRAIN_ADMIN_KEY bootstrap), gated via a new apiKeyHandle composed with sequence(). Orthogonal to the per-USER OAuth (bundle L) — both reuse one owner-scoped subtree resolver.' },
    { id: 903, bundle: 'N', lane: 13, start: 64.4, weeks: 0.8, priority: 'medium', status: 'open', title: 'N.3 — V1.2 author/execute + per-app namespace: app-scoped writes under apps/<appId>/primitives/... resolved by the SAME primitive-paths.ts (parameterized root, kept out of VOLUME_PROXY_PATHS). Highest risk — the write surface + the R2–R4 holes from the customize-dir plan. IP protection: per-part meta.visibility:baked-only serves geometry+metadata but withholds source/graph (bridges to the WASM-conceal idea).' },
    { id: 904, bundle: 'N', lane: 13, start: 65.2, weeks: 0.6, priority: 'medium', status: 'open', title: 'N.4 — V1.3 LLM manifest + MCP: /api/v1/manifest (evolve /api/manifest) + /sdk/llms.txt + tool-call JSON schemas per operation + an MCP server (adopt SVTC\'s) so an agent can discover + drive cadtrain. Worked examples (author from description → bake → fetch GLB/SVG). V1.4 (later): embeddable canvas (iframe-postMessage or published web-component).' },
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
    return new Date(TODAY.getTime() + (absW - doneFrontier) * WEEK_MS);
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
        <!-- Date axis: a gridline every week, a DATE label every 2 weeks
             (each computed from the today-anchored frontier). -->
        {#each Array(totalWeeks + 1) as _, w}
          {@const absW = w + minStart}
          <line x1={w * WEEK_PX} y1={0} x2={w * WEEK_PX} y2={chartHeight}
                stroke={w % 2 === 0 ? '#cbd5e1' : '#eef2f6'} stroke-width={w % 2 === 0 ? 1 : 0.5} />
          {#if w < totalWeeks && w % 2 === 0}
            <text x={w * WEEK_PX + 5} y={16} fill="#64748b" style="font: 9.5px system-ui">
              {fmtDate(dateForWeek(absW))}
            </text>
          {/if}
        {/each}

        <line x1={0} y1={HEAD_H - 2} x2={chartWidth} y2={HEAD_H - 2} stroke="#cbd5e1" stroke-width="1" />

        <!-- Today marker — pinned to the work frontier (latest done END),
             which the axis anchors to TODAY. Self-maintaining: advances as
             items flip to done and as the calendar advances. -->
        <line x1={weekX(doneFrontier)} y1={HEAD_H} x2={weekX(doneFrontier)} y2={chartHeight}
              stroke="#ef4444" stroke-width="2" stroke-dasharray="4 3" />
        <text x={weekX(doneFrontier) + 4} y={HEAD_H + 12} fill="#dc2626" style="font: 10px system-ui; font-weight: 700">Today · {fmtDate(TODAY)}</text>
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
{fmtDate(dateForWeek(t.start))} → {fmtDate(dateForWeek(t.start + t.weeks))}
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
