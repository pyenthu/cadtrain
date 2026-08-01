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
  A selectable list of documents/rows. Bind source to a data verb; click selects. A vertical, clickable list where selecting an item drives the rest of the app — use for a master/detail picker, nav menu, or document chooser; NOT for tabular columns (use grid/table).
  props: (none)
  e.g. {"id":"items","kind":"list","source":{"verb":"readVar","args":{"name":"items"}}}

- form (data)
  A document's params as editable fields + tables (list<record> controls). Edit a loaded document's params as labelled fields (with nested list<record> tables) — use for a settings/property editor bound to the active doc; NOT for standalone tabular data (use grid/edittable).
  props: (none)
  e.g. {"id":"params","kind":"form","controls":[{"kind":"field","bind":"name"},{"kind":"table","bind":"casings","cols":["od","top","bot"]}]}

- table (data)
  Tabular rows of a list<record> param with columns; add/edit rows. A columnar table of ONE list<record> param on the active doc, with add/edit rows — use when the data is a single repeated-record field; use grid for read-only variable/source rows.
  props: (none)
  e.g. {"id":"rows","kind":"table","controls":[{"kind":"table","bind":"casings","cols":["od","top","bot"]}]}

- grid (data)
  A read-only data table from any source (http / data verb). Columns from props.columns or inferred. A read-only table of rows from a variable or data verb — use for tabular data with columns when no inline editing is needed (use edittable to edit, or table for a doc list<record> param).
  props: columns:string
  e.g. {"id":"tbl","kind":"grid","source":{"verb":"readVar","args":{"name":"rows"}},"props":{"columns":"name,od,top"}}

- edittable (data)
  Rows editable in LOCAL client state (add/edit/delete instant, no round-trip); on.save persists to the server. Seeded from source (SSR). A spreadsheet-like table the user can add/edit/delete rows in locally, persisting on save — use when tabular data must be EDITED in place; use grid for read-only display.
  props: columns:string, addLabel:string=+ Add row, slot:string
  e.g. {"id":"editor","kind":"edittable","source":{"verb":"loadData","args":{"slot":"data"}},"props":{"columns":"name,od,top","slot":"data"}}

- container (layout) · HOLDS children
  A transparent wrapper that holds nested children (layout/grouping). A transparent, borderless wrapper for grouping children — use for pure layout grouping when you do NOT want a visible box (use card for a bordered surface).
  props: (none)
  e.g. {"id":"group","kind":"container","children":[]}

- card (layout) · HOLDS children
  A bordered surface that holds nested children (a titled group). A bordered, titled surface holding children — use to visually separate a group of content into a distinct box (use container for an invisible wrapper).
  props: (none)
  e.g. {"id":"summary","kind":"card","title":"Summary","children":[]}

- div (layout) · HOLDS children
  A generic block container (HTML-style) — holds children; the basic building block. A generic HTML-style block that holds children — the neutral default building block when no more specific container fits.
  props: (none)
  e.g. {"id":"block","kind":"div","children":[]}

- col (layout) · HOLDS children
  A vertical column — children stacked top-to-bottom. A vertical column stacking children top-to-bottom — use for a vertical layout (pair with row for horizontal).
  props: (none)
  e.g. {"id":"column","kind":"col","children":[]}

- toolbar (layout) · HOLDS children
  A horizontal row that holds children (buttons). props.align: start|center|end|between. A horizontal action bar of buttons/icon-buttons — use as a top toolbar; use row for generic side-by-side layout, vtoolbar for a vertical rail.
  props: align:select(start|center|end|between)=start
  e.g. {"id":"bar","kind":"toolbar","props":{"align":"between"},"children":[]}

- row (layout) · HOLDS children
  A horizontal row — children laid out left-to-right (columns). A horizontal row laying children left-to-right — use for side-by-side layout (pair with col for vertical; use toolbar for an action bar).
  props: align:select(start|center|end|between)=start
  e.g. {"id":"cols","kind":"row","props":{"align":"start"},"children":[]}

- vtoolbar (layout) · HOLDS children
  A vertical rail of children (icons/buttons), docked left — like the studio rail. A vertical icon rail docked to the side — use for an app's primary left tool/nav rail of icon buttons (use toolbar for a horizontal bar, sidebar for a wider collapsible panel).
  props: align:select(start|center|end|between)=start
  e.g. {"id":"rail","kind":"vtoolbar","props":{"align":"start"},"children":[]}

