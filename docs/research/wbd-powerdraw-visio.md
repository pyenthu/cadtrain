<!-- research-group: Wells / schematic -->
# PowerDraw WBD (Visio) — wellbore-diagram stencil

Research teardown of **"FREE PowerDraw WBD w Smart Tool Icons.vsdx"** (Microsoft
Visio 2016 OOXML, `.vsdx` = ZIP). Author: **Robin Mudryk** ("PowerDraw"). A free
sampler of a commercial **Wellbore Diagram (WBD)** stencil of "smart" downhole
component icons. Imperial (`IsMetric=false`). 2 pages, 10 masters. Decoded from
`/tmp/vsdx_probe/unz` (`visio/pages/page1.xml`, `visio/masters/master*.xml`).

Why cadtrain cares: directly feeds the parked `/wells` route, the WSON schematic
schema (SVTC sibling), and the completion-component vocabulary. This is a
production example of *data-driven downhole-component icons* — the exact thing a
2D schematic editor needs, and a clean 2D↔3D mapping target.

---

## 1. What the file is + component vocabulary

`page1` is a **sample vertical well schematic** built by stamping master
instances down the page. It is a *stylized, not-to-scale* diagram (page is plain
1:1 letter size, `DrawingScaleType=0` — there is **no drawing scale**; depth is
carried as text tags, not page geometry — see §2). Datum is **KB** (kelly
bushing); units shown as `ft KB`.

Reconstructed sample stack (from `page1.xml` shape Text + DepthTag values):

| Item | Master used | Depth tag |
|---|---|---|
| A | `#2 Casing (Production)` | 2500.00 ft KB |
| B | `#2 Openhole (Production)` (curved/bend) | 2700.00 ft KB |
| — | `Perfs` | (zip, top+bottom tags) |
| — | `Tubing Free Stretch (zip)` | — |
| — | `Bull Plug` | — |
| floating | `Floating Depth Tag` ×2 | "Top of Cement 2000.00 ft KB" / "...2600.00 ft KB" |

The 10 masters → cadtrain completion vocabulary:

| # | Visio master | Draws | cadtrain equivalent |
|---|---|---|---|
| 1 | **#2 Casing (Production)** | cased string + optional cement(out/in), openhole, litho, shoe | casing string / `g_shaft`-family tubular; WSON `casing` |
| 2 | **open hole rock** | rock-face hatch fill | openhole annulus / litho fill |
| 3 | **openhole line** | open-hole borehole wall line | openhole wall |
| 4 | **cement2** | cement hatch band | cement sheath (annular) |
| 5 | **#2 Openhole (Production)** | open-hole section w/ bend | openhole / deviated section |
| 6 | **openhole production** (liner) | liner-in-openhole | liner |
| 7 | **Perfs** (perforations) | up to 6 perfs/side, zip-stretch, top+bottom depth tags | perforations (`docs/parts` perforation primitive) |
| 8 | **Tubing Free Stretch (zip)** | production tubing, vertically free-stretchable | tubing string |
| 9 | **Bull Plug** | bottom bull plug / end cap | bull plug / end fitting |
| 10 | **Floating Depth Tag** | draggable depth annotation | depth callout (UI annotation, not a part) |

This is the **completion-string vocabulary**: casing · liner · openhole · cement
· tubing · perforations · bull plug, plus a depth-callout annotation. Maps cleanly
onto the packers/nipples/mule-shoe parts cadtrain already authors.

---

## 2. The smart / parametric model (the key finding)

Each "Smart Tool Icon" is a Visio **group shape** whose behaviour comes from four
ShapeSheet sections. Crucially, the geometry is **NOT auto-scaled from a numeric
depth top/bottom** — depth is metadata/annotation. The "smart" is *feature
toggles + dropdown variants + BOM data + stacking glue*, not depth-proportional
drawing.

**(a) Shape Data — `Section N="Property"` (the user-facing schema).** Rows carry
`Label / Value / Format / Type / Prompt`. The recurring schema across tools:

