# plan.app — replayable prompt script

"The prompt is the programming language." `plan.app` (task #34) is reproducible
**from an empty app** by replaying the ordered natural-language prompts below through
the harness AI builder:

```
POST /api/app/generate   { app: <current manifest>, prompt: "<one line below>", provider: "cli" }
```

Each request returns the mutated manifest (the builder dispatches `gui`/`data` verbs
against it) — feed that manifest back as `app` for the next prompt. **Every call appends
one record to the shared corpus** `ai/app-rag/builds.jsonl`
(`/api/app/generate` → `captureBuild` → `appendBuild`), so the whole build history —
prompt + verb trace + panel summary — is captured for the learning loop. Use
`provider: "cli"` (Max subscription) or `"local"` (Ollama) overnight — never the metered
key (`docs/plans/overnight-app-builds.md`).

Start from the empty app: `{ "app": "plan", "panels": [] }`.

Each prompt = one increment. The **verbs** column shows what the builder is expected to
emit (the `gui`/`data` SSOT in `src/lib/appkit/verbs/`), so the script is a faithful,
inspectable program — not just prose.

| # | Prompt | Expected verb(s) | Result |
|---|--------|------------------|--------|
| 1 | `Make this a roadmap app titled "CAD Train — Roadmap".` | `setAppMeta {title:"CAD Train — Roadmap", docType:"roadmap"}` | app title + docType |
| 2 | `Define a task data structure with fields id, label, lane, start, end, status, and details.` | `patchApp {op:"set", path:"structures.task", value:[{name:"id",type:"number"}, …]}` | `structures.task` |
| 3 | `Seed a "tasks" variable with the CAD Train roadmap as a list of task records — bundles A through E of work (components, primitives, identity, SDK, wells) across sequence-weeks, each with id, label, lane, start, end, status, details.` | `patchApp {op:"set", path:"vars.tasks", value:[ …the roadmap rows… ]}` | `vars.tasks` (the seed data) |
| 4 | `Add a level-1 heading titled "CAD Train — Roadmap".` | `definePanel {panel:{id:"title", kind:"heading", props:{text:"CAD Train — Roadmap", level:1}}}` | heading panel |
| 5 | `Add a small muted subtitle under it describing the timeline (bundles A–E, weeks, bars coloured by status).` | `definePanel {panel:{id:"subtitle", kind:"text", props:{text:"…", muted:true, size:"sm"}}}` | text panel |
| 6 | `Add a Gantt timeline titled "Roadmap timeline" that reads the tasks variable, with the axis in weeks.` | `definePanel {panel:{id:"roadmap", kind:"gantt", props:{title:"Roadmap timeline", rowsVar:"tasks", unit:"wk", tickCount:6, labelWidth:300}}}` | gantt panel (reads `vars.tasks`) |
| 7 | `Add a task table below the Gantt that reads the same tasks data and shows id, label, lane, start, end, status.` | `definePanel {panel:{id:"tasktable", kind:"grid", title:"Tasks", source:{verb:"readVar", args:{name:"tasks"}}, props:{columns:"id,label,lane,start,end,status"}}}` | grid panel (server-preloaded via `readVar`) |
| 8 | `Use a light theme with a blue accent.` | `patchApp {op:"set", path:"theme", value:{mode:"light", accent:"#0369a1"}}` | theme |

Replaying prompts 1–8 in order reproduces `plan.app` (this directory).

## Notes

- **Structure → data → components → style** is the incremental order the plan methodology
  prescribes (`docs/plans/overnight-app-builds.md`).
- The **Gantt** component itself (`src/lib/app_components/Gantt/`) is legitimately
  hand-authored engine/component code — it is *not* part of the promptable `.app`
  assembly. What the prompts above build is the `.app` composition: which components, in
  what order, wired to which data. The builder may only COMPOSE registered `PANEL_KINDS`
  (`gantt` is now one) — it never invents a component.
- Prompts 2–3 seed data via the **variable system** (`structures` + `vars`) — the file-
  backed data slot (§0.5) is a later task, deliberately not used here.
- The task table (`grid`, dataMode `server`) sources its rows through the `readVar` data
  verb so they are resolved server-side and baked into the SSR first paint; the Gantt
  (dataMode `static`) reads `vars.tasks` directly. Both read the SAME seeded variable.
- **Golden pair:** promoting `(this script → plan.app)` via `/api/app/promote` writes a
  curated `golden/plan.{md,app}` pair so the next build of a roadmap app is RAG-grounded
  and more deterministic (`docs/plans/overnight-app-builds.md`, step 5).
