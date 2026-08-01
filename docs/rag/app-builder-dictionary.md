# App-Builder RAG Dictionary

_Auto-generated from the SSOT by `bun run scripts/gen-app-dictionary.ts` — the component catalog
(`appkit/catalog`) + the verb registry (`appkit/verbs`). This is what the LOCAL model reads to
build `.app` UIs with NO Claude API (restricted / air-gapped). Regenerate after enriching a
`meta.ts` or a verb — it never drifts from the code._

**29 components · 29 verbs**

---

## Components — the UI kinds you can place

Index — data: list, form, table, grid, edittable, file · layout: container, card, div, col, toolbar, row, vtoolbar, sidebar, tabs, popover · input: button, iconbutton, menu · display: text, heading, divider, tooltip, gantt, wellschematic, nodetree, svg · 3d: bake3d · ai: chat

Each card: what it is · when to reach for it · props · a concrete example call.

- list (data)
  A selectable list of documents/rows. Bind source to a data verb; click selects.
  props: (none)

- form (data)
  A document's params as editable fields + tables (list<record> controls).
  props: (none)

- table (data)
  Tabular rows of a list<record> param with columns; add/edit rows.
  props: (none)

- grid (data)
  A read-only data table from any source (http / data verb). Columns from props.columns or inferred.
  props: columns:string

- edittable (data)
  Rows editable in LOCAL client state (add/edit/delete instant, no round-trip); on.save persists to the server. Seeded from source (SSR).
  props: columns:string, addLabel:string=+ Add row, slot:string

- container (layout) · HOLDS children
  A transparent wrapper that holds nested children (layout/grouping).
  props: (none)

- card (layout) · HOLDS children
  A bordered surface that holds nested children (a titled group).
  props: (none)

- div (layout) · HOLDS children
  A generic block container (HTML-style) — holds children; the basic building block.
  props: (none)

- col (layout) · HOLDS children
  A vertical column — children stacked top-to-bottom.
  props: (none)

- toolbar (layout) · HOLDS children
  A horizontal row that holds children (buttons). props.align: start|center|end|between.
  props: align:select(start|center|end|between)=start

- row (layout) · HOLDS children
  A horizontal row — children laid out left-to-right (columns).
  props: align:select(start|center|end|between)=start

- vtoolbar (layout) · HOLDS children
  A vertical rail of children (icons/buttons), docked left — like the studio rail.
  props: align:select(start|center|end|between)=start

- sidebar (layout) · HOLDS children
  A collapsible side panel that holds nested children (left/right).
  props: side:select(left|right)=left, title:string, width:number=220, collapsible:boolean=true

- tabs (layout) · HOLDS children
  A tabbed container — each child is a tab (label from its title or props.labels).
  props: labels:string

- button (input)
  A button that fires on.click (a verb binding or a sequence). Props label/variant.
  props: label:string=Button, variant:select(solid|ghost)=solid

- iconbutton (input)
  A button with an ICON + text (fires on.click). Pick the icon from a searchable set (its editor); a server icon library is the follow-up.
  props: icon:string, label:string, variant:select(solid|ghost)=solid

- menu (input) · HOLDS children
  A button that opens a dropdown menu; its children are the menu items.
  props: label:string=Menu, variant:select(solid|ghost)=solid

- text (display)
  A text label. Props text/size/weight/align/color; text can be a $vars/$params ref.
  props: text:string=Text, size:select(xs|sm|md|lg|xl|2xl)=md, weight:select(400|600|700)=400, align:select(left|center|right)=left, color:color, muted:boolean

- heading (display)
  An h1/h2/h3 title (props.level + text).
  props: text:string=Heading, level:select(1|2|3)=2

- divider (display)
  A horizontal rule (<hr>), optionally with a centered label.
  props: label:string

- popover (layout) · HOLDS children
  A BEHAVIOR component: attaches to its PARENT — opens on parent CLICK (floating), holds content + event triggers. Nest it inside the element it belongs to.
  props: title:string, modal:boolean=false

- tooltip (display) · HOLDS children
  A BEHAVIOR component: attaches to its PARENT — shows on HOVER (floating). Short content via props.text or nested children. Nest it inside the element it hints.
  props: text:string

- gantt (display)
  A roadmap timeline: task BARS positioned by start/end across a shared axis, coloured by status, grouped into lane swimlanes. Reads rows from an app variable (props.rowsVar → vars[name], a list<record> of {id,label,lane,start,end,status,details}) or an inline props.rows array. Server-renders (no client fetch). Use props.durationField to read {start,weeks}-style records instead of an explicit end.
  props: title:string, rowsVar:string=tasks, unit:string, rangeStart:number, rangeEnd:number, tickCount:number=6, labelWidth:number=240, durationField:string, laneField:string=lane, startField:string=start, endField:string=end, statusField:string=status, labelField:string=label

- wellschematic (display)
  A well cross-section diagram: casing strings, open-hole sections, a centred tubing string, cement, and perforations, drawn to scale (diameter horizontal · depth vertical, deeper = downward). Reads seeded app VARIABLES (props.casingsVar/holesVar/tubingVar/perfsVar/cementVar → vars[name], each a list<record> of {od|bitSize, top, bot, grade?, label?, color?}) or inline props arrays, plus a props.wellVar record for the header (name/field/company). Server-renders (no client fetch) — SSR-safe SVG.
  props: title:string, width:number=380, height:number=520, depthUnit:string=ft, wellVar:string=well, casingsVar:string=casings, holesVar:string=holes, tubingVar:string=tubing, perfsVar:string=perforations, cementVar:string=cement