| Prop row | Label | Role |
|---|---|---|
| `ItemNum` | Item Number | balloon/tally callout id |
| `DepthTag` | Depth Tag (Top) | depth string, e.g. `555.00` (units stripped) |
| `ProductDetails`/`DepthTag_Bottom` | Depth Tag Bottom | second depth (perfs, intervals) |
| `ProductDetails` | Default Product Details | description for the tally/BOM |
| `ToolID` / `ToolOD` / `ToolHeight` | Tool I.D./O.D./Length [units] | dims for BOM (default `0`) |
| `Units` | Units | dropdown `ft;m;ft KB;m KB;ft MD;m MD` |
| `CasingSize` | Casing Size | dropdown `1-Production;2-Intermediate;3-Liner` |
| `TubingPos` | Tubing Position | dropdown `1-Centre;2-Left;3-Right` |
| `TubingSize` | Tubing Size | `1-Small;2-Large` |
| `IconColor` | Set Color or BW | `1-Color;2-BW` |
| `IconVer` | Icon Version | guarded version string |

Label text itself is reactive — e.g. the OD label rewrites per page unit system:
`"Tool O.D. ["&IF(ThePage!User.IsMetric,"metric","standard")&"] units"`.

**(b) User cells — `Section N="User"` (derived state + toggles).** Dropdown
strings are converted to integers and booleans drive everything:
`User.CasingSize.Value F='LOOKUP(Prop.CasingSize,Prop.CasingSize.Format)'`.
Boolean feature flags: `ShowCementOut, ShowCementIn, ShowOpenHole, ShowLitho,
ShowShoe, HideBalloon, HideDepth, IsHorz, IsGlued, IsGroupLock, EnableFreeStretch,
EnableFreeMove`.

**(c) Geometry gating — features are sub-geometries switched by `NoShow`.** One
casing master contains casing + cement-out + cement-in + openhole + litho + shoe,
each gated:

```
Cell N='NoShow' V='1' F='NOT(Sheet.5!User.ShowOpenHole)'
Cell N='NoShow' V='1' F='NOT(Sheet.5!User.ShowLitho)'
```

**(d) Variant dimensioning — the size dropdown shifts geometry X offsets** (it
does *not* read a real OD in inches; it picks a stylized width):

```
Cell N='X' F='Width*0.95 + IF(User.CasingSize=1,0.125,0) - IF(User.CasingSize=2,0.065,0)'
```

`TubingPos` snaps the shape's PinX to centre/left/right and onto a 0.5" grid:
`MAX(IF(MODULUS(ABS(PinX),0.5)>0.25,CEILING(ABS(PinX),0.5),FLOOR(...)),0)+IF(User.TubingPos=1,-0.1563,0.1563)`.

**(e) Right-click Actions menu** (`Section N="Action"`) toggles the User booleans:
`Menu="Show Cement Outside of Casing"  Action=SETF(GetRef(User.ShowCementOut),NOT(User.ShowCementOut))`
— plus Rotate 45/90, Flip X/Y, Show/Hide Balloon, Show/Hide Depth Tag, Edit Tool
Properties, **Insert Product Details**.

**(f) Depth tags are free annotations, not scaled geometry.** The depth label text
is just `Sheet.5!Prop.DepthTag & " " & Sheet.5!Prop.Units`. The **Floating Depth
Tag** is a leader-line + text box you drag to a depth gridline and *type* the
depth into; its Y position is geometric (`PinY=(BeginY+EndY)/2`) but is **not**
converted to a depth number. So the diagram is schematic/not-to-scale: a tool is
*free-stretched* vertically by hand and the depth is annotated, not computed.

**(g) BOM / tally export — the real payoff of "smart".** Every tool builds a
tab-delimited record:

```
User.ProductDetails =
  CHAR(9)&Prop.ItemNum&"."&CHAR(9)&Prop.ProductDetails&CHAR(9)
  &User.ToolID&CHAR(9)&User.ToolOD&CHAR(9)&User.ToolHeight&CHAR(9)&Prop.DepthTag
```

and the Action `Insert Product Details` calls
`CALLTHIS("CTI_ItemInsertAfter","MiscBlocks",TRUE,User.ProductDetails)` to drop a
row into an auto-generated equipment tally/BOM table. **The icons are "smart"
because they double as a structured data source for a tally**, not because the
geometry is depth-accurate.

