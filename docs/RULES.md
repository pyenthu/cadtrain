# CAD Train — Design Rules

The single reference for the conventions and rules that govern the
4-level hierarchy and the composite generators. Anything in code that
violates a rule here is a bug; anything we want to add to the library
should be checked against this document first.

## 1. Hierarchy levels

| Level | Name | Definition | Surface |
|---|---|---|---|
| 1 | **Primitive** | Atomic geometric shape, single ManifoldCAD builder, ≤ ~10 params. May have a `parent` for KB-style derivation (SC/LC/BC variants of `threaded_box`). | `/primitives` → Primitives tab |
| 2 | **Composition** | Single-part physical item assembled from primitives and unioned into one piece (tubing joint, LatchRite window joint, drill-pipe joint). Geometry built via `buildAuthored(spec)`. | `/primitives` → Compositions tab |
| 3 | **Component** | Multi-PART physical item where each part installs / moves independently (HS-ICV valve = mandrel + sleeve + ports; HF-1 packer = mandrel + element + slips; Bottom Sub; Ratch-Latch). | `/primitives` → Components tab |
| 4 | **Assembly** | Multi-component product / installed string (SmartWell 2-zone, multilateral junction, BHA, full completion). | `/primitives` → Assemblies tab |

KB tab is parallel: reference tables (casing-tubing, drill-pipe
identification, ...) that drive constrained parametrization downstream.

## 2. Universal end-form convention

**Box (female) on top. Pin (male) on bottom.**

- `tz` is the drilling z-down convention: positive z is up, negative z is
  down.
- A composition's body sits at z=0; its top connection at +bodyLength;
  its bottom connection at –connLength.
- Two of the same composition stack into a string without orientation
  flips: pin (bottom of upper joint) mates into box (top of lower joint).
- Documented at the top of `src/lib/components/components-l3.ts` and
  `src/lib/components/rules/tubing.ts`.

## 3. Primitive registry

`src/lib/components/library.ts` exports `COMPONENTS: ComponentDef[]`,
which is built from:

```ts
export const COMPONENTS = [...BASE_COMPONENTS, ...VARIATION_SPECS.map(deriveVariation)];
```

- **BASE_COMPONENTS** — hand-authored entries with a unique geometry
  builder registered in `src/lib/components/builder.ts`.
- **VARIATION_SPECS** — small spec table; `deriveVariation(spec)`
  returns a ComponentDef that inherits the parent's params + builder
  geometry, overriding only `defaults` and (optionally) per-param
  ranges. Carries `parent: spec.parent` so `buildPrimitiveManifold`
  walks the parent chain to find the right builder.

Adding a new spec-variant (e.g. another casing connection family) is
one entry in `VARIATION_SPECS` — no builder code required.

## 4. Composite generator pipeline

For tubing and drill-pipe: rules files in `src/lib/components/rules/`
encode the input → output transform.

```
inputs → resolve (KB lookup + formula fallback) → derived dims → buildSpec → AuthoredComponent
```

- **inputs** — small explicit type (`TubingInputs`, `DrillPipeInputs`).
  Examples: size, weight, grade, connection, length.
- **resolve** — async, fetches the KB and looks for an exact-match row.
  Falls back to formula defaults rooted in API tables when no row
  matches. Returns derived dims + `from_kb: boolean`.
- **buildSpec** — sync, takes inputs + derived dims and returns an
  `AuthoredComponent` with `parts: [body, top_box, bot_pin]` (or
  `top_tj, bot_tj` for drill pipe). Bakes the convention from §2.
- **generate*** — convenience wrapping resolve + buildSpec.
- **generate*Sync** — synchronous formula-only path, used at module
  load time when the KB isn't reachable yet.

Add a new pipe family (line pipe, casing variant, drill collar) by
copying the tubing rules file and editing the inputs / KB filter / view
scaling. The end-form convention is preserved automatically.

## 5. KB tables

`static/kb/index.json` is the manifest. Each entry has a JSON file at
`static/kb/<path>` with a `rows` array. Current tables:

- `casing-tubing-data` — 299 rows of LP/CSG/TBG operator inventory
- `drill-pipe-identification` — 8 rows of API tool-joint marking → grade

Adding a KB:

1. Drop the JSON in `static/kb/api/<name>.json` with `rows: [...]`.
2. Append a manifest entry to `static/kb/index.json`.
3. Optional: add an extractor under `scripts/kb/` if you regenerate
   from a PDF.

The KB tab in `/primitives` lists every entry automatically. Each row
in the table can carry an action button (the casing-tubing tab uses
this to invoke `generateTubingComponent` per row → opens the resulting
joint as a composite tab).

## 6. View scaling for compositions

