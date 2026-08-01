# App-Builder — Atomic Prompt Library

The building blocks a user (or the AI) speaks to build a `.app` **incrementally** — each prompt
does **one small thing** and maps to **1–2 verbs**. This is deliberately the opposite of a
monolithic script ("seed a tasks variable with bundles A–E across sequence-weeks…" — nobody types
that). Small atoms are:

- **replicable** — a real user can type them;
- **local-model friendly** — a weak model reliably emits 1–2 verbs, not a 30-verb blob;
- **robust for the RAG** — each atom is a reusable `(prompt → verbs)` golden that composes, instead
  of one brittle whole-app mapping.

You **compose** atoms to build any app (see the recipe at the end). Verb reference:
`docs/rag/app-builder-dictionary.md`.

---

## 1 · App setup

| Prompt | Verb(s) |
|---|---|
| `Make this a roadmap app called "CAD Train".` | `setAppMeta {title:"CAD Train", docType:"roadmap"}` |
| `Rename it to "Sales Dashboard".` | `setAppMeta {title:"Sales Dashboard"}` |
| `Use a light theme with a blue accent.` | `patchApp {op:"set", path:"theme", value:{mode:"light", accent:"#0369a1"}}` |
| `Switch to dark mode.` | `patchApp {op:"set", path:"theme.mode", value:"dark"}` |

## 2 · Text & headings

| Prompt | Verb(s) |
|---|---|
| `Add a heading "Roadmap".` | `definePanel {panel:{id:"title", kind:"heading", props:{text:"Roadmap", level:1}}}` |
| `Add a small muted subtitle "Q3 plan".` | `definePanel {panel:{id:"sub", kind:"text", props:{text:"Q3 plan", muted:true, size:"sm"}}}` |
| `Add a divider.` | `definePanel {panel:{id:"d1", kind:"divider"}}` |

## 3 · Seed data (the store)

| Prompt | Verb(s) |
|---|---|
| `Seed a "tasks" list with a couple of rows.` | `patchApp {op:"set", path:"vars.tasks", value:[{id:1,label:"A",status:"done"},{id:2,label:"B",status:"open"}]}` |
| `Add a row to tasks.` | `patchApp {op:"push", path:"vars.tasks", value:{id:3,label:"C",status:"open"}}` |
| `Define a task structure with fields id, label, status.` | `patchApp {op:"set", path:"structures.task", value:[{name:"id",type:"number"},{name:"label",type:"string"},{name:"status",type:"string"}]}` |

## 4 · Data components (pick the RIGHT one — don't default to text/list)

| Prompt | Verb(s) |
|---|---|
| `Show the tasks as a table.` | `definePanel {panel:{id:"tbl", kind:"grid", source:{verb:"readVar", args:{name:"tasks"}}, props:{columns:"id,label,status"}}}` |
| `Add a Gantt timeline of the tasks.` | `definePanel {panel:{id:"gt", kind:"gantt", props:{rowsVar:"tasks", unit:"wk"}}}` |
| `Show the nodes and edges as a graph.` | `definePanel {panel:{id:"g", kind:"nodetree", props:{nodesVar:"nodes", edgesVar:"edges"}}}` |
| `Add a well schematic from the casings/tubing.` | `definePanel {panel:{id:"ws", kind:"wellschematic", props:{casingsVar:"casings", tubingVar:"tubing"}}}` |
| `Make it an editable table.` | `definePanel {panel:{id:"et", kind:"edittable", source:{verb:"readVar", args:{name:"tasks"}}, props:{columns:"id,label,status"}}}` |

## 5 · Layout & nesting

| Prompt | Verb(s) |
|---|---|
| `Put the next things side by side in a row.` | `definePanel {panel:{id:"r1", kind:"row"}}` then `addChildPanel {parentId:"r1", …}` |
| `Add a card.` | `definePanel {panel:{id:"c1", kind:"card"}}` |
| `Add a left tool rail.` | `definePanel {panel:{id:"rail", kind:"vtoolbar"}}` |
| `Add an icon button "Save" to the rail.` | `addChildPanel {parentId:"rail", panel:{id:"b-save", kind:"iconbutton", props:{icon:"save", label:"Save"}}}` |
| `Add tabs "Overview" and "Detail".` | `definePanel {panel:{id:"tabs", kind:"tabs", props:{labels:"Overview,Detail"}}}` |

## 6 · Wiring & edits

| Prompt | Verb(s) |
|---|---|
| `Make the table read the casings variable instead.` | `setComponentProp {panelId:"tbl", name:"source", value:{verb:"readVar", args:{name:"casings"}}}` |
| `Make the heading level 1.` | `setComponentProp {panelId:"title", name:"level", value:1}` |
| `Colour that text red.` | `setComponentProp {panelId:"sub", name:"color", value:"#dc2626"}` |
| `When Save is clicked, persist.` | `setPanelProp {panelId:"b-save", key:"on", value:{click:{verb:"save"}}}` |
| `Remove the divider.` | `removePanel {panelId:"d1"}` |

---

## Composing atoms → a whole app (the roadmap, incrementally)

Instead of one giant prompt, the user types these in sequence — each a §-atom above:

1. `Make this a roadmap app called "CAD Train — Roadmap".`  → *§1*
2. `Add a heading "CAD Train — Roadmap".`  → *§2*
3. `Add a muted subtitle.`  → *§2*
4. `Seed a tasks list.`  → *§3*
5. `Add a Gantt timeline of the tasks.`  → *§4*
6. `Show the tasks as a table below it.`  → *§4*
7. `Use a light theme with a blue accent.`  → *§1*

Each step is inspectable, undoable, and re-usable across apps — and each is a small golden the RAG
retrieves for the next similar request. **The atoms ARE the dictionary of intent → the composition
is the app.**

## Using this as the golden seed

Every row here is a candidate atomic golden `(prompt → verbs)`. Promote the good ones via
`/api/app/promote` so retrieval surfaces the right atom per prompt. As the local model is measured
on `/app_design/eval`, gaps become new atoms here — the library grows toward full coverage.