- sidebar (layout) · HOLDS children
  A collapsible side panel that holds nested children (left/right). A collapsible side panel holding children — use for secondary navigation or a filters/details pane beside the main content (use vtoolbar for a thin icon rail).
  props: side:select(left|right)=left, title:string, width:number=220, collapsible:boolean=true
  e.g. {"id":"side","kind":"sidebar","props":{"side":"left","title":"Navigation","width":220},"children":[]}

- tabs (layout) · HOLDS children
  A tabbed container — each child is a tab (label from its title or props.labels). A tabbed container where each child is a tab page — use to switch between alternate views in one region without leaving the page.
  props: labels:string
  e.g. {"id":"views","kind":"tabs","props":{"labels":"Overview,Details"},"children":[]}

- button (input)
  A button that fires on.click (a verb binding or a sequence). Props label/variant. A labelled text button that fires a verb on click — use to trigger an action or mutation (save/bake/add-row); use iconbutton when a glyph is clearer, menu for a dropdown of actions.
  props: label:string=Button, variant:select(solid|ghost)=solid
  e.g. {"id":"save","kind":"button","props":{"label":"Save","variant":"solid"},"on":{"click":{"verb":"patchDoc","args":{}}}}

- iconbutton (input)
  A button with an ICON + text (fires on.click). Pick the icon from a searchable set (its editor); a server icon library is the follow-up. An icon (optionally + label) button firing a verb on click — use in toolbars/rails where a compact glyph is clearer than a text button.
  props: icon:string, label:string, variant:select(solid|ghost)=solid
  e.g. {"id":"add","kind":"iconbutton","props":{"icon":"plus","label":"Add","variant":"ghost"},"on":{"click":{"verb":"addRow","args":{}}}}

- menu (input) · HOLDS children
  A button that opens a dropdown menu; its children are the menu items. A button that opens a dropdown of its children as menu items — use for a compact set of related actions under one trigger (use toolbar to show buttons inline).
  props: label:string=Menu, variant:select(solid|ghost)=solid
  e.g. {"id":"actions","kind":"menu","props":{"label":"Actions"},"children":[]}

- text (display)
  A text label. Props text/size/weight/align/color; text can be a $vars/$params ref. An inline text label/paragraph, optionally bound to a $vars/$params value — use for body copy, a caption, or a live stat readout; use heading for a section title.
  props: text:string=Text, size:select(xs|sm|md|lg|xl|2xl)=md, weight:select(400|600|700)=400, align:select(left|center|right)=left, color:color, muted:boolean
  e.g. {"id":"caption","kind":"text","props":{"text":"Hello","size":"sm","muted":true}}

- heading (display)
  An h1/h2/h3 title (props.level + text). An h1/h2/h3 section title — use as the app or section heading (there is no default app title; add one with this); use text for body copy.
  props: text:string=Heading, level:select(1|2|3)=2
  e.g. {"id":"title","kind":"heading","props":{"text":"Dashboard","level":"1"}}

- divider (display)
  A horizontal rule (<hr>), optionally with a centered label. A horizontal rule, optionally labelled — use to visually separate sections.
  props: label:string
  e.g. {"id":"sep","kind":"divider","props":{"label":"Details"}}

- popover (layout) · HOLDS children
  A BEHAVIOR component: attaches to its PARENT — opens on parent CLICK (floating), holds content + event triggers. Nest it inside the element it belongs to. A floating panel attached to its PARENT that opens on parent click — nest inside the element it belongs to; use for a dropdown/flyout of extra content (use tooltip for a hover hint).
  props: title:string, modal:boolean=false
  e.g. {"id":"flyout","kind":"popover","props":{"title":"Options","modal":false},"children":[]}

- tooltip (display) · HOLDS children
  A BEHAVIOR component: attaches to its PARENT — shows on HOVER (floating). Short content via props.text or nested children. Nest it inside the element it hints. A hover hint attached to its PARENT — nest inside the element it explains; use for a short help hint, NOT persistent or clickable content (use popover for that).
  props: text:string
  e.g. {"id":"hint","kind":"tooltip","props":{"text":"Save changes"}}