Real tubing is ~31 ft (354") body + ~6" connection. We compress the
body length by ~83× in the canvas so the connection threads remain
visible. Connection lengths get a 5× visibility bump on top.

| Constant | Value | Effect |
|---|---|---|
| `BODY_VIEW_LENGTH_FRAC` | 0.012 | 354" body → 4.25 view units |
| `CONN_VIEW_LENGTH_FRAC` | 0.02 | base scale for connection length |
| `CONN_VIEW_BUMP` | 5 | extra multiplier so threads aren't sub-pixel |

Defined in `src/lib/components/rules/tubing.ts`; mirrored with
`TJ_*` names in `rules/drill_pipe.ts`. Tweak in one place to rescale
the entire composition library.

## 7. Threaded primitive taper

`threaded_box` and `threaded_pin` accept an optional `taper` param.
- `0` → straight cylinder + constant-radius grooves (legacy behavior).
- `0.0625` (1:16) → API standard taper. Box bore widens toward mouth;
  pin OD shrinks toward tip; thread radii follow the local taper.

All API box/pin variants generated through `VARIATION_SPECS` set
`taper: 0.0625` in their defaults.

## 7a. Connection anatomy (collared variants)

`threaded_box_collared` and `threaded_pin_collared` carry the realistic
API connection anatomy — explicit collar, taper transition, and an
optional flush body stub. Stack (bottom → top):

| Section | Length param | OD | Notes |
|---|---|---|---|
| Body stub (optional) | `bodyStubLength` | `od` | Flush with the parent composition's `hollow_cylinder` body. Set 0 for no stub. |
| Taper transition | `taperHeight` | `od` → `collarOD` | Cone. Set 0 for an abrupt step. |
| Collar | `collarLength` | `collarOD` | Straight cylinder where threads are cut. Internal threads for box, external for pin. |

Total part length = `bodyStubLength + taperHeight + collarLength`.

**Mating contract:** a box-collared connection couples with a pin-collared
of the same family — every shared param (`od`, `collarOD`, `taperHeight`,
`collarLength`, `threadCount`, `threadDepth`, `taper`, `wall`) must match
for the pair to engage. The collared primitives share an identical schema
on purpose so the mating check is parameter-equality.

**Degenerate case:** when `collarOD == od` AND `taperHeight == 0` (and
typically `bodyStubLength == 0`), the geometry collapses to a plain
straight cylinder with threads — same as the bare `threaded_box` /
`threaded_pin`. Both forms ship: bare for "minimal" use, collared for
realistic anatomy.

## 8. Drill-pipe tool-joint marking scheme

Per the API drill-pipe identification chart (KB:
`drill-pipe-identification.json`), the tong-area band on each tool
joint carries combinations of grooves and slots that identify the
grade × weight class:

| Grooves | Slots | Wide groove | Means |
|---|---|---|---|
| 0 | 0 | — | STANDARD E75 |
| 1 | 0 | no | STANDARD X95 |
| 2 | 0 | no | STANDARD G105 |
| 3 | 0 | no | STANDARD S135 |
| 0 | 1 | — | HEAVY E75 |
| 1 | 0 | yes | HEAVY G105 |
| 1 | 1 | — | HEAVY HIGH STRENGTH |
| 1 | 1 | — | STANDARD HIGH STRENGTH (slot above groove) |

The `drill_pipe_tool_joint` primitive renders these as
`numGrooves` × circumferential bands + `numSlots` × axial cuts in the
middle third of the joint length. `rules/drill_pipe.ts`
`resolveDrillPipe` looks up the marking by `(weight_class, grade)`.

## 9. What goes in which tier

Decision tree when adding a new entry:

1. **Single ManifoldCAD primitive call?** → Primitive (level 1).
2. **Single-piece body assembled by unioning primitives?** → Composition
   (level 2). Tubing joints, drill-pipe joints, casing joints, window
   joints all belong here.
3. **Multiple installed/moving parts within one physical item?** →
   Component (level 3). Packer (mandrel + element + slips), valve
   (mandrel + sleeve + ports + seal stack), bottom sub (housing + sleeve +
   slips + pins).
4. **Multiple components stacked into a string/installation?** →
   Assembly (level 4). SmartWell completion, BHA, multilateral junction
   stack.

If unsure between 2 and 3: ask "could a service technician install or
remove individual parts of this item separately on the rig floor?" If
yes → 3 (Component). If it ships as one welded/manufactured piece → 2
(Composition).

## 10. Forbidden

- **No dynamic eval of generated code in the browser.** Builder code
  changes happen in `src/lib/components/builder.ts` and require a
  reload. (Plan tasks 9 + 10 cover the spec-MD → codegen pipeline.)
- **No cross-import between domain dirs** — `src/lib/cad/*` and
  `src/lib/wells/*` (when the latter exists) MUST NOT import each
  other. Both may import from `src/lib/shared/*`.
- **No emoji in committed code/docs** unless explicitly requested.
- **No new top-level routes** — everything browsing-related lives in
  `/primitives` (which carries Primitives, Compositions, Components,
  Assemblies, KB). The other top-level routes are `/wells`,
  `/plan`, `/archive/*`.