- nodetree (display)
  A nodes+edges architecture graph laid out LEFT→RIGHT by depth (x = depth·colWidth; siblings stack; parents centre over their subtree), drawn as pure SSR-safe SVG (no xyflow). Nodes are coloured by props.kind bucket (system·container·route·api·lib·store·person·external); planned/archived nodes dash + fade; edges are coloured by relationship kind (summary·calls·mounts·flow·reads·writes·nav) with optional labels; a subtle parent→child skeleton is drawn from the node hierarchy. Reads app VARIABLES (props.nodesVar → vars[name], a list<record> of {id,label,parentId?,kind,tech?,accent?,blurb?,href?,planned?,archived?}; props.edgesVar → a list<record> of {source,target,kind?,label?}) or inline props.nodes/props.edges arrays. Server-renders (no client fetch). Ideal for C4 / dependency / site-map diagrams.
  props: title:string, nodesVar:string=nodes, edgesVar:string=edges, colWidth:number=210, rowGap:number=46, nodeWidth:number=172, showHierarchy:boolean=true, edgeLabels:boolean=true

- bake3d (3d)
  Bakes the active doc through the engine → geometry stats (verts/tris).
  props: (none)

- svg (display)
  A 2D SVG view of a doc (placeholder until wired).
  props: (none)

- file (data)
  Open / Save / Save As a DATA file into a slot (§0.5). Components read it via loadData.
  props: slot:string=data, label:string, type:string

- chat (ai)
  The AI-build surface — a prompt box that edits the app.
  props: (none)


---

## Verbs — the function-calls you emit

# App verbs — authoring guide (generated)

## data

- `readVar(name)` — Read an app-level variable (app.vars[name]) — the seed-data bridge. Lets a data component (grid/list) SOURCE its rows from a seeded list<record> variable, e.g. source { verb:'readVar', args:{ name:'tasks' } }. Returns the value (often an array of records); an empty array if the variable is absent. No engine needed — reads the live .app.
- `listDocs(docType)` — List available documents of a type. Returns [{id, title}].
- `loadDoc(id)` — Load a document by id. Returns { id, params }.
- `getParams(id)` — Get a document's params (name→value; list<record> for wells casings/completions/survey).
- `bake(id, params)` — Bake a document with params → geometry stats { verts, tris }.
- `getSource(id)` — Get a document's TypeScript source.
- `compile(id, params)` — Compile a document → the dep-inlined Manifold script + scriptHash.
- `listParts(category)` — List volume parts, optionally filtered by category. Returns [{id, meta}].
- `loadData(slot, pick)` — Read the DATA a File component opened into a slot (§0.5 — the app is stateless; data lives in files). { slot, pick? } → the parsed content (or a nested path via pick). Wire a component's source to it: {verb:'loadData', args:{slot:'well'}}.
- `http(url, method, body, headers, pick)` — Call an HTTP endpoint declaratively: { url, method?, body?, headers?, pick? }. Returns the parsed JSON (or text). "pick" selects a nested path (e.g. "data.items") — use it to feed a list panel an array. Same-origin URLs like "/api/..." are typical. Wire it as a panel source or an on-event action.

## mutate

- `setParam(id, name, value)` — Set a scalar param (or a list<record> cell) on a document. Returns { ok }.
- `addRow(id, list, row)` — Append a record to a list<record> param (e.g. a casing/completion row). Returns { ok, index }.
- `removeRow(id, list, index)` — Remove a record from a list<record> param by index.
- `reorderRow(id, list, from, to)` — Move a list<record> row from one index to another.
- `patchDoc(id, op, path, value)` — Patch a document JSON: op="set|push|remove", path (dotted), value.

## gui

- `listPanelKinds()` — List the panel kinds the harness can render. Returns [{kind}].
- `definePanel(panel)` — Append a panel to the .app: { id, kind, source?, controls? }. Returns { ok }.
- `addControl(panelId, control)` — Add a control to a panel (by panelId). Returns { ok }.
- `addChildPanel(parentId, panel)` — Append a child panel to a container/card/tabs/toolbar/div (by parentId). Returns { ok }. Nesting = HTML-style encapsulation.
- `indentPanel(panelId)` — Demote a panel INTO its previous sibling (append to prevSibling.children). No-op if first in its list.
- `outdentPanel(panelId)` — Promote a panel OUT of its parent (move it just after the parent in the parent's list). No-op at top level.
- `insertTree(nodes, parentId)` — Insert a cloned subtree (a saved component/template) into the .app — at the root or into a parent by id. Re-ids on insert so nothing collides.
- `removePanel(panelId)` — Remove a panel from the .app by id (anywhere in the tree — top-level or nested).
- `movePanel(panelId, to)` — Reorder a panel within its siblings — "to" is the target index in its own list (top-level or nested).
- `setPanelProp(panelId, key, value)` — Set a property on a panel (e.g. title, text, kind).
- `setComponentProp(panelId, name, value)` — Set a typed PROP on a component (panel) by id — writes panel.props[name] (text, label, columns, align, slot, …). Finds nested children too. A null/undefined value deletes the prop.
- `setAppMeta(title, docType)` — Set the app title and/or docType.
- `bindAction(controlId, verb, args)` — Bind a control (by controlId) to a verb + args.
- `patchApp(op, path, value)` — Patch the .app JSON directly: op="set|push|remove", path (dotted), value. For app-level state the other verbs don't cover — SEED DATA: path "vars.<name>" (a scalar / list / list-of-records, read as $vars.<name>); DEFINE A STRUCTURE: path "structures.<name>" value [{name,type},…] (a record schema); theme: path "theme" value {mode,accent}; app id: path "app".