**(h) Vertical stacking — connection points.** Casing master has two glue points,
top and bottom, `Type=2` (inward), at `Y=Height*0.998` and `Y=Height*0.003`,
`X=Width*0.5` (centerline). Tools glue end-to-end down the wellbore centerline;
`IsGlued`/`EnableFreeMove` gate the snap-to-0.5"-grid logic.

### Parametrization vocabulary (extract this)
`ItemNum · DepthTagTop · DepthTagBottom · ProductDetails · ToolID · ToolOD ·
ToolHeight · Units(ft/m/KB/MD) · SizeClass(Production/Intermediate/Liner) ·
Position(Centre/Left/Right) · feature flags(cementOut/cementIn/openHole/litho/shoe)
· color(color/BW)`.

---

## 3. Ideas for cadtrain (prioritized)

**P1 — Adopt the Shape-Data schema as the WSON component-instance schema.** The
Property-row set above is a battle-tested field list for a completion component.
Make each `/wells` schematic node carry `{ itemNum, depthTop, depthBottom,
sizeClass, position, units, productDetails, toolOD, toolID, toolLength, features:{
cementOut, cementIn, openHole, litho, shoe } }`. This is a near drop-in for WSON.

**P2 — Feature-flag composition over many masters.** PowerDraw proves you don't
need a separate icon per variant: one *casing* component with boolean
sub-geometries (cement in/out, openhole, litho, shoe) toggled from a context menu.
cadtrain already has this idea (`User.ShowX` ≈ a part's optional `.add/.subtract`
features). Mirror it: a schematic casing node with checkboxes for cement/shoe maps
1:1 to optional Manifold features on the 3D part.

**P3 — 2D-schematic→3D-part mapping is direct.** The vocabulary lines up with
existing primitives: casing/liner/tubing → tubular `g_shaft`-family;
perforations → perforation primitive; bull plug → end-cap part; cement →
annular sheath; openhole → borehole envelope. The schematic's `sizeClass +
depthTop/Bottom + OD` is exactly the parameter set a parametric tubular needs.
Build a `wbdNode → primitive(meta.params)` translator (same shape as the existing
vocab rule-translator).

**P4 — Auto-tally / BOM from the schematic.** PowerDraw's `ProductDetails`
tab-record → equipment tally is a strong feature for cadtrain: a `/wells`
schematic should emit a parts list (item #, description, OD, depth) — useful for
the RAG corpus and for round-tripping to WSON.

**P5 — Two depth modes.** PowerDraw is *not-to-scale + manual depth tags*. cadtrain
can do better with a true depth-scaled axis (depthTop/Bottom → Y), but should keep
a "schematic / not-to-scale" mode because real WBDs compress deep intervals.
Floating depth tags (drag-to-annotate) are still worth copying as a UI affordance.

**P6 — Stacking via centerline connection points.** Adopt the top/bottom
centerline glue-point model for the schematic editor so strings snap end-to-end;
it's simpler than free placement and matches how completions actually stack.

---

## 4. Keep vs ignore

**Keep / extract:**
- The **icon list** (§1 table) as the `/wells` completion-component vocabulary.
- The **Shape-Data schema** (§2a/§2 vocabulary) as the WSON component-instance fields.
- The **feature-flag pattern** (cementOut/In, openHole, litho, shoe) and the
  **size-class dropdown** (Production/Intermediate/Liner) as variant axes.
- The **tally/BOM record** concept (item#, OD, depth → parts list).
- **Centerline top/bottom connection points** for vertical stacking.

**Ignore:**
- Visio ShapeSheet formula mechanics (NoShow/SETF/LOOKUP/GUARD, PinX snap math) —
  implementation detail of Visio, not portable.
- The not-to-scale free-stretch geometry and 0.5"-grid snap — cadtrain should use a
  real depth axis instead.
- BW/Color icon toggle, balloon styling, Visio themes, `CALLTHIS` plug-in hooks.
- The actual vector artwork (hatch patterns) — cadtrain renders from 3D parts / its
  own SVG, not Visio geometry.

**Source files:** `/tmp/vsdx_probe/unz/visio/pages/page1.xml` (sample well),
`visio/masters/master1.xml` (casing — richest ShapeSheet), `master7/9.xml`
(perfs/bull-plug property schemas), `master10.xml` (floating depth tag),
`visio/pages/pages.xml` (page `User.IsMetric`, units).
