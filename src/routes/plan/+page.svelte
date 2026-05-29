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

  const START = new Date('2026-05-09T00:00:00');
  const WEEK_MS = 7 * 24 * 3600 * 1000;

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
    { id: 'H', name: 'Constrained parametrization (SHELVED — re-planning)', tint: '#7c3aed', desc: 'SHELVED 2026-05-24 — to be replaced by a NEW plan for constrained parametrization (user is remaking it). All items deferred. Prior framing: superseded by the source.ts component pivot (bundle K); original aim was API/vendor KB tables → DesignSpace + Generator → derived params, replacing freeform Opus param picking with a constrained choice space.' },
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
    { id:  7, bundle: 'A', lane: 0, start: 1,  weeks: 1.5, priority: 'high',   status: 'deferred', title: 'Re-render primitives with red-outer/grey-internal coloring + shading before pHash/CLIP — shelved: cold-classification 17/18 killed CLIP rationale' },
    { id:  8, bundle: 'A', lane: 0, start: 2,  weeks: 0.5, priority: 'low',    status: 'on-demand', title: 'Add new primitive types as drilling needs surface' },
    { id:  9, bundle: 'A', lane: 0, start: 2,  weeks: 1.5, priority: 'medium', status: 'todo',      title: 'Per-primitive spec MD → builder code generator: seed MD from existing builder.ts (one-shot Claude), then make MD the source of truth' },
    { id: 10, bundle: 'A', lane: 0, start: 3,  weeks: 2,   priority: 'medium', status: 'todo',      title: 'NL → ManifoldCAD code: prompt-tuned Claude that turns natural-language primitive descriptions into builder.ts function bodies' },

    // ───── B. Retrieval (RAG + CLIP) ─────
    { id: 20, bundle: 'A', lane: 1, start: -7, weeks: 1.5, priority: 'medium', status: 'done', title: 'pHash 2D-DCT perceptual hash + hamming distance' },
    { id: 21, bundle: 'A', lane: 1, start: -6, weeks: 1,   priority: 'medium', status: 'done', title: 'TrainingCache (JSONL, atomic write, feedback weighting)' },
    { id: 22, bundle: 'A', lane: 1, start: -5, weeks: 1.5, priority: 'high',   status: 'done', title: '/api/identify — RAG few-shot prompt + Claude vision' },
    { id: 23, bundle: 'A', lane: 1, start: -4, weeks: 1,   priority: 'medium', status: 'done', title: '/api/refine — SSIM loop + Claude param updates' },
    { id: 24, bundle: 'A', lane: 1, start: -3, weeks: 0.5, priority: 'medium', status: 'done', title: '/api/accept + /api/feedback — user-validated cache growth' },
    { id: 25, bundle: 'A', lane: 1, start: -2, weeks: 1,   priority: 'medium', status: 'done', title: 'HAL catalog ingest into cache.jsonl (1,772 records) — scaffolding only; 1,646 unknown-component records deleted 2026-05-11 (chore 0cdd687)' },
    { id: 26, bundle: 'A', lane: 1, start:  0, weeks: 0.5, priority: 'large',  status: 'done', title: 'CLIP retrieval rollout — embed module, hybrid scoring, identify wiring' },
    { id: 27, bundle: 'A', lane: 1, start:  0, weeks: 0.3, priority: 'medium', status: 'done', title: 'Synthetic data generator — Playwright × 5 angles × 7 styles (700 samples)' },
    { id: 28, bundle: 'A', lane: 1, start:  1, weeks: 2,   priority: 'high',   status: 'deferred', title: 'Address CLIP silhouette collapse — shelved per cold-classification finding; revisit if Opus-direct-from-image fails for real photos' },
    { id: 29, bundle: 'A', lane: 1, start:  3, weeks: 1.5, priority: 'medium', status: 'open',     title: 'Replace 18-image retrieval test with real photo benchmark — the open door for retrieval: only justifies CLIP/RAG work if Opus-direct on real photos isn\'t enough' },
    { id: 30, bundle: 'A', lane: 1, start:  4, weeks: 2,   priority: 'medium', status: 'deferred', title: 'Domain-adapted CLIP fine-tune — shelved; gated on #29 showing meaningful retrieval gain over Opus-direct baseline' },

    // ───── D. Wells → SVTC WSON ─────
    { id: 60, bundle: 'D', lane: 3, start:  0,   weeks: 0.2, priority: 'high',   status: 'done', title: 'WSON schema + validateWson — mirrored from SVTC src/lib/apps/wson/CLAUDE.md' },
    { id: 61, bundle: 'D', lane: 3, start:  0.2, weeks: 0.2, priority: 'high',   status: 'done', title: '/api/wells/extract — Claude (Opus 4.7) vision → WSON; type:document for PDFs; rate-limited' },
    { id: 62, bundle: 'D', lane: 3, start:  0.4, weeks: 0.2, priority: 'high',   status: 'done', title: '/wells UI — upload, extract, render section cards, download JSON' },
    { id: 63, bundle: 'D', lane: 3, start:  1,   weeks: 0.5, priority: 'medium', status: 'open', title: 'wells_cache.jsonl persistent store (mirrors training_data/cache.jsonl pattern; gitignored once it grows)' },
    { id: 64, bundle: 'D', lane: 3, start:  2.5, weeks: 1, priority: 'medium', status: 'open', title: 'Pre-built corpus — Aramco ABJF-610 well, Volve, FORGE — verify extraction quality before opening to user uploads' },
    { id: 65, bundle: 'D', lane: 3, start:  3.5, weeks: 1, priority: 'medium', status: 'open', title: 'Validation roundtrip — feed extracted WSON to SVTC\'s 2D + 3D renderers, compare against ground truth, log mismatches' },
    { id: 66, bundle: 'D', lane: 3, start:  4.5, weeks: 0.5, priority: 'low',  status: 'open', title: 'Confidence-driven review queue — auto-accept ≥ 0.95, spot-check ≥ 0.80, full re-extract otherwise' },

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
    { id: 202, bundle: 'G', lane: 6, start:  2.2, weeks: 0.5, priority: 'high',   status: 'open',   title: 'G.2 — SVG extractor: schematic pages → static/kb/<vendor>/svg/<chapter-page>.svg (design-intent reference + Opus visual context for H bundle)' },
    { id: 203, bundle: 'G', lane: 6, start:  2.7, weeks: 0.5, priority: 'high',   status: 'open',   title: 'G.3 — Spec-table extractor: tables → static/kb/<vendor>/specs/<chapter>.json (DesignSpace-ready structured tubing/casing/packer dimensions)' },
    { id: 204, bundle: 'G', lane: 6, start:  3.2, weeks: 0.7, priority: 'medium', status: 'open',   title: 'G.4 — Component-label graph: labeled cross-sections → {label, bbox, line_to_part_bbox}; feeds H assembly grammar' },
    { id: 205, bundle: 'G', lane: 6, start:  3.9, weeks: 0.5, priority: 'medium', status: 'done',   title: 'G.5 — Catalog indexer: COMPLETE-BY-DELETION (chore 0cdd687, 2026-05-11) — 1,646 unknown records dropped; KB tables (H bundle) replace cache as vendor-data source of truth' },
    { id: 206, bundle: 'G', lane: 6, start:  4.4, weeks: 0.5, priority: 'medium', status: 'open',   title: 'G.6 — /cad/catalog/<vendor>/<chapter> browse UI: per-page viewer with toggle (raster/SVG/extracted-data overlay)' },
    { id: 207, bundle: 'G', lane: 6, start:  4.9, weeks: 0.5, priority: 'low',    status: 'open',   title: 'G.7 — Cross-reference packer model names (Perma-Series, Versa-Trieve, etc.) to authored cadtrain primitives — tag /author entries with vendor model when matched' },

    // ───── H. Constrained Parametrization (designing not building) ─────
    { id: 300, bundle: 'H', lane: 7, start:  5.0, weeks: 0.3, priority: 'high',   status: 'deferred', title: 'H.0 — Static KB foundation: static/kb/api/ directory + first table (API 5CT tubing from pptx in Downloads)' },
    { id: 301, bundle: 'H', lane: 7, start:  5.3, weeks: 0.4, priority: 'high',   status: 'deferred', title: 'H.1 — Schema: DesignSpace + Generator + VariableDef in src/lib/authoring/schema.ts (backward-compat: variables optional)' },
    { id: 302, bundle: 'H', lane: 7, start:  5.7, weeks: 0.4, priority: 'high',   status: 'deferred', title: 'H.2 — Svelte-runes expression engine: compile JSON formulas → live $derived chains (Architecture A from the design discussion)' },
    { id: 303, bundle: 'H', lane: 7, start:  6.1, weeks: 0.4, priority: 'high',   status: 'deferred', title: 'H.3 — Pup joint as proving ground: hand-written DesignSpace + Generator; rendered output matches existing eue_pup_joint_275 byte-for-byte' },
    { id: 304, bundle: 'H', lane: 7, start:  6.5, weeks: 0.5, priority: 'high',   status: 'deferred', title: 'H.4 — Workbench tab "Variables" with Formula + Visual sub-tabs (table view + dependency graph)' },
    { id: 305, bundle: 'H', lane: 7, start:  7.0, weeks: 0.5, priority: 'medium', status: 'deferred', title: 'H.5 — Opus generator rewrite: picks coordinates in DesignSpace, doesn\'t write raw params; constraints satisfied by construction' },
    { id: 306, bundle: 'H', lane: 7, start:  7.5, weeks: 0.5, priority: 'medium', status: 'deferred', title: 'H.6 — Retrofit: migrate each of the 10 existing assemblies to a DesignSpace coordinate; verify visual identity pre/post' },
    { id: 307, bundle: 'H', lane: 7, start:  8.0, weeks: 0.7, priority: 'medium', status: 'deferred', title: 'H.7 — KB expansion: API 5CT casing + EUE/NUE/NC/IF/FH/REG/LTC thread spec tables (machine-extracted from API 5CT pptx + thread standards)' },
    { id: 308, bundle: 'H', lane: 7, start:  8.7, weeks: 0.3, priority: 'low',    status: 'deferred', title: 'H.8 — Library-wide variable propagation: change casing_size once → every assembly using it updates; per-assembly override mechanism' },
    { id: 309, bundle: 'H', lane: 7, start:  9.0, weeks: 0.5, priority: 'low',    status: 'deferred', title: 'H.9 — Opus design-reviewer: post-save soft warnings ("slip count inconsistent with packer rating", "OD exceeds casing drift"); badge in workbench' },
    { id: 310, bundle: 'H', lane: 7, start:  9.5, weeks: 1.0, priority: 'medium', status: 'deferred', title: 'H.10 — Vendor-PDF-to-DesignSpace: Opus reads a vendor catalog page (image) and emits a DesignSpace + Generator directly — the "do we need CLIP/RAG?" alternative path that keeps Bundle B shelved if it works' },

    // ───── I. 4-level hierarchy + composite generators ─────
    { id: 400, bundle: 'I', lane: 8, start: 10.0, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.0 — /components sidebar restructure: 4 hierarchy tabs (Primitives / Compositions / Components / Assemblies) + KB tab; tab-strip-on-left, in-tab Threlte canvas + scene controls' },
    { id: 401, bundle: 'I', lane: 8, start: 10.4, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.1 — Variation generator in library.ts: ComponentDef.parent + deriveVariation(spec) + buildPrimitiveManifold parent-chain fallback. SC/LC/BC box+pin variants generated from one spec table' },
    { id: 402, bundle: 'I', lane: 8, start: 10.7, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.2 — Tubing rules file (src/lib/cad/rules/tubing.ts): TubingInputs → resolveTubing (KB lookup + formula fallback) → buildTubingSpec → AuthoredComponent. Box on top, pin on bottom convention encoded' },
    { id: 403, bundle: 'I', lane: 8, start: 11.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.3 — Drill-pipe identification KB (static/kb/api/drill-pipe-identification.json) + drill_pipe_tool_joint primitive (parametric tong-area marking) + rules/drill_pipe.ts mirroring the tubing pipeline' },
    { id: 404, bundle: 'I', lane: 8, start: 11.5, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.4 — KB row → composite preview: optional rowAction prop on KbTableViewer; casing-tubing rows get a ▶ button → generateTubingComponent → opens as composite tab' },
    { id: 405, bundle: 'I', lane: 8, start: 11.8, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.5 — Catalog-inspired primitives: window_cutout (LatchRite multilateral), whipstock, sliding_sleeve (HS-ICV / MCC-ICV pattern), drill_pipe_tool_joint' },
    { id: 406, bundle: 'I', lane: 8, start: 12.1, weeks: 0.2, priority: 'medium', status: 'deferred',   title: 'I.6 — Sample drill-pipe entries in Compositions tab using rules/drill_pipe.ts (5"/4-1/2"/3-1/2" × E75/X95/G105/S135)' },
    { id: 407, bundle: 'I', lane: 8, start: 12.3, weeks: 0.2, priority: 'medium', status: 'deferred',   title: 'I.7 — Drill-pipe KB row action: ▶ on each marking row → generateDrillPipeComponent → composite tab' },
    { id: 408, bundle: 'I', lane: 8, start: 12.5, weeks: 0.5, priority: 'medium', status: 'deferred',   title: 'I.8 — Bottom-Sub + Ratch-Latch in-tab port: write buildUnifiedManifold(flatParams) wrappers in each tool dir; register as ComponentDef so they open in /components instead of bouncing to /archive/tools/*' },
    { id: 409, bundle: 'I', lane: 8, start: 13.0, weeks: 0.4, priority: 'medium', status: 'deferred',   title: 'I.9 — Auto-list every KB tubing/casing row as a generated composition under "Standard API tubing/casing"; one entry per (size, weight, grade) row' },
    { id: 410, bundle: 'I', lane: 8, start: 13.4, weeks: 0.7, priority: 'medium', status: 'deferred',   title: 'I.10 — Multilateral catalog extractor: 633400581 PDF → static/kb/api/multilateral-junctions.json; auto-listed as 3rd KB tab entry' },
    { id: 411, bundle: 'I', lane: 8, start: 14.1, weeks: 0.5, priority: 'low',    status: 'deferred',   title: 'I.11 — Editable Composition tabs: Params popup on a tubing/drill-pipe composite shows the input fields (size, weight, grade, length); editing rebuilds the spec via the rules → live geometry' },
    { id: 412, bundle: 'I', lane: 8, start: 14.6, weeks: 0.5, priority: 'low',    status: 'deferred',   title: 'I.12 — Decompose remaining compositions (thread_if/thread_fh/thread_nc) from custom builders into AuthoredComponent specs (body + drill_pipe_tool_joint with the right marking)' },

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
    { id: 509, bundle: 'J', lane: 9, start: 17.4, weeks: 0.2, priority: 'medium', status: 'open',   title: 'J.9 — Retire warp experiment: delete `src/lib/shared/warp.ts`, drop `scene.warp*` fields, remove SceneControls Warp row + two `attachWarpShader(...)` call sites + the geometry-swap effect. Grep finds every touchpoint via `// TEMP warp experiment`' },
    { id: 510, bundle: 'J', lane: 9, start: 17.6, weeks: 0.3, priority: 'low',    status: 'open',   title: 'J.10 — Re-save older bundle primitives so their `<id>.cut.glb` lands on disk (ComponentSceneGlb falls back to the full GLB until then). 28 bundle components to walk; can be scripted via a one-shot loop POSTing to /api/components/save with each `.ts`s own source' },
    { id: 511, bundle: 'J', lane: 9, start: 17.9, weeks: 0.2, priority: 'high',   status: 'done',   title: 'J.11 — AI refine Level 1: dynamic prompt from discoverHelpers/discoverOperators; teaches accumulator-form defineGeom(meta, (p, geom) => …), cross-instance refs, top-model stacking, and warns AI off the loader-managed meta fields (instanceColors/instanceOps/instanceTopMode/instanceTopOffset)' },
    { id: 512, bundle: 'J', lane: 9, start: 18.1, weeks: 0.4, priority: 'high',   status: 'todo',   title: 'J.12 — AI refine Level 2: post-generation validation in the refine endpoint (imports allowlist · denylist scan · undefined-instance detection · syntax check · optional live-bake · retry-once-with-errors-fed-back)' },
    { id: 513, bundle: 'J', lane: 9, start: 18.5, weeks: 0.2, priority: 'high',   status: 'todo',   title: 'J.13 — AI refine Level 3: live-bake gate on the inspector Accept button — status pill ("✓ Builds" green / "✗ Bake failed: <msg>" red); Accept disabled on failure. Uses the existing /api/components/bake-preview endpoint, no backend changes' },
    { id: 514, bundle: 'J', lane: 9, start: 18.7, weeks: 0.3, priority: 'medium', status: 'todo',   title: 'J.14 — AI refine Level 4: assembly-aware prompt — when refining a composition, glob docs/assemblies/README.md + matching <assembly>.md into the system prompt. Today nothing in src/ reads docs/assemblies/ so the AI re-invents known recipes every refine' },

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
    { id: 613, bundle: 'K', lane: 10, start: 23.6, weeks: 0.5, priority: 'medium', status: 'todo',   title: 'K.13 — Warp z-spline revisit (PARKED): give the warp path its OWN popup (open polyline anchored at origin, not the closed-profile ProfileEditor) + fix the suspected interpretation bug (Z-down anchor z0=min.z=top→s=0; planar-only frame; x-centered assumption).' },
    { id: 614, bundle: 'K', lane: 10, start: 24.1, weeks: 0.5, priority: 'low',    status: 'todo',   title: 'K.14 — Profile P3: custom-function generator profiles (user-authored build(p) on the volume, sandbox-eval + async endpoint pre-resolution) + an advanced editor tab.' },
    { id: 615, bundle: 'K', lane: 10, start: 24.6, weeks: 1.0, priority: 'medium', status: 'open',   title: 'K.15 — Construction-tree EDITABLE: drag/reparent JSON tree (recipe.json substrate, evalTree) superseding the read-first view — construction-tree.md P1–P4. Large refactor (composites source.ts→JSON + migration).' },
    { id: 616, bundle: 'K', lane: 10, start: 25.6, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.16 — Profile popup redesign: ~20% smaller, vertical editor|coords-table split, searchable shape DROPDOWN (thumbnail-as-you-type) replacing the preset "tabs" + <select>; applied to leaf + composite popups.' },
    { id: 617, bundle: 'K', lane: 10, start: 26.1, weeks: 0.5, priority: 'high',   status: 'done',   title: 'K.17 — "+ new primitive" sidebar popup (FloatingPanel, not native prompt): name + searchable r_* BASE picker → composes the r_* via meta.uses + a NAMED instance (const body = r_*(...)). Rule 20 (author from r_*, never raw cyl/tube). Tree-aware delete fix (archive basic/completions parts).' },
    { id: 618, bundle: 'K', lane: 10, start: 26.6, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.18 — BODMAS tree expands intermediate composition variables (const geom = ball.add(body) → named sub-composite node; ((ball ∪ body) ∪ revolve2)).' },
    { id: 619, bundle: 'K', lane: 10, start: 26.9, weeks: 0.8, priority: 'high',   status: 'open',   title: 'K.19 — Profile EXPRESSIONS: parametric profile params drivable by expressions referencing the composite params (rMajor: od/2) via the ƒ expression builder (reuse openFx, lists composite params + Math); profile arg → resolveProfile({kind, params:{exprs}}) spliced into source (no resolver change — evaluated in scope). Composite profiles; later hooks P3 custom-fn. See docs/plans/profile-expressions.md.' },
    { id: 620, bundle: 'K', lane: 10, start: 27.7, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.20 — Parametric drill-pipe connection profile KINDS: drill_pipe_pin (male) + drill_pipe_box (female) in PROFILE_REGISTRY (revolve half-section computed from bore/wall=body-thickness/tjOD/lengths/taper, box adds counterbore). Pick in the profile dropdown → r_revolve renders the connection; profile visible. Kind params are a compact 2-col grid of draggable number boxes (dragNumber, no spinner arrows) like the Parts panel, live-redraw. Kinds live in src (curated library); saved dimensioned configs → volume.' },
    { id: 621, bundle: 'K', lane: 10, start: 28.3, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.21 — r_threads internal/external switch (side param) + taper: external/male threads sit on the OD with ridges inward (subtract cuts the outer pin surface); internal (default) unchanged. Enables male tapered threaded joints on pin connections.' },
    { id: 622, bundle: 'K', lane: 10, start: 28.6, weeks: 1.2, priority: 'high',   status: 'open',   title: 'K.22 — Profiles directory: structured parametric profile-function library (params → (r,z) half-section) so revolve parts = pick-a-profile, no hardcoded points. Two tiers behind one catalog: curated src PROFILE_REGISTRY + user volume primitives/profiles/<id>/ (profile.json + sandboxed build() source.ts, P3). + "revolve part from profile" quick-create. See docs/plans/profiles-directory.md. Supersedes the dp_ball patchwork.' },
    { id: 623, bundle: 'K', lane: 10, start: 29.0, weeks: 0.8, priority: 'high',   status: 'done',   title: 'K.23 — New-primitive create fixed + function-first: stub generator serialized polygon array defaults unbracketed (default: 0,0,1,0) → invalid meta → save 400; now JSON.stringify + type:polygon (pure src/lib/cad/primitive-stub.ts, unit + e2e tests). Raw r_revolve/r_extrude removed from the create picker. Fancy var-name profile inputs in the part row + top panel. Delete params from the Parameters section (FloatingPanel confirm). Optimistic-create: just-created parts show immediately despite the laggy prod list (pendingCreated/mergePending).' },
    { id: 624, bundle: 'K', lane: 10, start: 29.8, weeks: 1.2, priority: 'high',   status: 'active',   title: 'K.24 — File-based P0. SHIPPED 2026-05-26: flat typed files <id>.{prim,asm}.ts + profiles <id>.{prvl,prex}.ts (mid-ext=type); prod volume MIGRATED (42 prims source.ts→.prim.ts, 4 profiles profile.json+source.ts→one .prvl.ts module); single resolver primitive-paths.ts (dual-read legacy); endpoints source/save/list/delete/restore + profiles/* rewritten. REMAINING (P0b): content-hash bake cache keyed on content+params+dep-hashes, busted on save. See docs/plans/file-based-architecture.md.' },
    { id: 625, bundle: 'K', lane: 10, start: 31.0, weeks: 1.2, priority: 'high',   status: 'open',   title: 'K.25 — File-based P1: client app registry (getApp(midExt)→editor: prvl/prex→ProfileFnEditor, prim/asm→PrimitiveView) + tabs-as-files (path-keyed tab store, dedupe, persist to volume/session). Sidebar lists files incl. a Profiles section. (SVTC tabs.svelte.js + apps/registry + shared/tabIO.)' },
    { id: 626, bundle: 'K', lane: 10, start: 32.2, weeks: 1.2, priority: 'high',   status: 'open',   title: 'K.26 — File-based P2: composition-by-reference + profile slots. profileSlots on a part (ProfileSlotPicker filtered by mid-ext); pick+lift params; swap re-lifts; "open ↗" pops the profile into its own tab; assemblies (.asm.ts) reference volume files by id (recursive DAG); bake resolves the reference graph. (SVTC FileSlotPicker + autoReconnect.)' },
    { id: 627, bundle: 'K', lane: 10, start: 33.4, weeks: 0.8, priority: 'high',   status: 'open',   title: 'K.27 — File-based P3: kill vertex profiles. Load…/create always fill a profile SLOT (never a vertex array); retire the draggable vertex editor from the profile flow (leafEdit / profileEdit literal+profile / ProfileEditor — warp-path keeps it). docs/plans/file-based-architecture.md.' },
    { id: 628, bundle: 'K', lane: 10, start: 34.2, weeks: 0.4, priority: 'medium', status: 'todo',   title: 'K.28 — File-based P4: migrate legacy vertex parts (dp_new revolve2, archived dp_*) to profile-slot references or remove. Future: per-user volume space (ties bundle L identity). docs/plans/file-based-architecture.md.' },
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
    { id: 643, bundle: 'K', lane: 10, start: 41.0, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.43 — A Phase 2 (DEFERRED): true GPU InstancedMesh for the live mesh + GLB renderer. place(parts) today CONCATENATES mesh data (no GPU instancing); finalize/upload scales linearly with total triangles (~2s at 12 joints, 211ms at 3). True InstancedMesh = one geometry + N transform matrices = flat memory/upload. Only build when long strings (50+ joints) become felt pain.' },
    { id: 644, bundle: 'K', lane: 10, start: 41.6, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.44 — D Phase 2 (DEFERRED): repeat_with_data(array, fn) for HETEROGENEOUS instances — BHA with mixed HWDP/drill pipe/stabilizers, per-iteration params from a data array. Sandbox = native data.map (no helper needed); recognizer extension to spot const items = data.map((d,i) => mv(<inst>(...d), [...])); return place(items). Build when a concrete varied use case lands.' },
    { id: 645, bundle: 'K', lane: 10, start: 42.2, weeks: 1.0, priority: 'low',    status: 'todo',   title: 'K.45 — D Phase 3 (DEFERRED): true enter/update/exit reconciliation runtime inside the bake pipeline. D3-style: array diffing by identity, incremental rebuild only on changed instances, cached per-iteration sub-builds. Significant runtime layer (only worth building when D Phase 2 strains long strings).' },
    { id: 646, bundle: 'K', lane: 10, start: 42.2, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.46 — Subfolders inside completions/<family>/ + 📁+ folder-create button + dp_test_* parts (2026-05-28, ddbcab5 + 4c6a7ee). primitive-paths.findPrim walks a 3rd level; /api/primitives/list returns completionSubfolders so empty folders surface; save/move TARGET_RE accepts the nested form. UI: per-family 📁+ FloatingPanel POSTs /api/volume?action=mkdir (no new endpoint), nested fold per subfolder in the sidebar, move-to-folder picker includes subfolders as targets. Test parts authored to primitives/completions/drill_pipe/test/ on prod: dp_test_2_7_8_g105_nc31, dp_test_4_5_g105_nc46, dp_test_4_5_20_g105_nc50 (Perforator API spec rows pp 6-7, 14-15, 16-17) + dp_test_hwdp_5_spiral (3 helical wear pads via r_threads at wide pitch + 120° rotations).' },
    { id: 647, bundle: 'K', lane: 10, start: 42.6, weeks: 0.6, priority: 'high',   status: 'done',   title: 'K.47 — Visual loop (repeat row) in the profile editor — D3-join style without D3 (2026-05-28, 2659296 + 352bec5 + bbc48d3 + 6df44f6 + c0ff807 + 83a152e). + repeat cmd added to ProfileFnEditor Move type with a/b/c = count, x(i), y(i). composeSource emits Array.from spread when any repeat row present (mixed with mv/line static rows). parseBody Phase 2 recognizes Array.from({length: N}, (_, i) => BODY) — inline + block-with-local-calcs forms — with chained-calc inlining to fixpoint; parseCalc fixed to track brace depth (was leaking inner callback consts as top-level). Stacked layout: N + cmd + delete on row 1, x(i) and y(i) each get their own full-width row with monospace 13px for math readability. Three polar-pattern volume samples on prod: ngon_v2 (uniform r), star_v2 (alternating r via i%2), gear_v2 (sinusoidal rBase + amp*cos(teeth·θ)) — all decompose into one editable repeat row + render correctly (6/10/96 points). Curated Ellipse also decomposes into one repeat row with rMajor*cos((i/n)·2π) / rMinor*sin((i/n)·2π).' },
    { id: 648, bundle: 'K', lane: 10, start: 43.2, weeks: 0.3, priority: 'medium', status: 'done',   title: 'K.48 — Cartesian profile fix + parseBody return-array decomposition (2026-05-28, 4c6a7ee + 05fa017 + e95a97c). ProfileFnEditor DEFAULT_BODY + seedRows fallback branch on the `set` prop — cartesian + New profile now scaffolds a centered {w, h} rectangle (was the revolve half-section + r/len, which threw "build(p) must return ≥ 3 [r,z] points"). profile-fn validator error message neutralized to mention both axes. parseBody extended to extract structured moves from a tail return-array literal (rect/l/t/plus/cylinder/tube/cone/barrel/drill_pipe_pin all decompose). Procedural bodies (ellipse/ngon/star before K.47) preserved verbatim by composeSource so they still render via /profiles/resolve.' },
    { id: 649, bundle: 'K', lane: 10, start: 43.5, weeks: 0.4, priority: 'high',   status: 'done',   title: 'K.49 — Basic subfolders (Revolved / Extruded / test_primitives) + 6 extrude samples (2026-05-28, e96201e). /api/primitives/list returns basicSubfolders[] + tags entries with subfolder; save/move regexes accept basic/<sub>. Sidebar Primitives tab Basic group nests subfolder folds the same way Components families do; 📁+ button mirrors the per-family one; mkdir popup generalized to take parent ∈ {basic, completions/<family>}. Volume reorg on prod: 9 existing r_* → basic/revolved/; 6 extrude samples authored to basic/extruded/ — r_cube_ext (rect), r_cylinder_ext (ellipse), r_hex_prism (ngon_v2 polar), r_star_prism (star_v2 polar), r_gear_prism (gear_v2 polar), r_l_beam (l cartesian); basic/test_primitives/ empty playground. All six preview-build end-to-end against r_extrude(profile, length).' },
    { id: 653, bundle: 'K', lane: 10, start: 44.0, weeks: 0.3, priority: 'medium', status: 'todo',   title: 'K.53 — Responsive editor layout (mobile / small-screen stacking). The profile editor (and /primitives sidebar) currently use a fixed multi-column grid; below some viewport width the columns squish unreadably. Plan: a CSS container query / breakpoint (~720px) that switches `.fn-ed.fill` to one column with sections STACKED top-to-bottom (params · expressions · path · 2D SVG · 3D Threlte), and the /primitives sidebar collapses into a top-level section bar (Primitives | Components | Archive across the top instead of in a vertical rail). Touch-friendly hit targets along the way. Useful for tablet / mobile iteration on the field.' },
    { id: 655, bundle: 'K', lane: 10, start: 44.9, weeks: 1.4, priority: 'high',   status: 'todo',   title: 'K.55 — Sweep-along-path (3D path sweep, an extrude variant for non-linear axes). Today r_weld_extrude sweeps a 2D cross-section LINEARLY down z (straight prism, optional twist + taper). The natural generalization: sweep the SAME cross-section along an arbitrary 3D PATH — bends, helices, curved tubes, spline-driven sweeps, pipe runs that follow a hand-drawn 3D trajectory. Manifold-3d does not provide this natively (CrossSection.extrude is linear-only); the implementation is the hand-wound rail-weld path with ring positions placed along the path tangent + per-station local frame (Frenet or RMF — rotation-minimizing frame to avoid twist artifacts on turns). NEW stdlib `r_sweep` takes (profile, path_pts, optional twistFn(s), optional scaleFn(s)). The path is a 3D polyline OR a function s → [x, y, z] sampled at N stations. Each station gets a local frame; the cross-section is laid flat in that frame and the sides are stitched (gridPatch + capFan + weldAndBuild). Demos: U-bend pipe (path is two straights + a quarter-arc), helical coil (path = (cos(t), sin(t), t·pitch)), gooseneck cable run (Bezier 3D path), drill-pipe stand with a tapered bend at the joint. Pairs with the existing sweep/weld bench numbers: native r_weld_extrude does linear in ~1 ms; r_sweep on the same N×M grid should land in the 1.5–2× range (similar to W-twist vs CS-twist) because each station has the same per-vertex math just placed differently. Two builders that emerge: SweepPart (open path with end caps) + SweepLoop (closed path = torus-like). New file type: `<id>.swp.ts` mid-extension, dispatches a SweepPartBuilder (path editor + cross-section editor + 3D preview). Big future win: this enables anything that does not fit a straight extrude/revolve — gooseneck flow lines, coiled tubing, casing strings that follow a wellbore curve. Order it AFTER the K.55-precursor tab dispatch lands (Extrude/Profile/Assembly are simple cases first); then K.55 adds the path-sweep type alongside.' },
    { id: 656, bundle: 'K', lane: 10, start: 46.0, weeks: 1.0, priority: 'high',   status: 'open',   title: 'K.56 — Assembly composition robustness (Option B + warnings). Two-phase plan to keep assemblies stable as their referenced components evolve. PHASE 1 (shipped 5c60993): every typed-part scaffold emits a `<key> ??= <default>;` block at the TOP of the function body so assembly call sites that drift (component gained a param → old positional call passes fewer args → new positions arrive as undefined) silently use the default instead of breaking with `Array.from({length: undefined})` style errors. Renaming/removing/changing-semantics still produce visible failures (the right signal). PHASE 2 (in flight): component-change warning chip in the assembly canvas. Snapshot stored in meta.dependencies = [{id, paramKeys, hash}] at drop time; assembly-deps.ts util computes a djb2 hash of (meta.params keys + function body) per component; on open, compare snapshots vs live components and surface a yellow chip listing what changed (`params added: taper · body changed`) with actions [Update snapshots] [Open <component>] [Embed copy as local]. The "Embed copy" path inlines the component source as a local function in the assembly, decoupling it from upstream changes — this is the (A) escape hatch from the earlier discussion. PHASE 3 (deferred): visual op picker per instance — switch between .add / .subtract / .intersect / place([…]) (non-fused topological compose) via a small dropdown on each part row in the AssemblyEditor; default is .add. Currently the user can change ops by editing source. PHASE 4 (deferred): visual mv/rot/scale offset widgets that do not require expression typing. Whole bundle replaces the legacy AssemblyEditor with a focused builder that matches the Extrude/Revolve typed builders shape (drag-resizable splitter, save chip top-left, scene right, search-on-canvas add-part).' },
    { id: 657, bundle: 'K', lane: 10, start: 46.2, weeks: 0.1, priority: 'low',     status: 'done',   title: 'K.57 — A/B/C instance naming on drag-into-assembly + Mesh-Live label drop in legacy view (2026-05-29, NEXT). Per user — short alphabetical instance names (Excel-column-style: A, B, …, Z, AA, AB, …) in place of the current childId-derived ones (rod_4, my_try_extreude2). Easier to read in chained .add(A).add(B).subtract(C) expressions. Plus the \"Mesh (live)\" label chip in PrimitiveDualCanvas now hidden in the legacy AssemblyEditor view (already hidden in the typed-builder dispatch). Only one scene per pane so the label is visual noise.' },
    { id: 654, bundle: 'K', lane: 10, start: 44.3, weeks: 0.6, priority: 'medium', status: 'todo',   title: 'K.54 — Visual Repeat block for Array.from + place(ring) at the PARTS layer (sister to K.47 at the profile layer). Today w_test_ring_of_pegs / w_test_cube_grid / w_test_bolt_row author the polar/grid placement idiom directly in source — `const ring = Array.from({ length: p.count }, (_, i) => { const a = (i / p.count) * 2 * PI; return mv(peg, [cos(a) * p.ring_r, sin(a) * p.ring_r, 0]); }); return place(ring);` — and the user has to mentally simulate what each `i` produces. The recognizer already spots a Repeat × N node in the ConstructionTree (D Phase 1, K.45, dp_inst_stand case) but the Parts/Composition editor does NOT yet expose it as an editable visual block the way the ProfileFnEditor does for repeat ROWS in 2D profiles. Goal: lift the parts-layer Array.from idiom into a first-class visual block. Three halves: (a) RECOGNIZE — extend recognize-composite.ts to detect the Array.from({length}, (_, i) => …) form WITH inline calc consts (currently only for-loop), capturing {count, perInstance: {translateX(i), translateY(i), translateZ(i), rotX(i), …}, basePart}. (b) RENDER — new RepeatBlock row in the Parts accordion of PrimitiveView with editable count + x(i)/y(i)/z(i)/rot(i) expression slots (textareas, same monospace style as K.47), small ⓘ helper with common patterns (linear, polar ring, polar disk, cartesian grid, fibonacci spiral, helical). (c) ROUND-TRIP — composeSource emits the same Array.from + place(...) shape back so the source stays hand-editable. Connects to deferred D Phase 2 (repeat_with_data heterogeneous, memory `todo_*` notes) — same visual block, the loop pulls from a data array instead of a literal range. One dimension up from K.47 (2D points) to 3D placement.' },
    { id: 652, bundle: 'K', lane: 10, start: 45.4, weeks: 1.0, priority: 'medium', status: 'todo',   title: 'K.52 — Parallel-build composite parts via web workers (then CSG sequentially). Today a composite like t_drilled_block builds every component (r_cube_ext, then r_cylinder, then r_cylinder, …) sequentially in ONE sandbox + then runs the CSG chain. The component builds are independent — they can spawn into per-worker subprocesses, run in parallel, and serialize back to a Manifold mesh; the main thread then walks the .add/.subtract/.intersect chain. Win scales with component count and per-component build cost; worth it for dp_stand (3× dp_joint), drill-pipe assemblies, and anything with many r_threads helices. Trade-offs: Manifold WASM must load in each worker (one-time per session, cache); mesh serialization adds bytes (mesh-serial already exists). Likely first pass: a worker pool ~CPU-count, the loader (primitive-loader.ts buildPrimitiveGeom) detects independent named instances and Promise.all-s them through the pool, then folds via the existing CSG chain. SvelteKit + Vite already support web workers (`new Worker(new URL("./prim-worker.ts", import.meta.url))`), so the scaffolding is small.' },
    { id: 650, bundle: 'K', lane: 10, start: 43.9, weeks: 1.4, priority: 'high',   status: 'open',   title: 'K.50 — Extrude expressivity overhaul (2D-CSG profile composition + (θ, r, z) parametric weld-extrude). One feature surface, three sub-steps that compose into "anything sweepable along z without the warp post-pass." Sub-steps: (a) 2D-CSG before extrude — use Manifold CrossSection to compose multiple cartesian profiles via union/subtract/intersect, then extrude the resulting polygon. New stdlib `r_csg_extrude` takes an array of {kind, params, op ∈ {base, add, subtract, intersect}} (or a profile-level construction tree); demo = rect − ellipse bore − hex bolt-hole pattern → one extruded plate. (b) Weld-extrude with rail-weld geometry — replace Manifold.extrude with gridPatch + capFan + weldAndBuild (same machinery as r_revolve in manifold-mesh.ts). u = around-section param, v = along-z; user supplies x(u, v) / y(u, v) / z(u, v) or — sugar — r(u, v) + θ(u, v). Cross-section can MORPH along z (taper, twist, sinusoidal scaling, blend between two profiles) without warp post-pass that K.13 was parked on; pairs naturally with the visual loop / repeat row (K.47) — same data-driven mental model, one dimension up. Demos: twisted hex bar (θ += twist*v), tapered cylinder (r decays with v), gear with helix angle (the teeth wind around). (c) Composition — the cross-section at each v can itself be a 2D-CSG composite, so (a) feeds (b). Net effect: "extrude" stops meaning "linear sweep of a fixed polygon" and starts meaning "rail-welded swept surface of an arbitrary 2D-CSG cross-section that can vary along v."' },
    { id: 658, bundle: 'K', lane: 10, start: 47.0, weeks: 1.4, priority: 'high',   status: 'open',   title: 'K.58 — SVG-CSG 2D profile editor (`.csg.ts`) — authoring layer on top of K.50(a). Today the extrude profile is a SINGLE closed polygon; complex shapes (star with bore, plate with bolt-hole pattern, text-cut emblem) cannot be expressed without manually encoding winding inversions in one ring. ManifoldCAD CrossSection already supports full 2D CSG (.union/.difference/.intersection, .offset, .simplify, transforms) — engine is there; this bundle delivers the FILE FORMAT + DATA LAYER + GUI to compose them. Architecturally mirrors K.56 (3D assemblies): an ordered array of 2D-primitive rows with per-row op (union | difference | intersection) + transform (translate, rotate, scale); body is auto-generated and feeds r_extrude(profile, ...) downstream. Five phases — (0) vocabulary + engine: `src/lib/cad/csg2d.ts` wraps CrossSection with circle/rect/polygon/ellipse constructors; sandbox injection; hand-written `.csg.ts` round-trips. (1) file format: `.csg.ts` extension in primitive-paths.ts; "Profile (CSG-2D)" type in the + new picker; scaffolded under the existing Profiles tab next to .prvl/.prex. (2) data layer: `src/lib/cad/csg2d-instances.ts` — ~80% clone of assembly-instances.ts (Phase A of K.56) — parse/emit/round-trip for `meta.primitives`. (3) GUI: extend PrimitiveView with a csg2d kind; canvas2d for the 2D live preview (fill + per-primitive outline); SVG-overlay handles for direct-manipulation bbox/rotate/scale; Parts accordion reuses the 3D assembly drag-reorder + op pill chrome. (4) extrude lift: `+ Extrude` button scaffolds a sister `.exp.ts` that imports the CSG-2D as its profile. (5) deferred — SVG <path d="..."> parser + opentype.js font-glyph extraction for text profiles. Effort: phases 0-2 ≈ 3-4h (data layer is mostly clone-and-rename of K.56 Phase A); phase 3 ≈ 1 day (handle math + canvas2d render); phase 4 ≈ 80 lines; phase 5 its own session. Depends on K.56 Phase A landing first (so the data-layer pattern is settled before cloning).' },
    { id: 659, bundle: 'K', lane: 10, start: 47.5, weeks: 0.4, priority: 'medium', status: 'open',   title: 'K.59 — Implement `taper` in r_weld_extrude (currently a phantom slider). `meta.params.taper` is exposed (default 0, range -0.9..2.0) and the function signature takes it as the 5th positional arg, but `r_weld_extrude.ts:96-104` explicitly drops it for v1: the comment reads "taper is dropped for v1 — scaleTop\'s [s, s] tuple breaks topology in 3.4.1 even when twist=0". Two implementation paths. (a) Hand-wound rail-weld variant (K.50 sub-step b): u = around-section, v = along-z, scale at each v station via `r(u, v) = r(u, 0) · (1 + taper · v/h)`; cap with capFan + weldAndBuild; same machinery r_revolve uses. Gets taper correct without fighting Manifold\'s scaleTop bug, integrates with twist + segments dials. (b) Quick fix: feed `CrossSection.extrude(h, divs, twist, [taperScale, taperScale])` with twist forced to a near-zero floor (the bug only surfaces when twist is exactly 0 — but then divs has its own degenerate-slice issue per stdlib comment 88-94). Risky. Recommend (a) — it lines up with K.50(b) anyway and delivers per-v scale freedom. Until then the taper slider in the GUI is misleading: surface a deprecation note OR hide the row until the rail-weld variant lands. Validate against drill-pipe taper geometry (5° thread taper on dp_spec_pin) which currently has to be encoded in the profile polygon by hand.' },
    { id: 700, bundle: 'L', lane: 11, start: 22.3, weeks: 1.0, priority: 'high',   status: 'open',   title: 'L.1 — OAuth identity port from SVTC: Google OAuth + signed-session → event.locals.userId via sequence() in hooks (existing AUTH_TOKEN/proxy/rate-limit unchanged). Plan ready: docs/plans/oauth-identity.md. Blocked on user-provisioned Google OAuth creds.' },
    { id: 701, bundle: 'L', lane: 11, start: 22.3, weeks: 0.3, priority: 'medium', status: 'open',   title: 'L.2 — Public parts category: add `public` to LIBRARY_CATEGORIES (resolvers iterate the tuple) + visibility:public on save. Ships without identity.' },
    { id: 702, bundle: 'L', lane: 11, start: 23.3, weeks: 1.0, priority: 'high',   status: 'open',   title: 'L.3 — Private per-user parts under components/<userId>/ (REQUIRES L.1): user-scoped resolvers + owner enforcement; close R2 (/api/volume path guard), R3 (private out of proxy), R4 (list-cache by userId), R5 (id-collision scoped).' },
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

  function formatDate(weekOffset: number): string {
    const d = new Date(START.getTime() + weekOffset * WEEK_MS);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function weekX(weekOffset: number): number {
    return (weekOffset - minStart) * WEEK_PX;
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
    <div>
      <h1>Plan</h1>
      <p class="sub">
        {#if viewMode === 'done'}
          {doneCount} shipped · click any item for detail
        {:else}
          {openCount} open · {BUNDLES.length} bundles · start {START.toLocaleDateString()} · horizon ≈ {maxEnd}w forward
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
            {#if w % 4 === 0}
              <text x={w * WEEK_PX + 6} y={30} fill="#94a3b8" style="font: 9px system-ui">
                {formatDate(w + minStart)}
              </text>
            {/if}
          {/if}
        {/each}

        <line x1={0} y1={HEAD_H - 2} x2={chartWidth} y2={HEAD_H - 2} stroke="#cbd5e1" stroke-width="1" />

        <!-- Today marker -->
        <line x1={weekX(0)} y1={HEAD_H} x2={weekX(0)} y2={chartHeight}
              stroke="#ef4444" stroke-width="2" stroke-dasharray="4 3" />
        <text x={weekX(0) + 4} y={HEAD_H + 12} fill="#dc2626" style="font: 10px system-ui; font-weight: 600">Today</text>
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
W{t.start} ({formatDate(t.start)}) + {t.weeks}w
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
          <span>W{selectedTask.start} + {selectedTask.weeks}w</span>
          <span class="dot-sm"></span>
          <span>{formatDate(selectedTask.start)} → {formatDate(selectedTask.start + selectedTask.weeks)}</span>
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
