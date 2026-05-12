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
    { id: 'A', name: 'Primitives + viewers', tint: '#dc2626', desc: '18 ManifoldCAD primitives, /components viewer, dedicated tool viewers (Bottom Sub, Ratch-Latch)' },
    { id: 'B', name: 'Retrieval (RAG + CLIP)', tint: '#2563eb', desc: 'pHash + CLIP hybrid retrieval, /api/identify, /api/refine, training cache, synthetic data generator' },
    { id: 'C', name: 'Authoring (build app)',  tint: '#a855f7', desc: '/author tool-calling chat, /library viewer, authored cache + context doc' },
    { id: 'D', name: 'Wells → SVTC WSON',      tint: '#0891b2', desc: 'New: extract well-engineering documents into WSON for SVTC drawing apps' },
    { id: 'E', name: 'Infra + deploy',         tint: '#10b981', desc: 'Dockerfile, Railway volume, env config, model pre-pull' },
    { id: 'F', name: 'Meta + UX',              tint: '#ec4899', desc: 'this /plan route, navigation, documentation' },
    { id: 'G', name: 'Vendor catalog ingest',  tint: '#f59e0b', desc: 'Halliburton/Baker Hughes catalog PDFs → per-page assets → SVG schematics + spec-table JSON. Output now feeds bundle H (constrained parametrization), not cache.jsonl' },
    { id: 'H', name: 'Constrained parametrization', tint: '#7c3aed', desc: 'Designing not building: API/vendor KB tables → DesignSpace + Generator → derived params → Svelte-runes runtime. Replace freeform Opus param picking with coordinates in a constrained choice space.' },
    { id: 'I', name: '4-level hierarchy + composite generators', tint: '#0ea5e9', desc: 'Primitive → Composition → Component → Assembly. /primitives sidebar tabs + per-tier registries + rules files (tubing, drill_pipe) that take a small input set and emit a complete AuthoredComponent. KB-anchored generation, parent/child specialization in library.ts, in-tab Threlte rendering for every tier.' },
  ];

  const tasks: Task[] = [
    // ───── A. Primitives + viewers ─────
    { id:  1, bundle: 'A', lane: 0, start: -8, weeks: 4,   priority: 'large',  status: 'done', title: '18 parametric primitives in src/lib/components/library.ts' },
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
    { id: 20, bundle: 'B', lane: 1, start: -7, weeks: 1.5, priority: 'medium', status: 'done', title: 'pHash 2D-DCT perceptual hash + hamming distance' },
    { id: 21, bundle: 'B', lane: 1, start: -6, weeks: 1,   priority: 'medium', status: 'done', title: 'TrainingCache (JSONL, atomic write, feedback weighting)' },
    { id: 22, bundle: 'B', lane: 1, start: -5, weeks: 1.5, priority: 'high',   status: 'done', title: '/api/identify — RAG few-shot prompt + Claude vision' },
    { id: 23, bundle: 'B', lane: 1, start: -4, weeks: 1,   priority: 'medium', status: 'done', title: '/api/refine — SSIM loop + Claude param updates' },
    { id: 24, bundle: 'B', lane: 1, start: -3, weeks: 0.5, priority: 'medium', status: 'done', title: '/api/accept + /api/feedback — user-validated cache growth' },
    { id: 25, bundle: 'B', lane: 1, start: -2, weeks: 1,   priority: 'medium', status: 'done', title: 'HAL catalog ingest into cache.jsonl (1,772 records) — scaffolding only; 1,646 unknown-component records deleted 2026-05-11 (chore 0cdd687)' },
    { id: 26, bundle: 'B', lane: 1, start:  0, weeks: 0.5, priority: 'large',  status: 'done', title: 'CLIP retrieval rollout — embed module, hybrid scoring, identify wiring' },
    { id: 27, bundle: 'B', lane: 1, start:  0, weeks: 0.3, priority: 'medium', status: 'done', title: 'Synthetic data generator — Playwright × 5 angles × 7 styles (700 samples)' },
    { id: 28, bundle: 'B', lane: 1, start:  1, weeks: 2,   priority: 'high',   status: 'deferred', title: 'Address CLIP silhouette collapse — shelved per cold-classification finding; revisit if Opus-direct-from-image fails for real photos' },
    { id: 29, bundle: 'B', lane: 1, start:  3, weeks: 1.5, priority: 'medium', status: 'open',     title: 'Replace 18-image retrieval test with real photo benchmark — the open door for retrieval: only justifies CLIP/RAG work if Opus-direct on real photos isn\'t enough' },
    { id: 30, bundle: 'B', lane: 1, start:  4, weeks: 2,   priority: 'medium', status: 'deferred', title: 'Domain-adapted CLIP fine-tune — shelved; gated on #29 showing meaningful retrieval gain over Opus-direct baseline' },

    // ───── C. Authoring (build app) ─────
    { id: 40, bundle: 'C', lane: 2, start: -2, weeks: 2,   priority: 'medium', status: 'done', title: 'Authoring schema (AuthoredComponent / Part / Op / Step) + buildAuthored interpreter' },
    { id: 41, bundle: 'C', lane: 2, start: -1, weeks: 1.5, priority: 'medium', status: 'done', title: '/author manual editor — add primitives, transforms, CSG ops, save' },
    { id: 42, bundle: 'C', lane: 2, start:  0, weeks: 1.5, priority: 'medium', status: 'done', title: 'Claude tool-calling chat (ChatPanel + tool dispatcher)' },
    { id: 43, bundle: 'C', lane: 2, start:  0, weeks: 0.5, priority: 'medium', status: 'done', title: '/library — browse + reload authored components' },
    { id: 44, bundle: 'C', lane: 2, start:  1, weeks: 1,   priority: 'medium', status: 'open', title: 'Authoring fine-tune corpus — extract authoring_log[] for Claude fine-tuning' },
    { id: 45, bundle: 'C', lane: 2, start:  2, weeks: 1,   priority: 'medium', status: 'open', title: 'Auto-export authored → SVTC parametric tool library (commit in cadtrain triggers SVTC update)' },

    // ───── D. Wells → SVTC WSON ─────
    { id: 60, bundle: 'D', lane: 3, start:  0,   weeks: 0.2, priority: 'high',   status: 'done', title: 'WSON schema + validateWson — mirrored from SVTC src/lib/apps/wson/CLAUDE.md' },
    { id: 61, bundle: 'D', lane: 3, start:  0.2, weeks: 0.2, priority: 'high',   status: 'done', title: '/api/wells/extract — Claude (Opus 4.7) vision → WSON; type:document for PDFs; rate-limited' },
    { id: 62, bundle: 'D', lane: 3, start:  0.4, weeks: 0.2, priority: 'high',   status: 'done', title: '/wells UI — upload, extract, render section cards, download JSON' },
    { id: 63, bundle: 'D', lane: 3, start:  1,   weeks: 0.5, priority: 'medium', status: 'open', title: 'wells_cache.jsonl persistent store (mirrors training_data/cache.jsonl pattern; gitignored once it grows)' },
    { id: 64, bundle: 'D', lane: 3, start:  2.5, weeks: 1, priority: 'medium', status: 'open', title: 'Pre-built corpus — Aramco ABJF-610 well, Volve, FORGE — verify extraction quality before opening to user uploads' },
    { id: 65, bundle: 'D', lane: 3, start:  3.5, weeks: 1, priority: 'medium', status: 'open', title: 'Validation roundtrip — feed extracted WSON to SVTC\'s 2D + 3D renderers, compare against ground truth, log mismatches' },
    { id: 66, bundle: 'D', lane: 3, start:  4.5, weeks: 0.5, priority: 'low',  status: 'open', title: 'Confidence-driven review queue — auto-accept ≥ 0.95, spot-check ≥ 0.80, full re-extract otherwise' },

    // ───── E. Infra + deploy ─────
    { id: 80, bundle: 'E', lane: 4, start: -2, weeks: 0.5, priority: 'medium', status: 'done', title: 'Dockerfile (bun build → node:22-slim) + docker-entrypoint.sh' },
    { id: 81, bundle: 'E', lane: 4, start: -1.5, weeks: 0.5, priority: 'medium', status: 'done', title: 'railway.toml + Railway deploy from GitHub' },
    { id: 82, bundle: 'E', lane: 4, start: -1, weeks: 0.3, priority: 'medium', status: 'done', title: 'Railway volume mount for /data (cache persistence across deploys)' },
    { id: 83, bundle: 'E', lane: 4, start:  0.3, weeks: 0.3, priority: 'low',    status: 'deferred', title: 'Pre-pull CLIP weights in Dockerfile build — shelved with rest of CLIP work' },
    { id: 84, bundle: 'E', lane: 4, start:  1,   weeks: 0.5, priority: 'medium', status: 'deferred', title: 'warmup() CLIP at boot — shelved with rest of CLIP work' },

    // ───── F. Meta + UX ─────
    { id: 100, bundle: 'F', lane: 5, start:  0,   weeks: 0.2, priority: 'medium', status: 'done', title: '/plan Gantt route — this page' },
    { id: 101, bundle: 'F', lane: 5, start:  0.2, weeks: 0.1, priority: 'medium', status: 'done', title: 'Navbar: Wells + Meta segments added' },
    { id: 102, bundle: 'F', lane: 5, start:  0.4, weeks: 0.5, priority: 'low',    status: 'open', title: 'Per-task plan details — populate ./details.ts entries for in-flight items' },

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
    { id: 123, bundle: 'F', lane: 5, start:  4.5, weeks: 0.5, priority: 'medium', status: 'open',   title: 'GLB-via-REST: server-side ManifoldCAD writes <id>.glb (or <paramhash>.glb on Apply); client just GLTFLoads — no WASM in the browser at all' },
    { id: 124, bundle: 'F', lane: 5, start:  5.0, weeks: 1.0, priority: 'low',    status: 'open',   title: 'Explore GPU-based CSG (compute-shader booleans) for the giant-mesh path — would let /author do live edits on assemblies that today exceed WASM heap' },

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
    { id: 300, bundle: 'H', lane: 7, start:  5.0, weeks: 0.3, priority: 'high',   status: 'open',   title: 'H.0 — Static KB foundation: static/kb/api/ directory + first table (API 5CT tubing from pptx in Downloads)' },
    { id: 301, bundle: 'H', lane: 7, start:  5.3, weeks: 0.4, priority: 'high',   status: 'open',   title: 'H.1 — Schema: DesignSpace + Generator + VariableDef in src/lib/authoring/schema.ts (backward-compat: variables optional)' },
    { id: 302, bundle: 'H', lane: 7, start:  5.7, weeks: 0.4, priority: 'high',   status: 'open',   title: 'H.2 — Svelte-runes expression engine: compile JSON formulas → live $derived chains (Architecture A from the design discussion)' },
    { id: 303, bundle: 'H', lane: 7, start:  6.1, weeks: 0.4, priority: 'high',   status: 'open',   title: 'H.3 — Pup joint as proving ground: hand-written DesignSpace + Generator; rendered output matches existing eue_pup_joint_275 byte-for-byte' },
    { id: 304, bundle: 'H', lane: 7, start:  6.5, weeks: 0.5, priority: 'high',   status: 'open',   title: 'H.4 — Workbench tab "Variables" with Formula + Visual sub-tabs (table view + dependency graph)' },
    { id: 305, bundle: 'H', lane: 7, start:  7.0, weeks: 0.5, priority: 'medium', status: 'open',   title: 'H.5 — Opus generator rewrite: picks coordinates in DesignSpace, doesn\'t write raw params; constraints satisfied by construction' },
    { id: 306, bundle: 'H', lane: 7, start:  7.5, weeks: 0.5, priority: 'medium', status: 'open',   title: 'H.6 — Retrofit: migrate each of the 10 existing assemblies to a DesignSpace coordinate; verify visual identity pre/post' },
    { id: 307, bundle: 'H', lane: 7, start:  8.0, weeks: 0.7, priority: 'medium', status: 'open',   title: 'H.7 — KB expansion: API 5CT casing + EUE/NUE/NC/IF/FH/REG/LTC thread spec tables (machine-extracted from API 5CT pptx + thread standards)' },
    { id: 308, bundle: 'H', lane: 7, start:  8.7, weeks: 0.3, priority: 'low',    status: 'open',   title: 'H.8 — Library-wide variable propagation: change casing_size once → every assembly using it updates; per-assembly override mechanism' },
    { id: 309, bundle: 'H', lane: 7, start:  9.0, weeks: 0.5, priority: 'low',    status: 'open',   title: 'H.9 — Opus design-reviewer: post-save soft warnings ("slip count inconsistent with packer rating", "OD exceeds casing drift"); badge in workbench' },
    { id: 310, bundle: 'H', lane: 7, start:  9.5, weeks: 1.0, priority: 'medium', status: 'open',   title: 'H.10 — Vendor-PDF-to-DesignSpace: Opus reads a vendor catalog page (image) and emits a DesignSpace + Generator directly — the "do we need CLIP/RAG?" alternative path that keeps Bundle B shelved if it works' },

    // ───── I. 4-level hierarchy + composite generators ─────
    { id: 400, bundle: 'I', lane: 8, start: 10.0, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.0 — /primitives sidebar restructure: 4 hierarchy tabs (Primitives / Compositions / Components / Assemblies) + KB tab; tab-strip-on-left, in-tab Threlte canvas + scene controls' },
    { id: 401, bundle: 'I', lane: 8, start: 10.4, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.1 — Variation generator in library.ts: ComponentDef.parent + deriveVariation(spec) + buildPrimitiveManifold parent-chain fallback. SC/LC/BC box+pin variants generated from one spec table' },
    { id: 402, bundle: 'I', lane: 8, start: 10.7, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.2 — Tubing rules file (src/lib/components/rules/tubing.ts): TubingInputs → resolveTubing (KB lookup + formula fallback) → buildTubingSpec → AuthoredComponent. Box on top, pin on bottom convention encoded' },
    { id: 403, bundle: 'I', lane: 8, start: 11.1, weeks: 0.4, priority: 'high',   status: 'done',   title: 'I.3 — Drill-pipe identification KB (static/kb/api/drill-pipe-identification.json) + drill_pipe_tool_joint primitive (parametric tong-area marking) + rules/drill_pipe.ts mirroring the tubing pipeline' },
    { id: 404, bundle: 'I', lane: 8, start: 11.5, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.4 — KB row → composite preview: optional rowAction prop on KbTableViewer; casing-tubing rows get a ▶ button → generateTubingComponent → opens as composite tab' },
    { id: 405, bundle: 'I', lane: 8, start: 11.8, weeks: 0.3, priority: 'high',   status: 'done',   title: 'I.5 — Catalog-inspired primitives: window_cutout (LatchRite multilateral), whipstock, sliding_sleeve (HS-ICV / MCC-ICV pattern), drill_pipe_tool_joint' },
    { id: 406, bundle: 'I', lane: 8, start: 12.1, weeks: 0.2, priority: 'medium', status: 'todo',   title: 'I.6 — Sample drill-pipe entries in Compositions tab using rules/drill_pipe.ts (5"/4-1/2"/3-1/2" × E75/X95/G105/S135)' },
    { id: 407, bundle: 'I', lane: 8, start: 12.3, weeks: 0.2, priority: 'medium', status: 'todo',   title: 'I.7 — Drill-pipe KB row action: ▶ on each marking row → generateDrillPipeComponent → composite tab' },
    { id: 408, bundle: 'I', lane: 8, start: 12.5, weeks: 0.5, priority: 'medium', status: 'open',   title: 'I.8 — Bottom-Sub + Ratch-Latch in-tab port: write buildUnifiedManifold(flatParams) wrappers in each tool dir; register as ComponentDef so they open in /primitives instead of bouncing to /archive/tools/*' },
    { id: 409, bundle: 'I', lane: 8, start: 13.0, weeks: 0.4, priority: 'medium', status: 'open',   title: 'I.9 — Auto-list every KB tubing/casing row as a generated composition under "Standard API tubing/casing"; one entry per (size, weight, grade) row' },
    { id: 410, bundle: 'I', lane: 8, start: 13.4, weeks: 0.7, priority: 'medium', status: 'open',   title: 'I.10 — Multilateral catalog extractor: 633400581 PDF → static/kb/api/multilateral-junctions.json; auto-listed as 3rd KB tab entry' },
    { id: 411, bundle: 'I', lane: 8, start: 14.1, weeks: 0.5, priority: 'low',    status: 'open',   title: 'I.11 — Editable Composition tabs: Params popup on a tubing/drill-pipe composite shows the input fields (size, weight, grade, length); editing rebuilds the spec via the rules → live geometry' },
    { id: 412, bundle: 'I', lane: 8, start: 14.6, weeks: 0.5, priority: 'low',    status: 'open',   title: 'I.12 — Decompose remaining compositions (thread_if/thread_fh/thread_nc) from custom builders into AuthoredComponent specs (body + drill_pipe_tool_joint with the right marking)' },
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
