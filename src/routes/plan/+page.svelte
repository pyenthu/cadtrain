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
  ];

  const tasks: Task[] = [
    { id: 512, bundle: 'A', lane: 0, start: 0.0, weeks: 0.12, priority: 'high',   status: 'todo',   title: 'AI refine Level 2: post-generation validation in the refine endpoint (imports allowlist · denylist scan · undefined-instance detection · syntax check · optional live-bake · retry-once-with-errors-fed-back). PARTIAL: validateRefinedSource() + retry-once loop already exist in refine/+server.ts, but only check meta-extract / meta.id-unchanged / fn-name==id. LEFT: imports allowlist, denylist scan, undefined-instance detection, live-bake.' },
    { id: 700, bundle: 'C', lane: 2, start: 0.0, weeks: 0.15, priority: 'high',   status: 'open',   title: 'OAuth identity port from SVTC: Google OAuth + signed-session → event.locals.userId via sequence() in hooks (existing AUTH_TOKEN/proxy/rate-limit unchanged). Plan ready: docs/plans/oauth-identity.md. Blocked on user-provisioned Google OAuth creds.' },
    { id: 513, bundle: 'A', lane: 0, start: 0.01, weeks: 0.12, priority: 'high',   status: 'todo',   title: 'AI refine Level 3: live-bake gate on the inspector Accept button — status pill ("✓ Builds" green / "✗ Bake failed: <msg>" red); Accept disabled on failure. Uses the existing /api/components/bake-preview endpoint, no backend changes' },
    { id: 514, bundle: 'A', lane: 0, start: 0.01, weeks: 0.12, priority: 'medium', status: 'todo',   title: 'AI refine Level 4: assembly-aware prompt — when refining a composition, glob docs/assemblies/README.md + matching <assembly>.md into the system prompt. Today nothing in src/ reads docs/assemblies/ so the AI re-invents known recipes every refine' },
    { id: 702, bundle: 'C', lane: 2, start: 0.02, weeks: 0.15, priority: 'high',   status: 'open',   title: 'Private per-user parts under components/<userId>/ (REQUIRES L.1): user-scoped resolvers + owner enforcement; close R2 (/api/volume path guard), R3 (private out of proxy), R4 (list-cache by userId), R5 (id-collision scoped).' },
    { id: 668, bundle: 'A', lane: 0, start: 0.04, weeks: 0.18, priority: 'high',   status: 'done',   title: 'Generative authoring (vocabulary → translator → multi-tier cached generation with WebGPU local LLM, supervised) (added 2026-06-05). User-driven pivot away from hand-authored parts and ad-hoc rewrites — every dp_* this session was either hand-written or imported from a legacy backup, none were GENERATED from a description, and that doesn\'t scale. THE VOCABULARY: a compositional grammar of part terms — shaft = cylindrical profile; tube = larger shaft .subtract( smaller shaft ); collar = revolve profile with locally-larger OD; pin = shaft + tapered nose; box = tube + counterbore (female complement of pin); joint = ordered composition of pin+body+box via tail() datum; stand = N joints stacked. Each entry has a definition, synonyms (RAG aliases), a structured rule (in the K.62 IR shape — imports + composition tree + param mapping), an exemplar part id, and expected bake metrics. THE TRANSLATOR (`src/lib/authoring/rule-translator.ts`): pure deterministic function `Rule → AsmSource` that compiles a vocabulary rule (or any rule conforming to the schema) into a runnable `.asm.ts` / `.rev.ts` via the existing `composition-tree.ts` data layer (applyToSource + addAssemblyParam + the K.62 emit pipeline). NO LLM IN THE TRANSLATOR — it\'s pure compile. THE FIVE-TIER CACHE (descending cost): L1 vocabulary term/synonym lookup (0 tokens, 0ms, client-side JSON match) → L2 cached generations vector lookup against IndexedDB authoring_cache + the existing $APP_DATA_DIR/ai/training_data pattern (0 tokens, ~50ms embed match) → L3 translator-from-rule (0 tokens, ~5ms deterministic compile when a vocab rule matched) → L4 WebGPU LLM emits a RULE conforming to the vocabulary schema (NOT raw source) and the translator compiles it (0 tokens, ~1-5s in-browser, structured-output mode for constrained generation) → L5 Claude API `/api/author` server fallback when WebGPU low-confidence or unavailable (token-cost, ~1s, highest quality). The translator is the SAME for all five tiers — rule comes from different sources but compiles the same way. CRITICAL INSIGHT: constrained generation (LLM emits structured RULE matching the schema, not raw `.asm.ts`) is dramatically smaller output + validatable + the deterministic translator handles correctness — far better than asking the LLM to emit runnable source. SUPERVISION PANEL (Phase 5 — equally critical, not afterthought): meaningful + fast human-in-the-loop oversight on every generation. Side-by-side: description input + generated rule JSON + live 3D bake preview + cited exemplars + trust signal badge ("L1 vocab hit · pin" / "L4 WebGPU · 87% confidence · 2 exemplars"). Keyboard-bound Accept (Y — caches to L2) / Reject (N — logs failure mode + opens refine) / Refine (R — edit rule fields in place, re-translate, see diff). Diff view between generations: which rule fields changed + bake-metric delta (verts, z-extent, etc.). Always reversible. The supervision panel makes generative authoring trustable + scalable — without it, the whole stack is a black-box source dumper users can\'t validate at speed. SVTC chatbot integration via the same panel: chat suggests, supervisor approves. SIX-PHASE ROLLOUT: Phase 1 (3 days) — vocabulary.json + vocabulary.md + synonym map (docs/parts/), with the dp_test pipeline parts (shaft/tube/collar/pin/box/joint/stand) as the first rule set. Phase 2 (3 days) — rule-translator.ts + regenerate every dt_* part from its vocab entry as the validation contract (translator passes iff bake metrics match the manual baseline). Phase 3 (2 days) — client-author.ts orchestrator with L1+L2+L3 wired (IndexedDB / training-data cache for L2). Phase 4 (4 days) — WebGPU LLM integration: model selection (Mistral-7B-Instruct via web-llm, Llama-3-8B-Instruct, or a domain-tuned small model), structured-output constrained decoding for the rule schema, prompt engineering with vocab + retrieved exemplars as context. Skipped gracefully when WebGPU unavailable (falls to L5). Phase 5 (3 days) — supervision panel UI inside CompositionEditor; side-by-side preview; diff view; keyboard shortcuts; trust signals. Phase 6 (2 days) — /api/author server (Claude) as L5 fallback + the SVTC-style chatbot panel binding. WIN: a "drill pipe pin, 4 1/2" OD, NC50 thread" description hits L1 (vocab match on "pin") → translator generates source from the pin rule → user supervises (≤1s of input) → cached for next time. Repeat description = 0 tokens, 50ms total. Novel description = WebGPU 1-5s offline → cached. Token-expensive Claude calls only for hard cases. REPLACES the hand-rewrite anti-pattern observed during the dp_test session (every non-curated profile triggered an ad-hoc `/tmp/dt_*_swap.ts` script — the right architecture pushes that into the vocabulary + lets the system absorb new rules over time).' },
    { id: 804, bundle: 'B', lane: 1, start: 0.06, weeks: 0.18, priority: 'medium', status: 'todo', title: 'Pro polish (own session each). Snapping + grid; dimensions / light geometric constraints (revisit JSketcher only if dimension-driven constraints become a real need); DXF export (Maker.js native — real CAD handoff); 2D-CSG via model.combine (folds in the old K.58 SVG-CSG idea); mirror/symmetry.' },
    { id: 655, bundle: 'B', lane: 1, start: 0.13, weeks: 0.17, priority: 'high',   status: 'done',   title: 'Sweep-along-path (3D path sweep, an extrude variant for non-linear axes). Today r_weld_extrude sweeps a 2D cross-section LINEARLY down z (straight prism, optional twist + taper). The natural generalization: sweep the SAME cross-section along an arbitrary 3D PATH — bends, helices, curved tubes, spline-driven sweeps, pipe runs that follow a hand-drawn 3D trajectory. Manifold-3d does not provide this natively (CrossSection.extrude is linear-only); the implementation is the hand-wound rail-weld path with ring positions placed along the path tangent + per-station local frame (Frenet or RMF — rotation-minimizing frame to avoid twist artifacts on turns). NEW stdlib `r_sweep` takes (profile, path_pts, optional twistFn(s), optional scaleFn(s)). The path is a 3D polyline OR a function s → [x, y, z] sampled at N stations. Each station gets a local frame; the cross-section is laid flat in that frame and the sides are stitched (gridPatch + capFan + weldAndBuild). Demos: U-bend pipe (path is two straights + a quarter-arc), helical coil (path = (cos(t), sin(t), t·pitch)), gooseneck cable run (Bezier 3D path), drill-pipe stand with a tapered bend at the joint. Pairs with the existing sweep/weld bench numbers: native r_weld_extrude does linear in ~1 ms; r_sweep on the same N×M grid should land in the 1.5–2× range (similar to W-twist vs CS-twist) because each station has the same per-vertex math just placed differently. Two builders that emerge: SweepPart (open path with end caps) + SweepLoop (closed path = torus-like). New file type: `<id>.swp.ts` mid-extension, dispatches a SweepPartBuilder (path editor + cross-section editor + 3D preview). Big future win: this enables anything that does not fit a straight extrude/revolve — gooseneck flow lines, coiled tubing, casing strings that follow a wellbore curve. Order it AFTER the K.55-precursor tab dispatch lands (Extrude/Profile/Assembly are simple cases first); then K.55 adds the path-sweep type alongside.' },
    { id: 901, bundle: 'D', lane: 3, start: 0.15, weeks: 0.15, priority: 'medium', status: 'open', title: 'V1.0 read-only API: /api/v1/* facade thin-wrapping the existing handlers (list parts / get part metadata+geometry / bake preview → mesh-JSON·GLB·SVG / query the RAG corpus). No geometry logic duplicated. Versioned resource model + structured errors. Lowest risk (reuses shipped endpoints).' },
    { id: 644, bundle: 'B', lane: 1, start: 0.16, weeks: 0.13, priority: 'medium', status: 'done',   title: 'D Phase 2 (DEFERRED): repeat_with_data(array, fn) for HETEROGENEOUS instances — BHA with mixed HWDP/drill pipe/stabilizers, per-iteration params from a data array. Sandbox = native data.map (no helper needed); recognizer extension to spot const items = data.map((d,i) => mv(<inst>(...d), [...])); return place(items). Build when a concrete varied use case lands.' },
    { id: 902, bundle: 'D', lane: 3, start: 0.17, weeks: 0.16, priority: 'high', status: 'open', title: 'V1.1 auth: per-app bearer-key registry (ctk_v1_ token, stored as sha256(bearer) hash + metadata at <volume>/apps/_tokens/<id>.json — Rule 15, never plaintext; 60s cache; scopes read⊂bake⊂author⊂admin; CADTRAIN_ADMIN_KEY bootstrap), gated via a new apiKeyHandle composed with sequence(). Orthogonal to the per-USER OAuth (bundle L) — both reuse one owner-scoped subtree resolver.' },
    { id: 903, bundle: 'D', lane: 3, start: 0.18, weeks: 0.18, priority: 'medium', status: 'open', title: 'V1.2 author/execute + per-app namespace: app-scoped writes under apps/<appId>/primitives/... resolved by the SAME primitive-paths.ts (parameterized root, kept out of VOLUME_PROXY_PATHS). Highest risk — the write surface + the R2–R4 holes from the customize-dir plan. IP protection: per-part meta.visibility:baked-only serves geometry+metadata but withholds source/graph (bridges to the WASM-conceal idea).' },
    { id: 904, bundle: 'D', lane: 3, start: 0.20, weeks: 0.16, priority: 'medium', status: 'open', title: 'V1.3 LLM manifest + MCP: /api/v1/manifest (evolve /api/manifest) + /sdk/llms.txt + tool-call JSON schemas per operation + an MCP server (adopt SVTC\'s) so an agent can discover + drive cadtrain. Worked examples (author from description → bake → fetch GLB/SVG). V1.4 (later): embeddable canvas (iframe-postMessage or published web-component).' },
    { id: 954, bundle: 'E', lane: 4, start: 0.0,  weeks: 0.06, priority: 'high',   status: 'open', title: 'W-E · Left vertical TOOLBAR rail — fill WellToolbar with real actions: new/open/save .wson, add completion/casing/perf, toggle 2D/3D, export (PNG/GLB/SVG), fit-view. The persistent icon rail on the left of the /wells workspace.' },
    { id: 953, bundle: 'E', lane: 4, start: 0.06, weeks: 0.14, priority: 'high',   status: 'done', title: 'W-D · 2D SVG track view = DEFAULT (the ewells-speed match). Opening a tab now renders an INSTANT 2D SVG schematic (white bg, labella labels) and does ZERO Manifold/CSG; 3D lazy-mounts only on the 2D|3D toggle. Ported SVTC wsonRender.js → pure src/lib/wells/wson-2d.ts (depthToY shared with the 3D depth scale, radiusToX with diaScale; casing/tubing/oh/ch rects, cement hatch, perf arrows, buildDirPath deviation, leader labels) + WellSchematic2D.svelte inline <svg>, same layer+scale state as 3D, back-face-culled. SHIPPED 2026-07-04 (7b4b322).' },
    { id: 950, bundle: 'E', lane: 4, start: 0.20, weeks: 0.08, priority: 'high',   status: 'done', title: 'W-A · View + layer control bar — surfaces WellSchematic3D props (layer toggles oh/ch/cement/tubing/completions/perfs · cutaway · directional · diaScale/zScale/DTX · cut azimuth · camera presets) as a SceneControls-style toolbar over the canvas. Drives BOTH 3D + 2D. SHIPPED 2026-07-04.' },
    { id: 951, bundle: 'E', lane: 4, start: 0.30, weeks: 0.12, priority: 'high',   status: 'open', title: 'W-B1 · Editing — mutation + undo layer (viewer→editor foundation, deep-dive #1, THE differentiator over ewells\' viewer-only schematic). One commit() choke point that mutates the open .wson (add/remove/edit strings·surveys·completions) + a per-workspace undo/redo history; SSR-safe, feeds the 3D re-bake + 2D re-render. Prereq for CompletionsEditor / SurveyEditor / inspector. Plan docs/plans/wells-ewells-gaps.md §B.' },
    { id: 952, bundle: 'E', lane: 4, start: 0.42, weeks: 0.10, priority: 'medium', status: 'done', title: 'W-C · On-diagram annotations + depth ruler — MD depth axis + collapsible SVTC-style detail header + labella force-labels for components/perfs (side-rail label column) SHIPPED 2026-07-04. LEFT (polish, tracked #42b-C): annotation anchor-option (diagram vs depth-rail) + DTX-remapped TVD ruler.' },
    { id: 955, bundle: 'E', lane: 4, start: 0.0,  weeks: 0.05, priority: 'high',   status: 'done', title: 'W-F · Workspace CACHE — persists + restores the /wells workspace across visits (no re-picking the folder). Last-opened FileSystemDirectoryHandle in IndexedDB (handles are structured-clone-able, NOT localStorage) + re-request permission via a "Reopen <folder>" affordance on load; open .wson tab list + active index in localStorage; hydrates files once permission is regranted. SSR-safe, degrades to empty workspace. SHIPPED 2026-07-04.' },
    { id: 956, bundle: 'E', lane: 4, start: 0.05, weeks: 0.05, priority: 'high',   status: 'done', title: 'W-G · Workspace shell polish — (a) COLLAPSIBLE SVTC-style detail header (well name/description, type, TD, PBTD, csg/comp/perf/svy counts); (b) reduced canvas padding (.wv-stage fills the stage); (c) 2D SVG canvas on a WHITE background. SHIPPED 2026-07-04.' },
    { id: 957, bundle: 'E', lane: 4, start: 0.30, weeks: 0.15, priority: 'high',   status: 'open', title: 'W-H1 · 3D-fast build — WellBakePool. When 3D is opened, move the per-element Manifold build off the main thread into a POOL of N Web-Workers each owning its OWN Manifold instance (NOT the /primitives editor\'s single latest-wins worker — wells needs all elements built in parallel + cached, rendered progressively). Reuses the bake-worker/bake-client pipeline (client_side_execution). Kills the main-thread CSG jank that makes /wells slow vs ewells\' 2D SVG. Plan docs/plans/wells-build-architecture.md (P1–P3).' },
    { id: 958, bundle: 'E', lane: 4, start: 0.45, weeks: 0.10, priority: 'high',   status: 'open', title: 'W-H2 · 3D-fast — clip-plane cutaway (drop the boolean). The half-section cutaway is currently a per-element Manifold .cut() boolean that scales super-linearly (stack_cutaway_perf_root_cause). Replace with a GPU clip plane (THREE material clippingPlanes + stencil caps) so the cutaway is free at render time and does NOT re-trigger a CSG rebuild on azimuth/toggle. Plan docs/plans/wells-build-architecture.md.' },
    { id: 959, bundle: 'E', lane: 4, start: 0.55, weeks: 0.18, priority: 'medium', status: 'open', title: 'W-H3 · Parametric element libraries — the well elements (OH / casing / tubing / cement / perf) become PARAMETRIC LIBRARY parts the engine CALLS (procedural), and completions = the g_* jewelry via compile+worker; register g_* into the parametric registry with ParamSpec dials (feeds W-B4 inspector). Auto-scale/fit. Plan docs/plans/wells-build-architecture.md §A2 + wells-ewells-gaps.md §A2.' },
    { id: 960, bundle: 'E', lane: 4, start: 0.42, weeks: 0.12, priority: 'high',   status: 'open', title: 'W-B2 · CompletionsEditor — SVTC-style strings table editor (oh/ch/cement/tubing/completions rows: add/remove/reorder, edit OD/ID/top/bottom) writing through the W-B1 mutation layer, live 3D re-bake + 2D re-render.' },
    { id: 961, bundle: 'E', lane: 4, start: 0.54, weeks: 0.12, priority: 'high',   status: 'open', title: 'W-B3 · SurveyEditor — md/dev/az survey-station table (add/edit/delete stations) with live re-warp of the 3D deviation + 2D buildDirPath. Through the W-B1 mutation layer. SVTC SurveyEditor.' },
    { id: 962, bundle: 'E', lane: 4, start: 0.66, weeks: 0.10, priority: 'medium', status: 'open', title: 'W-B4 · Inspector-on-select — click a component in the 2D/3D schematic → inspector panel wired to the parametric registry (tool_comp → its ParamSpec dials); edits flow through the W-B1 mutation layer. Depends on W-H3 element registry.' },
    { id: 906, bundle: 'A', lane: 0, start: 0.36, weeks: 0.20, priority: 'medium', status: 'open', title: "Local web-llm backend (no data leaves org): web-llm (MLC) + XGrammar constrained decoding, Qwen2.5-1.5B in a Web Worker, default-OFF, gated by a bench (>=90% tool / >=85% args); local TF-IDF few-shot DB in IndexedDB. Reference Functionary's prompt format but do NOT deploy it (server-side vLLM, not WebGPU). Plan: docs/research/web-llm-functionary.md." },
    { id: 923, bundle: 'B', lane: 1, start: 0.75, weeks: 0.40, priority: 'medium', status: 'done', title: "Expression-as-builder — structured + list expression outputs that unify the 3 repeats (idea 2026-06-26, from the spiral exploration). **IMPERATIVE LOOP BUILDER + CodeMirror SHIPPED 2026-06-28 (pushed 4808497):** list<point> outputs are now BUILT/EDITED as a visual imperative accumulator program (poly = []; for i = 0 to N { rx = …; rz = …; poly.append([rx, rz]) }; return poly) — src/lib/cad/expr-imperative.ts (parse/serialize/compile→a JS for-loop; bracket-depth statement split so wrapped/temp-var bodies parse as one; validateImperative w/ real error reasons) + ExprImperativeBlocks.svelte (◇ poly accumulator · structured for-headers w/ count dropdown · ONE resizable autocomplete body text field per loop · top '+ add ▾' = variable/expression/loop · top-level vars) + ExprCodeEditor.svelte (CodeMirror 6, lazy-loaded — DSL highlight + bracket match + autocomplete + line-wrap). Emit branches on isImperative→compileImperative (bakes IDENTICAL: spiral 2888 / functional 8628 verts). UX: output tabs promoted into the popover TITLE row; Enter=newline (data-enter-newline opts the body out of GraphEditorPane's window Enter→re-bake) + a ✓ update tick per loop (dirty-glow + commit-on-blur Save flush); functional map/concat auto-CONVERTS to imperative on open; ExprLoopBlocks.svelte deleted; g_spiral_expr_sketch re-saved on the volume in the readable R/a/rx/rz form. Plan: docs/plans/loop-builder.md. LEFT (the actual unify payoff): wire list<op>→sketch + list<transform>→repeat to retire the 3 repeat types; lacing; the visual '+' compose operator. Today expr OUTPUTS are scalars. Enhance so an output carries a scalar | object | LIST, with a map(range(N), i => …) loop inside, and the typed output SOCKET wires the structured value into any consumer: list of [r,z] → polygon points (= poly_repeat), list of ops → sketch ops (= sketch_repeat), list of transforms → place/repeat (= part-repeat). ONE generic generator subsumes all three repeat node types — the spiral collapses to ONE expression with a map. The engine (mathjs) already supports arrays/objects/map/range, so the work is MODEL (a `shape` field on outputs + non-scalar validation), a loop UI affordance, TYPED output sockets + wiring rules (list→list-slot, object→object-slot), and emit-splice into the consumer's array slot — NOT a new evaluator. Substrate for a 'builder' app (wire points/ops/transforms/parts between typed expr outputs) and data-driven parts (a list output sourced from a param table / CSV / the RAG layer → heterogeneous repeats fall out free). Research prior art FIRST (deep-research pass): Grasshopper data-trees + list-lacing (the reference design + its tree-matching pain), Dynamo list-lacing rules, Blender Geometry Nodes/Sverchok fields, OpenSCAD list comprehensions, CadQuery eachpoint, Houdini copy-to-points. Open Qs: type-system depth (scalar|object|list vs richer records), loop-in-formula vs structured for-each block, perf of a 720-pt mathjs map vs the emitted Array.from. Pairs with the repeat-as-sweep / loft-between-copies idea (clean continuous swept solids, see g_spiral_repeat.md). Plan: docs/plans/expression-list-builder.md (now grounded by a 104-agent deep-research pass: start FLAT list<element>, longest-repeat-last lacing, socket-shape typing, NO data trees, avoid Grasshopper graft/flatten). DATA-MODEL step IN FLIGHT 2026-06-26 (subagent): shape+elem on outputs, map()-list validation, list<point>→polygon points, spiral-as-one-expression bake proof. Three spiral demonstrators (g_spiral / g_spiral_sketch / g_spiral_repeat in basic/spirals/) motivate it." },
    { id: 924, bundle: 'B', lane: 1, start: 0.76, weeks: 0.25, priority: 'medium', status: 'done', title: "Repeat-as-sweep — loft a continuous welded skin BETWEEN consecutive repeat copies (geometry; idea 2026-06-26, from the spiral exploration). The part-level repeat today place()s N DISCRETE copies (g_spiral_repeat = ~26k verts of overlapping box-posts, bumpy). A 'sweep' mode lofts ONE welded skin between copy i and i+1 along the per-iteration transforms → a swept solid: springs, threads, helical ramps, clean spiral ribbons (~g_spiral's 8.6k verts). Welded-mesh path (manifold-mesh.ts gridPatch/capFan/weldAndBuild — like r_weld_extrude but along a path, not straight z). PROTOTYPE IN FLIGHT 2026-06-26 (subagent): a sweepAlongPath/loftStations helper + spiral bake proof + design writeup. Open problems: per-station frame torsion/flips, variable-radius spacing, self-intersection at tight inner turns, end caps, volume-sign check. Pairs with #11 (expression list outputs). See docs/parts/g_spiral_repeat.md." },
    { id: 926, bundle: 'B', lane: 1, start: 0.79, weeks: 0.18, priority: 'medium', status: 'done', title: "Typed expression outputs — structural inference + dynamic wiring (the design spine, refined live 2026-06-29..07-01). Phase A SHIPPED on main: struct-type.ts inferStructure/structLabel + an 'auto' output shape + live inferred-type badge; array literals like [[x,y,z],…] are accepted (killed 'unsupported syntax: ArrayNode') and inferred as list<point2/3/N> at any arity; scalar/list paths byte-identical. Model: type inferred from structure by DEFAULT (users never declare), explicit annotation optional (gradual typing, a contract checked vs inference), named types optional. Phase B (typed/colored sockets + plain-language wire-checking — refuses 2D-into-path) + Phase D (Type-Definer: first-class list types, the 'add a field' name-required bug, field-type dropdown) DONE on agent branches, pending review/merge. LEFT: C explicit annotation · E consumers (r_sweep.path / r_surface_grid) + ObjectNode emit + record→array adapter. Plan: docs/plans/typed-expression-outputs.md. Subsumes the wire-it half of #923/#13." },
    { id: 932, bundle: 'B', lane: 1, start: 0.89, weeks: 0.25, priority: 'medium', status: 'done', title: "Parametric geometry slots — spline/expr/profile as an OVERRIDABLE typed param (design 2026-07-02). A part exposes its internal geometry (path spline, section expr/profile) as a typed param with a DEFAULT; the caller overrides by passing/wiring a compatible value (e.g. s_tube wires one shared path into two sweep instances while keeping rad parametrized). Typed-param-with-default, NOT class inheritance. The PART-LEVEL generalization of wire-into-spline (#26). Plan docs/plans/parametric-geometry-slots.md." },
    { id: 934, bundle: 'B', lane: 1, start: 0.90, weeks: 0.20, priority: 'high', status: 'done', title: "BREP client-side (OCCT/replicad WASM in-browser) + a client/server toggle like Manifold's ⚡/☁. replicad=opencascade.js runs in the browser; move the BREP bake into a lazy-WASM Web Worker; keep the /api/brep/preview server path as the toggle's other half. Plan docs/plans/brep-client-side.md." },
    { id: 935, bundle: 'B', lane: 1, start: 0.91, weeks: 0.20, priority: 'medium', status: 'done', title: "BREP display-mesh quality: (a) color parts (respect colorOuter/Inner + #86 subpart colors — BREP renders monochrome today); (b) smooth normals (crease-aware on the OCCT tessellation, like the Manifold fix); (c) the ~1.8e9 bogus tri/vert count + non-watertight display mesh — brep-occt.ts:160-162 Array.from over raw emscripten heap VIEWS inflates counts; fix = slice to OCCT's reported node/tri counts, then position-weld + Manifold.merge for watertightness (per the 2026-07-02 cleanup spike)." },
    { id: 936, bundle: 'B', lane: 1, start: 0.92, weeks: 0.20, priority: 'medium', status: 'done', title: "Warp a part along a spline — a bend/deform modifier node reusing warp-spline.ts (warpManifoldAlongSpline). GEOMETRY CORE SHIPPED 2026-07-02 (merge c12873f): 3D RMF path frames + right-handed-frame fix (was inverting volume on a left-handed frame) + build-time validity warning, all in warp-spline.ts. LEFT (deferred pending the GEP modularization reorg #940): the user-facing warp NODE + editor card — a large GraphEditorPane subsystem (items 1 & 5 of the plan). Plan docs/plans/warp-part-along-spline.md." },
    { id: 939, bundle: 'B', lane: 1, start: 0.93, weeks: 0.30, priority: 'high', status: 'done', title: "MULTI-ENGINE matrix — Manifold (client✓/server✓) · BREP/replicad (server✓, client TODO) · TrueForm/tf (tab✓ demo-box only, per-part + toggle TODO), each a right-pane tab with a client/server toggle. Vision from 2026-07-02. Sub-work: 931 (tf tab ✓ SHIPPED — from-scratch box + COOP/COEP cross-origin isolation), 934 (BREP client), 935 (BREP quality)." },
    { id: 940, bundle: 'B', lane: 1, start: 0.95, weeks: 0.30, priority: 'high', status: 'active', title: "GraphEditorPane modularization reorg (round 3 / R6-continuation) — THE CURRENT FOCUS (2026-07-02). GEP has drifted back to ~5,328 lines and must be reduced toward a ~1,500-line composing shell (the honest 2026-06-25 target from #907 was ~2,500–3,000; this reorg re-pushes past it). An audit was just completed; the next cut is the layout-actions extraction, following the R6/R2–R10 sequence in docs/plans/graph-editor-pane.md + docs/plans/modularize-round2.md. Unblocks the deferred warp NODE + editor card (#936, items 1 & 5). Prior modularization: #665 (round 1), #907 (round 2, GEP 9455→5070)." },
    { id: 942, bundle: 'B', lane: 1, start: 0.97, weeks: 0.30, priority: 'high', status: 'done', title: "TF tab hardened into a real engine surface (2026-07-06, 8+ worktree agents): runs in a Web Worker (tf-worker*.ts) · NATIVE-ONLY (no Manifold fallback → blank+reason) · double-build fix · per-part MATERIAL on full + cut cross-section views · r_weld_extrude native builder (g_cube/star/spiral/barrel) · cutaway toggle = view-switch (returns full+cutVC, no blank) · ONLY-ACTIVE-PANE bake (the /primitives multi-tab blank-on-open = all N panes baking through one shared TF worker → global supersede cancelled all but one) · compile caches (/api/tf/compile 302→1ms + resolveDepColors 940→0.1ms) · 🔄 true fresh bake · honest step-breakdown badge. PLUS Route C lean revolve: g_shaft zSegments 10→0 on the VOLUME (backup .route-c-backup/); warp re-densifies at build time via the _axialMaxZSpan dial (span 1.5) in bake-worker-core.ts + preview/+server.ts — straight 528→96 tris (5.5×), warped 8448→2640 smooth (3.2×), Rule-25 clean. See memory session_handoff_2026-07-06." },
    { id: 943, bundle: 'B', lane: 1, start: 0.98, weeks: 0.20, priority: 'medium', status: 'open', title: "TF / revolve follow-ups (from the 2026-07-06 batch): (a) curvature-adaptive warp axial span (constant 1.5 → planAxialStations) so long/gently-curved wells aren't over-tessellated — docs/plans/manifold-revolve-lean.md; (b) parallelize the /api/tf/compile BFS dep frontier + invalidate the dep-source caches on part Save (instant cross-part instead of 30-60s TTL) — docs/plans/tf-compile-perf.md; (c) TF_WASM tab (C++→WASM builders for concealment; the WORKER is what makes it fast, not the language) — docs/plans/tf-wasm-tab.md; (d) per-SUBPART material (a material on a hidden sub-part) needs color-by-source; (e) TF cut interior grey is metallic — matte section would be a small material-group follow-up." },
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