- gantt (display)
  A roadmap timeline: task BARS positioned by start/end across a shared axis, coloured by status, grouped into lane swimlanes. Reads rows from an app variable (props.rowsVar → vars[name], a list<record> of {id,label,lane,start,end,status,details}) or an inline props.rows array. Server-renders (no client fetch). Use props.durationField to read {start,weeks}-style records instead of an explicit end. A horizontal timeline of bars over a date/number axis — use for a schedule, roadmap, Gantt, or project plan built from a list of {start,end} (or {start,weeks}) records; NOT for plain tabular data (use grid) or a categorical chart.
  props: title:string, rowsVar:string=tasks, unit:string, rangeStart:number, rangeEnd:number, tickCount:number=6, labelWidth:number=240, durationField:string, laneField:string=lane, startField:string=start, endField:string=end, statusField:string=status, labelField:string=label
  e.g. {"id":"timeline","kind":"gantt","props":{"title":"Roadmap","rowsVar":"tasks","unit":"wk"}}

- wellschematic (display)
  A well cross-section diagram: casing strings, open-hole sections, a centred tubing string, cement, and perforations, drawn to scale (diameter horizontal · depth vertical, deeper = downward). Reads seeded app VARIABLES (props.casingsVar/holesVar/tubingVar/perfsVar/cementVar → vars[name], each a list<record> of {od|bitSize, top, bot, grade?, label?, color?}) or inline props arrays, plus a props.wellVar record for the header (name/field/company). Server-renders (no client fetch) — SSR-safe SVG. An oilfield well cross-section (casing/tubing/perforations/cement drawn to scale) built from seeded well variables — use for a downhole completion, wellbore, or borehole diagram.
  props: title:string, width:number=380, height:number=520, depthUnit:string=ft, wellVar:string=well, casingsVar:string=casings, holesVar:string=holes, tubingVar:string=tubing, perfsVar:string=perforations, cementVar:string=cement
  e.g. {"id":"well","kind":"wellschematic","props":{"wellVar":"well","casingsVar":"casings","tubingVar":"tubing","perfsVar":"perforations"}}

- nodetree (display)
  A nodes+edges architecture graph laid out LEFT→RIGHT by depth (x = depth·colWidth; siblings stack; parents centre over their subtree), drawn as pure SSR-safe SVG (no xyflow). Nodes are coloured by props.kind bucket (system·container·route·api·lib·store·person·external); planned/archived nodes dash + fade; edges are coloured by relationship kind (summary·calls·mounts·flow·reads·writes·nav) with optional labels; a subtle parent→child skeleton is drawn from the node hierarchy. Reads app VARIABLES (props.nodesVar → vars[name], a list<record> of {id,label,parentId?,kind,tech?,accent?,blurb?,href?,planned?,archived?}; props.edgesVar → a list<record> of {source,target,kind?,label?}) or inline props.nodes/props.edges arrays. Server-renders (no client fetch). Ideal for C4 / dependency / site-map diagrams. A nodes+edges graph laid out left→right — use for an architecture tree, org chart, C4 model, dependency/site map, flowchart, or ANY parent/child graph; NOT for a flat selectable list (use list) or tabular rows (use grid).
  props: title:string, nodesVar:string=nodes, edgesVar:string=edges, colWidth:number=210, rowGap:number=46, nodeWidth:number=172, showHierarchy:boolean=true, edgeLabels:boolean=true
  e.g. {"id":"tree","kind":"nodetree","props":{"nodesVar":"nodes","edgesVar":"edges"}}

- bake3d (3d)
  Bakes the active doc through the engine → geometry stats (verts/tris). Bake the active CAD doc through the engine and show geometry stats — use to preview/verify a parametric part's mesh (verts/tris) inside the app.
  props: (none)
  e.g. {"id":"bake","kind":"bake3d","source":{"verb":"bake","args":{"id":"$active"}}}

- svg (display)
  A 2D SVG view of a doc (placeholder until wired). A generic 2D SVG view of a doc — a placeholder surface until a richer 2D view is wired; prefer nodetree/gantt/wellschematic for those specific diagrams.
  props: (none)
  e.g. {"id":"view","kind":"svg","source":{"verb":"loadDoc","args":{"id":"$active"}}}

- file (data)
  Open / Save / Save As a DATA file into a slot (§0.5). Components read it via loadData. Open/Save/Save-As a DATA file into a named slot — use to let the user load external data (e.g. .wson/.json) that other components then read via loadData(slot).
  props: slot:string=data, label:string, type:string
  e.g. {"id":"open","kind":"file","props":{"slot":"data","label":"Open","type":".json"}}

- chat (ai)
  The AI-build surface — a prompt box that edits the app. An AI prompt box that edits the app itself — use to embed the AI-build/assistant surface inside a running app.
  props: (none)
  e.g. {"id":"ai","kind":"chat"}


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


