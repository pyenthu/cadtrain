# ewell.app — build-from-prompts script

The ordered natural-language prompts that recreate `ewell.app.json` from an empty `.app`, each
annotated with the appkit **gui** / **data** verbs it emits (`src/lib/appkit/verbs/{gui,data}.ts`).
This replicates wellnew's `/ewell` panel-shell (`~/Desktop/GitHub/wellnew/src/routes/ewell/`) on the
cadtrain harness: a left vertical tool rail + a main well-schematic area + a right data sidebar,
all fed from seeded app variables.

Conventions: **depth increases downward** (top/shallow at the top, TD at the bottom — the natural
well-log orientation, consistent with the project Z-down rule); **radial units = inches** (od /
bitSize), **axial units = the depth unit** (ft here). One representative well ("Wildcat #1") is
mined from `stores/welldefault.json`.

---

## 0. Create + name the app
> "New app called **ewell**, title **GEOWELLS — Well Schematic**, docType **well**, light theme with a deep-teal accent (#0f3d56)."

- `setAppMeta({ title: "GEOWELLS — Well Schematic", docType: "well" })`
- `patchApp({ op:"set", path:"app", value:"ewell" })`
- `patchApp({ op:"set", path:"theme", value:{ mode:"light", accent:"#0f3d56" } })`

## 1. Seed the well DATA (app variables — no file loading yet)
> "Seed the active well **Wildcat #1** (New Field, Wyoming, USA; TD 3000 ft). Add casing strings 13-3/8, 9-5/8, 7 and a 4-1/2 liner; the open-hole bit sections; cement columns; a 2-7/8 tubing string with a hanger and a production packer; three perforation intervals; and the completion tool list."

- `patchApp({ op:"set", path:"vars.well", value:{ name:"Wildcat #1", field:"New Field", state:"Wyoming", country:"USA", company:"Pvt Asian Independent", location:"25N 36E", totalDepth:3000, depthUnit:"ft" } })`
- `patchApp({ op:"set", path:"vars.casings", value:[ … {od,grade,weight,top,bot} … ] })`
- `patchApp({ op:"set", path:"vars.holes", value:[ … {bitSize,top,bot} … ] })`
- `patchApp({ op:"set", path:"vars.cement", value:[ … {od,top,bot} … ] })`
- `patchApp({ op:"set", path:"vars.tubing", value:[ … {od,top,bot,label} … ] })`
- `patchApp({ op:"set", path:"vars.perforations", value:[ … {top,bot,shotDensity,gunOD,company,perfSpec,color} … ] })`
- `patchApp({ op:"set", path:"vars.completions", value:[ … {od,length,weight,description} … ] })`

(Each `list<record>` is exactly the shape `readVar` returns to a grid and the WellSchematic reads.)

## 2. The left tool rail (vtoolbar) — replicates wellnew's ToolBar
> "Add a vertical tool rail on the left with icon buttons: Add Well, Header, Schematic, Completions, Perforations, Display, JSON."

- `definePanel({ panel:{ id:"rail", kind:"vtoolbar", props:{ align:"start" }, layout:{ col:1, row:1, w:1, h:1 } } })`
- for each button: `addChildPanel({ parentId:"rail", panel:{ id:"tb-…", kind:"iconbutton", props:{ icon:"…", label:"…", variant:"ghost" } } })`
  - Add Well → `icon:"add"` · Header → `icon:"info"` · Schematic → `icon:"chart"` · Completions → `icon:"table"` · Perforations → `icon:"flag"` · Display → `icon:"settings"` · JSON → `icon:"file"`

## 3. Toolbar buttons open panels (popover children)
> "Clicking Header shows the well header; Completions shows the completion strings table; Perforations shows the perforations table; Display and JSON show notes."

