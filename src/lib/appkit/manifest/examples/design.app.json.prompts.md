# design.app — build-from-prompts

The ordered natural-language prompts that recreate **design.app** from an empty app, each
annotated with the `appkit` verbs it emits (verb registry: `appkit/verbs/{gui,data,mutate}.ts`).
design.app replicates the `/design` architecture overview on the app harness: a left→right
architecture **Tree** and a **C4** system-context view, both drawn by the SSR-safe `nodetree`
component from seeded app variables. All data is hardcoded in `app.vars` — no file loading.

Component used: `nodetree` (`src/lib/app_components/NodeTree/`) — a pure-SVG nodes+edges graph
laid out L→R by parentId depth; reads `props.nodesVar`/`props.edgesVar` → `vars[name]`
(`dataMode: 'static'`, so it renders in the SSR first paint).

---

### 1. Create the app + title

> "Create an app called **design** titled *CAD Train — Architecture*, docType `design`, light
> theme with a slate accent."

- `setAppMeta { title: "CAD Train — Architecture", docType: "design" }`
- `patchApp { op:"set", path:"app", value:"design" }`
- `patchApp { op:"set", path:"theme", value:{ mode:"light", accent:"#475569" } }`

### 2. Declare the record structures

> "Define two data structures: an **archNode** (id, label, parentId, kind, tech, accent, href,
> blurb, planned, archived) and an **archEdge** (source, target, kind, label)."

- `patchApp { op:"set", path:"structures.archNode", value:[…fields] }`
- `patchApp { op:"set", path:"structures.archEdge", value:[…fields] }`

### 3. Seed the architecture graph (Tree data)

> "Seed a variable **nodes** with the architecture: one *system* (CAD Train), four *container*
> boxes (Web App, API layer, CAD kernel, Volume store), and their key *route / api / lib / store*
> components as children (parentId). Mark `/fem` archived. Then seed a variable **edges** with the
> C4 summary links plus the calls / mounts / flow / reads / writes relationships between them."

- `patchApp { op:"set", path:"vars.nodes", value:[…archNode records…] }`
- `patchApp { op:"set", path:"vars.edges", value:[…archEdge records…] }`

(Data mined from `src/routes/design/architecture.ts` — `ARCH_TREE_NODES` hierarchy + `ARCH_EDGES`.
`kind` = `ArchTreeKind`; `edges[].kind` = `EdgeKind`.)

### 4. Seed the C4 system context (C4 data)

> "Seed a variable **c4nodes** with the C4 context: the *CAD Author* (person), *CAD Train* (system,
> child of the author), and the external systems *Anthropic API*, *Railway + Volume*, and *FAL*
> (archived) as children of the system. Seed **c4edges** with the author→system and system→external
> relationships and their labels."

- `patchApp { op:"set", path:"vars.c4nodes", value:[…] }`
- `patchApp { op:"set", path:"vars.c4edges", value:[…] }`

(Data mined from `src/routes/design/c4.ts` — `C4_CONTEXT`. The synthetic `parentId` chain
user → sys → externals gives the depth the L→R layout needs.)

### 5. Heading + subtitle

> "Add an H1 heading *CAD Train — Architecture* and a muted subtitle explaining it replicates
> /design as pure SSR-safe SVG."

- `definePanel { panel:{ id:"title", kind:"heading", props:{ level:1, text:"CAD Train — Architecture" } } }`
- `definePanel { panel:{ id:"subtitle", kind:"text", props:{ text:"Left→right architecture tree … (no xyflow).", muted:true } } }`

### 6. Add the tabbed views

> "Add a **tabs** panel with two tabs labelled *Tree* and *C4*."

- `definePanel { panel:{ id:"views", kind:"tabs", props:{ labels:["Tree","C4"] } } }`

### 7. Tree tab → a nodetree bound to nodes/edges

> "Inside the first tab put a **node tree** titled *Architecture — system · containers ·
> components*, reading its nodes from the **nodes** variable and its edges from **edges**."

- `addChildPanel { parentId:"views", panel:{ id:"tree", kind:"nodetree", title:"Tree",
  source:{ verb:"readVar", args:{ name:"nodes" } },
  props:{ title:"Architecture — system · containers · components", nodesVar:"nodes", edgesVar:"edges", colWidth:220, rowGap:46 } } }`

### 8. C4 tab → a nodetree bound to c4nodes/c4edges

> "Inside the second tab put a **node tree** titled *C4 — System Context*, reading **c4nodes** and
> **c4edges**, a bit wider."

- `addChildPanel { parentId:"views", panel:{ id:"c4", kind:"nodetree", title:"C4",
  source:{ verb:"readVar", args:{ name:"c4nodes" } },
  props:{ title:"C4 — System Context", nodesVar:"c4nodes", edgesVar:"c4edges", colWidth:250, rowGap:70, nodeWidth:190 } } }`

---

## Notes for the reader

- **The nodetree is `dataMode:'static'`** — it reads `vars[nodesVar]` directly, so its data is in the
  server-rendered first paint (no client fetch). The `source: readVar` binding is declarative
  documentation of the seed-data dependency; `resolvePreloaded` skips static panels.
- **Tabs render only the active child** — at first paint that's the *Tree* tab, so the Tree nodetree
  SVG is in the SSR HTML; the *C4* tab renders on click (client hydration). Both tab labels are in
  the SSR tabbar.
- **Seed data provenance:** Tree ← `src/routes/design/architecture.ts`; C4 ← `src/routes/design/c4.ts`.
  A representative slice (system + 4 containers + key components) — not the full 56-node graph.
