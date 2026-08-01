{
  "app": "plan",
  "title": "CAD Train — Roadmap",
  "docType": "roadmap",
  "doc": "# CAD Train — Roadmap (plan.app)\n\nA roadmap timeline that replicates the /plan Gantt on the .app harness. Bundles A–E of work are laid out on a sequence-week axis; task bars are coloured by status (open/active/done/todo) and grouped into lane swimlanes. A task table below the timeline lists the same rows.\n\n## Data\nThe roadmap lives in the app variable `tasks` — a list<record> shaped by `structures.task` (id, label, lane, start, end, status, details). The Gantt reads `tasks` directly (dataMode static); the task table sources it through the `readVar` data verb (dataMode server → server-preloaded at first paint).\n\n## Recreate from prompts\nThis app is reproducible by replaying `plan.app.prompts.md` through the harness AI builder (/api/app/generate); each prompt is one increment and is logged to the shared corpus (ai/app-rag/builds.jsonl).",
  "theme": {
    "mode": "light",
    "accent": "#0369a1"
  },
  "structures": {
    "task": [
      {
        "name": "id",
        "type": "number"
      },
      {
        "name": "label",
        "type": "string"
      },
      {
        "name": "lane",
        "type": "string"
      },
      {
        "name": "start",
        "type": "number"
      },
      {
        "name": "end",
        "type": "number"
      },
      {
        "name": "status",
        "type": "string"
      },
      {
        "name": "details",
        "type": "string"
      }
    ]
  },
  "vars": {
    "tasks": [
      {
        "id": 512,
        "label": "AI refine L2 — post-generation validation",
        "lane": "A · /components",
        "start": 0,
        "end": 0.12,
        "status": "open",
        "details": "Imports allowlist + denylist scan + undefined-instance detection + optional live-bake in the refine endpoint; retry once with errors fed back."
      },
      {
        "id": 513,
        "label": "AI refine L3 — live-bake gate on Accept",
        "lane": "A · /components",
        "start": 0.01,
        "end": 0.13,
        "status": "todo",
        "details": "A bake-preview status pill next to the inspector Accept button; disable Accept when the proposal fails to bake."
      },
      {
        "id": 514,
        "label": "AI refine L4 — assembly-aware prompt",
        "lane": "A · /components",
        "start": 0.01,
        "end": 0.13,
        "status": "todo",
        "details": "Glob docs/assemblies/*.md into the refine system prompt so the AI respects known recipes instead of re-inventing them."
      },
      {
        "id": 906,
        "label": "Local web-llm backend (no data leaves org)",
        "lane": "A · /components",
        "start": 0.36,
        "end": 0.56,
        "status": "open",
        "details": "web-llm (MLC) + XGrammar constrained decoding, Qwen2.5-1.5B in a Web Worker, default-OFF, gated by a bench."
      },
      {
        "id": 700,
        "label": "Google OAuth identity port from SVTC",
        "lane": "C · Identity",
        "start": 0,
        "end": 0.15,
        "status": "open",
        "details": "Google OAuth + signed-session → event.locals.userId via sequence() in hooks. Blocked on user-provisioned OAuth creds."
      },
      {
        "id": 702,
        "label": "Private per-user parts under components/<userId>/",
        "lane": "C · Identity",
        "start": 0.02,
        "end": 0.17,
        "status": "open",
        "details": "User-scoped resolvers + owner enforcement; closes the R2–R5 path-guard / list-cache holes. Requires the OAuth layer."
      },
      {
        "id": 901,
        "label": "V1.0 read-only /api/v1 facade",
        "lane": "D · SDK",
        "start": 0.15,
        "end": 0.3,
        "status": "open",
        "details": "Thin-wrap the shipped handlers: list · metadata+geometry · bake → mesh-JSON/GLB/SVG · RAG query. First consumer = the wellnew /ewell shell."
      },
      {
        "id": 902,
        "label": "V1.1 per-app bearer-key auth",
        "lane": "D · SDK",
        "start": 0.17,
        "end": 0.33,
        "status": "open",
        "details": "ctk_v1_ token stored as sha256 hash + metadata under apps/_tokens/; scopes read⊂bake⊂author⊂admin, via an apiKeyHandle."
      },
      {
        "id": 903,
        "label": "V1.2 author/execute + per-app namespace",
        "lane": "D · SDK",
        "start": 0.18,
        "end": 0.36,
        "status": "open",
        "details": "App-scoped writes under apps/<appId>/primitives/… via the same primitive-paths.ts. Highest risk (the write surface)."
      },
      {
        "id": 904,
        "label": "V1.3 LLM manifest + MCP server",
        "lane": "D · SDK",
        "start": 0.2,
        "end": 0.36,
        "status": "open",
        "details": "/api/v1/manifest + /sdk/llms.txt + per-operation tool schemas + an MCP server so an agent can discover + drive cadtrain."
      },
      {
        "id": 940,
        "label": "GraphEditorPane modularization — Phase 4",
        "lane": "B · /primitives",
        "start": 0.95,
        "end": 1.25,
        "status": "active",
        "details": "Migrate GEP's imperative state/actions onto GraphEditorController toward a ~1,500-line shell. Land inline (subagents stall on GEP)."
      },
      {
        "id": 982,
        "label": "#66 per-part material popover on the node card",
        "lane": "B · /primitives",
        "start": 1.18,
        "end": 1.38,
        "status": "open",
        "details": "A per-part colour/material FloatingPanel on the card instead of a PROPERTIES row per subpart; folds in bind-a-variable-to-a-param."
      },
      {
        "id": 983,
        "label": "#65 API + SDK — apps on the graph engine",
        "lane": "B · /primitives",
        "start": 1.22,
        "end": 1.47,
        "status": "open",
        "details": "The long-term bet: third parties build apps on our graph ENGINE. /wells is the first proof; wellnew is the likely platform host."
      },
      {
        "id": 985,
        "label": "SVG smooth shading — reuse 3D crease normals",
        "lane": "B · /primitives",
        "start": 1.3,
        "end": 1.4,
        "status": "open",
        "details": "Drive the SVG fill/stroke from the same crease-aware vertex normals as the 3D canvas; extend PrimitiveSvgView, do not fork a renderer."
      },
      {
        "id": 988,
        "label": "BREP-native warp — MakePipeShell sweep",
        "lane": "B · /primitives",
        "start": 1.3,
        "end": 1.5,
        "status": "open",
        "details": "Land the proven curved sweep into the bake pipeline: curvature-adaptive spine, stretch, high-torsion RMF parity, warped-solid cutaway."
      },
      {
        "id": 989,
        "label": "TF native r_loft builder",
        "lane": "B · /primitives",
        "start": 1.3,
        "end": 1.42,
        "status": "open",
        "details": "g_barrel blanks on TF (native-only, no MF fallback); add op:'loft' from r_loft's scaleAt(t) + twist and a tfLoft executor."
      },
      {
        "id": 992,
        "label": "graph↔shared layering — erase the import cycle",
        "lane": "B · /primitives",
        "start": 1.3,
        "end": 1.4,
        "status": "open",
        "details": "Move shared/graph-editor/ → graph/editor/ (erases 76/77 domain-import violations), dedup PartAppearance, move profile-presets into graph/."
      },
      {
        "id": 995,
        "label": "Modularized src/lib/graph/ — 39 files → 13 subfolders",
        "lane": "B · /primitives",
        "start": 1.35,
        "end": 1.65,
        "status": "done",
        "details": "Pure git mv + import rewrite across ~180 external importers; per-subfolder CLAUDE.md; build green. Precedes the layering fix."
      },
      {
        "id": 1002,
        "label": "parts_stack node kind — completion string",
        "lane": "B · /primitives",
        "start": 1.72,
        "end": 1.82,
        "status": "done",
        "details": "A heterogeneous completion-string card: each row a DIFFERENT part mated end-to-end via stack([…]) → one geometry. 13 tests."
      },
      {
        "id": 954,
        "label": "W-E · left vertical toolbar rail",
        "lane": "E · /wells",
        "start": 0,
        "end": 0.06,
        "status": "open",
        "details": "Fill WellToolbar with real actions: new/open/save .wson, add completion/casing/perf, 2D/3D toggle, export, fit-view."
      },
      {
        "id": 951,
        "label": "W-B1 · editing — mutation + undo layer",
        "lane": "E · /wells",
        "start": 0.3,
        "end": 0.42,
        "status": "open",
        "details": "One commit() choke point mutating the open .wson + per-workspace undo/redo; feeds the 3D re-bake + 2D re-render. THE differentiator over ewells."
      },
      {
        "id": 957,
        "label": "W-H1 · 3D-fast build — WellBakePool",
        "lane": "E · /wells",
        "start": 0.3,
        "end": 0.45,
        "status": "done",
        "details": "Per-element Manifold build moved into a POOL of N Web-Workers (each its own instance) — streaming, cached, progressive."
      },
      {
        "id": 960,
        "label": "W-B2 · CompletionsEditor",
        "lane": "E · /wells",
        "start": 0.3,
        "end": 0.45,
        "status": "open",
        "details": "SVTC-style strings-table editor (oh/ch/cement/tubing/completions rows) writing through the W-B1 mutation layer; live re-bake."
      },
      {
        "id": 958,
        "label": "W-H2 · clip-plane cutaway (drop the boolean)",
        "lane": "E · /wells",
        "start": 0.45,
        "end": 0.55,
        "status": "open",
        "details": "Replace the per-element Manifold .cut() half-section with a GPU clip plane + stencil caps so azimuth becomes a live, rebake-free slider."
      },
      {
        "id": 961,
        "label": "W-B3 · SurveyEditor",
        "lane": "E · /wells",
        "start": 0.54,
        "end": 0.66,
        "status": "open",
        "details": "md/dev/az survey-station table with live re-warp of the 3D deviation + 2D buildDirPath, through the W-B1 mutation layer."
      },
      {
        "id": 959,
        "label": "W-H3 · parametric element libraries",
        "lane": "E · /wells",
        "start": 0.55,
        "end": 0.73,
        "status": "open",
        "details": "Well elements become parametric library parts the engine CALLS; completions = g_* jewelry via compile+worker; ParamSpec dials feed the inspector."
      },
      {
        "id": 1011,
        "label": "#77 Wells = native GRAPH docs",
        "lane": "E · /wells",
        "start": 1.82,
        "end": 2.02,
        "status": "open",
        "details": "A well IS a graph document (well-part Calls + Mv + warp); the thin WSON converges to the composition-graph JSON. w_well_native proven byte-identical."
      }
    ]
  },
  "panels": [
    {
      "id": "title",
      "kind": "heading",
      "props": {
        "text": "CAD Train — Roadmap",
        "level": 1
      },
      "layout": {
        "w": 12
      }
    },
    {
      "id": "subtitle",
      "kind": "text",
      "props": {
        "text": "Bundles A–E · timeline in sequence-weeks · bars coloured by status — the /plan roadmap, rebuilt on the app harness.",
        "muted": true,
        "size": "sm"
      },
      "layout": {
        "w": 12
      }
    },
    {
      "id": "roadmap",
      "kind": "gantt",
      "props": {
        "title": "Roadmap timeline",
        "rowsVar": "tasks",
        "unit": "wk",
        "tickCount": 6,
        "labelWidth": 300
      },
      "layout": {
        "w": 12
      }
    },
    {
      "id": "tasktable",
      "kind": "grid",
      "title": "Tasks",
      "source": {
        "verb": "readVar",
        "args": {
          "name": "tasks"
        }
      },
      "props": {
        "columns": "id,label,lane,start,end,status"
      },
      "layout": {
        "w": 12
      }
    }
  ]
}