- `addChildPanel({ parentId:"tb-header", panel:{ id:"pop-header", kind:"popover", props:{ title:"Well Header" } } })`
  then `addChildPanel({ parentId:"pop-header", panel:{ id:"hdr-name", kind:"text", props:{ text:"Well: $vars.well.name", weight:600 } } })` (+ field, company)
- `addChildPanel({ parentId:"tb-completions", panel:{ id:"pop-completions", kind:"popover", props:{ title:"Completion Strings" } } })`
  then `addChildPanel({ parentId:"pop-completions", panel:{ id:"grid-completions", kind:"grid", source:{ verb:"readVar", args:{ name:"completions" } }, props:{ columns:"description,od,length,weight" } } })`
- `addChildPanel({ parentId:"tb-perforations", panel:{ id:"pop-perforations", kind:"popover", props:{ title:"Perforations" } } })`
  then a `grid` sourced from `readVar name:"perforations"`.
- Display / JSON popovers → `text` notes (Display reads `$vars.well.depthUnit` + `$vars.well.totalDepth`).

(A `popover` is a BEHAVIOR child — the harness attaches it to its parent button and opens it on click; `PanelNode` handles this. It never renders inline.)

## 4. The main well-schematic area
> "In the centre, show the well name as a heading, a subtitle, and the well schematic drawing sized 420×560, reading the seeded casings/holes/tubing/perforations/cement."

- `definePanel({ panel:{ id:"main", kind:"col", layout:{ col:2, row:1, w:8, h:1 } } })`
- `addChildPanel({ parentId:"main", panel:{ id:"main-title", kind:"heading", props:{ level:2, text:"$vars.well.name" } } })`
- `addChildPanel({ parentId:"main", panel:{ id:"main-sub", kind:"text", props:{ text:"$vars.well.field · $vars.well.state, $vars.well.country", muted:true, size:"sm" } } })`
- `addChildPanel({ parentId:"main", panel:{ id:"schematic", kind:"wellschematic", props:{ wellVar:"well", casingsVar:"casings", holesVar:"holes", tubingVar:"tubing", perfsVar:"perforations", cementVar:"cement", depthUnit:"ft", width:420, height:560 } } })`

(`wellschematic` is `dataMode:"static"` — it reads the seeded vars directly, so the whole SVG is in the SSR first paint.)

## 5. The right data sidebar
> "Add a right sidebar titled Well Data with tables for the casing strings, the tubing, and the perforations."

- `definePanel({ panel:{ id:"side", kind:"sidebar", props:{ side:"right", title:"Well Data", width:300 }, layout:{ col:10, row:1, w:3, h:1 } } })`
- `addChildPanel({ parentId:"side", panel:{ id:"side-casings-h", kind:"heading", props:{ level:3, text:"Casing Strings" } } })`
- `addChildPanel({ parentId:"side", panel:{ id:"grid-casings", kind:"grid", source:{ verb:"readVar", args:{ name:"casings" } }, props:{ columns:"od,grade,weight,top,bot" } } })`
- repeat for **tubing** (`readVar name:"tubing"`, columns `label,od,top,bot`) and **perforations** (`readVar name:"perforations"`, columns `top,bot,shotDensity,company`), each preceded by a `heading`.

(`grid` is `dataMode:"server"` — the SSR walk `resolvePreloaded` resolves its `readVar` source up-front, so the rows are baked into the HTML.)

---

### Verbs used
- **gui**: `setAppMeta`, `patchApp`, `definePanel`, `addChildPanel` (+ `setComponentProp` for later tweaks).
- **data**: `readVar` — the seed-data bridge from `app.vars` to every server-mode grid.

### Components used
- **Reused (existing bundles)**: `vtoolbar`, `iconbutton`, `popover`, `col` (Container), `sidebar`, `heading`, `text`, `grid` (DataGrid).
- **New (built for this app)**: `wellschematic` (`app_components/WellSchematic/`) — an SSR-safe SVG well cross-section; pure layout math in `well-schematic-layout.ts`.
