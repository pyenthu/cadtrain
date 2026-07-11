# Wells Sample Corpus — Provenance & the Archetype Registry

> **Scope.** This doc summarizes the canonical SVTC well-sample corpus that feeds
> cadtrain's `/wells` work (TODO **#42i**). It records, per well, the metadata
> the wells pipeline consumes (`td`/`pbtd`/`trajectory`/`reservoirTop`,
> components used vs. missing from the catalogue, and the teaching purpose), plus
> the shape of the three index/registry files and the `deviated/` variant set.
> It also nails down the **provenance caveats** so we always author against the
> right copy.
>
> This is a **documentation snapshot** of an external, read-only source. It does
> not copy the WSON geometry into the repo — only the metadata summary and the
> registry shapes.

## 1. Where the corpus lives (provenance)

- **Canonical:** `~/code/SVTC/.dev-volume/samples/schematics/`
  (i.e. `/Users/neerajsethi/code/SVTC/.dev-volume/samples/schematics/`).
  Contents: **10 `.wson` + 10 `.meta.json`**, `archetypes.json`, `index.json`,
  and a `deviated/` subdir (70 trajectory variants + its own `index.json`).
- **Derivative (do NOT author against):** `~/Desktop/SAMPLE/schematics/` is an
  **incomplete** copy. Relative to the canonical set it is missing at least:
  `02-waterflood-injector.wson`, `03-offshore-dev-scssv-gaslift.meta.json`,
  and `04-horizontal-shale-pnp.meta.json`. It also carries stray, non-canonical
  files (`Mooz_S-3_PCM_PCP_completion_report…`, timestamped one-offs, an
  `xlsxtowson/` dir).
- ⚠️ **Never run `git` under `~/Desktop`** — it is iCloud-synced and git there
  corrupts `.git` (memory `icloud_desktop_unsafe`). Both trees above are
  **read-only** for our purposes; author only into the cadtrain repo
  (`src/lib/wells/samples/`), never into SVTC or Desktop.

### 1.1 The `01-vertical-land-producer` trap — two files, NOT the same well

The canonical and Desktop copies of `01-vertical-land-producer.wson` are
**different wells**:

| Copy | Geometry | `.meta.json` says | Correct? |
|---|---|---|---|
| **SVTC** `01-vertical-land-producer.wson` | no `profile` block → **truly vertical** | `trajectory: "vertical"` | ✅ consistent |
| **Desktop** `01-vertical-land-producer.wson` | an **11-station `profile` survey** building `dev` 0 → **38°** by MD 535 m, then holding 38° | `trajectory: "vertical"` | ❌ **meta is wrong** — geometry is deviated |

The Desktop `01` is "the same well **plus** a deviated survey", but its `.meta.json`
was never updated, so anyone trusting the meta gets a vertical label on deviated
geometry. **Use SVTC for both rungs.** SVTC keeps the deviated variant *properly
separated* under `deviated/01-vertical-land-producer-J-medium.wson`, so the pair
`01-vertical-land-producer.wson` (vertical) + `deviated/…-J-medium.wson`
(deviated) is exactly the **S2 → S4 ladder step**: identical `oh` / `ch` /
`cementing`, differing **only** in the `profile` (survey) block.

## 2. Per-well summary (from each `.meta.json`)

All depths in **metres**. `traj` = `trajectory`; `resTop` = `reservoirTop`.
`missing` = count in `components_missing_from_catalogue` (parts that must render
as placeholders / MISC.TUBING today).

| # | archetype (slug) | td | pbtd | traj | resTop | used | missing |
|---|---|---:|---:|---|---:|---:|---:|
| 01 | vertical-land-producer | 1070 | 1062 | vertical | 1040 | 6 | 0 |
| 02 | waterflood-injector | 1200 | 1195 | vertical | 1170 | 6 | 0 |
| 03 | offshore-dev-producer-scssv-gaslift | 2500 | 2490 | vertical | 2430 | 8 | 0 |
| 04 | horizontal-shale-plug-and-perf | 3500 | 3490 | horizontal | 2050 | 5 | 0 |
| 05 | esp-producer | 1800 | 1790 | vertical | 1750 | 3 | 7 |
| 06 | gas-lift-unloaded-producer | 2000 | 1990 | vertical | 1950 | 8 | 0 |
| 07 | deepwater-subsea-dual-barrier | 3500 | 3490 | vertical | 3300 | 8 | 2 |
| 08 | horizontal-multistage-frac-appraisal | 5731.2 | 5731.2 | horizontal | 4736.6 | 12 | 8 |
| 09 | hpht-completion | 4500 | 4490 | vertical | 4450 | 8 | 0 |
| 10 | co2-injector | 2200 | 2190 | vertical | 2150 | 8 | 0 |

## 3. Per-well detail

Each `.meta.json` carries
`{ archetype, title, description, well{td,pbtd,trajectory,reservoirTop},
components_used, components_missing_from_catalogue, suitable_for }`.
Well 08 additionally carries a `source{}` block (real-world provenance).
Fields captured below verbatim from the canonical `.meta.json`.

### 01 · vertical-land-producer
- **Title:** Vertical Land Producer (3-string casing, 1070 m)
- **Well:** td 1070 · pbtd 1062 · trajectory `vertical` · reservoirTop 1040
- **components_used:** Tubing Hanger · Tubing Joints · R Landing Nipple · Tubing Pup · Production Packer (Baker Permanent) · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** beginner-friendly onshore completion; teaches AI the basic 3-string pattern

### 02 · waterflood-injector
- **Title:** Waterflood Injector (3-string casing, 1200 m)
- **Well:** td 1200 · pbtd 1195 · trajectory `vertical` · reservoirTop 1170
- **components_used:** Tubing Hanger · Tubing Joints · R Landing Nipple · Tubing Pup · Production Packer (Baker Permanent) · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** teaches AI the waterflood injector archetype: 3-string casing with packer isolation above the injection perforations and no SCSSV

### 03 · offshore-dev-producer-scssv-gaslift
- **Title:** Offshore Development Producer with SCSSV + Gas Lift (4-string casing, 2500 m)
- **Well:** td 2500 · pbtd 2490 · trajectory `vertical` · reservoirTop 2430
- **components_used:** Tubing Hanger · Tubing Joints · TRSSSV Flapper (SCSSV) · Side Pocket Mandrel (×3 gas-lift) · R Landing Nipple · Tubing Pup · Production Packer (Baker Permanent) · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** teaches AI the offshore artificial-lift archetype: 4-string casing, SCSSV near surface, multi-valve gas-lift string, and packer isolation above the reservoir

### 04 · horizontal-shale-plug-and-perf
- **Title:** Horizontal Shale Producer — Plug-and-Perf (3500 m MD)
- **Well:** td 3500 · pbtd 3490 · trajectory `horizontal` · reservoirTop 2050
- **components_used:** Tubing Hanger · Tubing Joints · R Landing Nipple · Tubing Pup · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** teaches AI the plug-and-perf horizontal shale pattern: multi-stage perforations in the lateral, tubing hung in the vertical section above the KOP, no packer in the lateral, cement liner overlap across the heel

### 05 · esp-producer
- **Title:** ESP-equipped Vertical Producer (1800 m TD)
- **Well:** td 1800 · pbtd 1790 · trajectory `vertical` · reservoirTop 1750
- **components_used:** Tubing Hanger · Tubing Joints · Perforated Pup
- **components_missing_from_catalogue:** Y-Tool · ESP Discharge Head · ESP Pump · ESP Gas Separator / Intake · ESP Seal · ESP Motor · Motor Lead Extension (MLE)
- **suitable_for:** teaches AI how to represent artificial-lift ESP completions: 7 components don't exist in the catalogue and must be rendered as MISC.TUBING placeholders with descriptive labels; tubing is shorter than TD to land the ESP stack below; perforated pup acts as tail pipe below the motor

### 06 · gas-lift-unloaded-producer
- **Title:** Gas-Lift Unloaded Producer (3-string casing, 2000 m)
- **Well:** td 2000 · pbtd 1990 · trajectory `vertical` · reservoirTop 1950
- **components_used:** Tubing Hanger · Tubing Joints · TRSSSV Flapper (SCSSV) · Side Pocket Mandrel (×3 gas-lift unloading + operating) · R Landing Nipple · Tubing Pup · Production Packer (Baker Permanent) · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** teaches AI the onshore artificial-lift gas-lift archetype: progressive unloading valves at multiple depths with deepest acting as operating valve, SCSSV near surface, small (3-1/2") tubing typical for gas-lift wells

### 07 · deepwater-subsea-dual-barrier
- **Title:** Deepwater Subsea Dual-Barrier Producer (5-string + liner, 3500 m)
- **Well:** td 3500 · pbtd 3490 · trajectory `vertical` · reservoirTop 3300
- **components_used:** Tubing Hanger · Tubing Joints (5-1/2") · TRSSSV Flapper (Barrier #1 SCSSV) · Liner Hanger · R Landing Nipple · Tubing Pup · Production Packer (Barrier #2 Baker Permanent) · Mule Shoe
- **components_missing_from_catalogue:** Subsea Tree (surface - out of schema) · Liner Hanger (no SVG file in compjson)
- **suitable_for:** teaches AI the deepwater subsea dual-barrier archetype: 5-string casing design with production liner, two independent pressure barriers for regulatory compliance (API RP 96 / NORSOK D-010), large-OD tubing, shallow SCSSV and deep set packer isolating the reservoir

### 08 · horizontal-multistage-frac-appraisal
- **Title:** Horizontal Multi-Stage Frac Appraisal Well (Aramco HRDH-797 K-2)
- **Well:** td 5731.2 · pbtd 5731.2 · trajectory `horizontal` · reservoirTop 4736.6
- **source:** Saudi Aramco (operator) / Halliburton (contractor) · field Ghawar / Unayzah C · well HRDH-797_1, K-2 Horizontal Appraisal Well · originalUnits **feet** (converted to m at 1 ft = 0.3048 m) · schematic dated 2014-05-12 · BHT ~288 °F at 15,105.1 ft TVD · 12 frac stages / 24 perf clusters along a 3,262 ft lateral
- **components_used:** Tubing Hanger · Tubing Joints (4-1/2 15.1 ppf Q-125 VTHC) · Halliburton DV-Packer Tool (13-3/8) · Halliburton DV Tool (9-5/8) · VersaFlex Upper PBR · HES VersaFlex Liner Hanger · R Landing Nipple (3.688) · Locator/Seal Assy · Lower PBR · Mule Shoe · Marker Pup Joint · Milled Window (5-7/8 in 7 liner)
- **components_missing_from_catalogue:** Halliburton DV-Packer Tool (13-3/8) · Halliburton DV Tool (9-5/8) · VersaFlex Upper PBR · HES VersaFlex Liner Hanger (uses `liner_hanger_red` reference — no SVG) · Locator/Seal Assy · Lower PBR · Marker Pup Joint · Milled Window
- **suitable_for:** teaches AI the deep horizontal multi-stage frac archetype: 7-string casing design, high number of perf clusters in a single lateral, DV tools for stage cementing, PBR/VersaFlex liner systems, and multi-component completion string

### 09 · hpht-completion
- **Title:** HPHT Gas-Condensate Producer (5-string + liner, 4500 m)
- **Well:** td 4500 · pbtd 4490 · trajectory `vertical` · reservoirTop 4450
- **components_used:** Tubing Hanger · Tubing Joints (5-1/2" 13Cr-95) · TRSSSV-SP (HPHT SCSSV, Barrier #1) · Gauge Mandrel (downhole P/T) · R Landing Nipple · Tubing Pup · Packer AHR-AHC (HPHT permanent, Barrier #2) · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** teaches AI the HPHT archetype: exotic 13Cr/Q-125 metallurgy across all strings, 5-string casing design with 7" production liner overlap, dual-barrier isolation (SCSSV + deep-set HPHT packer), downhole gauge mandrel for real-time pressure/temperature surveillance, no artificial lift because reservoir pressure is self-flowing

### 10 · co2-injector
- **Title:** CO2 Injector for CCS (4-string casing, 2200 m, full-length cement)
- **Well:** td 2200 · pbtd 2190 · trajectory `vertical` · reservoirTop 2150
- **components_used:** Tubing Hanger · Tubing Joints (4-1/2" 13Cr-95) · SSD Sliding Sleeve (circulation / well-kill) · R Landing Nipple · Tubing Pup · Baker Permanent Packer · Perforated Pup (tail-pipe filter) · Mule Shoe
- **components_missing_from_catalogue:** *(none)*
- **suitable_for:** teaches AI the CCS CO2-injector archetype: corrosion-resistant 13Cr metallurgy across tubulars (CO2 + water → carbonic acid), mandatory full-length cement on every casing string for regulatory leak-tight isolation, sliding sleeve substituted for SCSSV in typical CCS designs, perforated tail-pipe ahead of injection zone, permanent packer above the injection interval

## 4. Registry & manifest file shapes

### 4.1 `archetypes.json` — natural-language → WSON registry

Its own `_comment` labels it **"TODO #20 Layer A"**: a natural-language →
WSON archetype registry. `createFromArchetype` looks up by **slug OR any alias**
(case-insensitive substring match), loads the template, applies user overrides,
and writes a new file. The `_comment` notes B1 supports overriding `wellName`,
`td` (scales all depths), and `reservoirTop`.

This is the deterministic layer that **#42d** (WBG Wizard / Auto Design) and the
local-first AI work (**#0**) both want — "make me a horizontal shale producer"
without an LLM inventing geometry.

**Shape** — `{ _comment, archetypes: Archetype[] }`, each `Archetype`:

```jsonc
{
  "slug": "horizontal-shale-plug-and-perf",   // stable id
  "title": "Horizontal Shale Producer (Plug-and-Perf)",
  "template": "04-horizontal-shale-pnp.wson", // sibling .wson filename
  "aliases": ["horizontal producer", "shale producer", "plug and perf", …],
  "defaults": { "td": 3500, "trajectory": "horizontal", "reservoirTop": 2050 }
}
```

> **Alias-resolution caveat (found while porting).** Aliases overlap as
> substrings **on purpose** — bare `"producer"` on archetype 01 is a catch-all
> that `"shale producer"` (04) must be able to override — so a correct resolver
> must let the **most specific (longest) matching alias win**, not first-match.
> There is also **one genuine cross-archetype collision** in the canonical data:
> `"gas-lift producer"` is listed under **both** 03 (`offshore-…-gaslift`) **and**
> 06 (`gas-lift-unloaded-producer`), so that exact phrase is ambiguous. Both facts
> are pinned by `archetypes.test.ts`.

The 10 slugs (in file order) match the 10 wells in §2/§3: `vertical-land-producer`,
`waterflood-injector`, `offshore-dev-producer-scssv-gaslift`,
`horizontal-shale-plug-and-perf`, `esp-producer`, `gas-lift-unloaded-producer`,
`deepwater-subsea-dual-barrier`, `horizontal-multistage-frac-appraisal`,
`hpht-completion`, `co2-injector`. Every `template` points at the matching
`NN-…​.wson`; every `defaults` mirrors that well's `well.td` / `well.trajectory` /
`well.reservoirTop`.

### 4.2 `index.json` — the `{wson, meta}` manifest

Flat manifest pairing each schematic with its metadata sidecar:

```jsonc
{
  "_comment": "Manifest of schematic templates. Update when adding new archetypes …",
  "templates": [
    { "wson": "01-vertical-land-producer.wson", "meta": "01-vertical-land-producer.meta.json" },
    …  // 10 entries, one per well
  ]
}
```

### 4.3 `deviated/` — trajectory-variant expansion

`deviated/` holds **70 WSON files** = 10 base wells × **7 trajectory variants**,
plus its own `deviated/index.json`. Naming is `<base-stem>-<shape>-<band>.wson`:

- **shape** ∈ `{ J, S }` (J-shape build-and-hold; S-shape build-drop-build).
- **band** ∈ `{ low, medium, high }` for both shapes, plus **`J-horizontal`**
  (the horizontal band exists only for the J shape) → `J-{low,medium,high,horizontal}`
  + `S-{low,medium,high}` = 7 per well.

`deviated/index.json` (`{ generatedAt, variants: [...] }`) records, per variant:
`{ filename, wellName, td, shape, band, base }` where `base` is the source
`NN-…​.wson`. Example: `01-vertical-land-producer-J-medium.wson` →
`{ shape: "J", band: "medium", td: 1070, base: "01-vertical-land-producer.wson" }`.
Note some variants re-derive `td` (e.g. `01…-J-horizontal` lengthens td to 1445).

The `deviated/…-J-medium.wson` files are the ones the repo's own S4 ladder step
uses as the deviated reference (see `src/lib/wells/samples/13-vertical-land-producer-deviated.wson`,
shipped `46b29fe`).

## 5. What the corpus feeds (downstream consumers)

- **`components_used`** across the 10 wells is the seed component list for **#42d**'s
  catalog picker and for **#42c**'s `bw_*` build order. (TODO #42i notes ~32
  distinct component labels across the corpus.)
- **`components_missing_from_catalogue`** flags what still needs real parts — it
  overlaps `#42j` (registry keys that silently fall back to a plain `g_tube`:
  `MISC.SIDE_POCKET_MANDREL`, `liner_hanger_red`, `MISC.PUP_PERF`) and `#42f`
  (the 4 imported placeholder well elements).
- **`archetypes.json`** is the deterministic NL→WSON layer for **#42d** / **#0**.

## 6. Snapshot provenance

Summarized from the canonical source on **2026-07-11**. Source of record remains
`~/code/SVTC/.dev-volume/samples/schematics/` — if that changes, re-derive this
doc rather than editing values here by hand. A typed, tested snapshot of
`archetypes.json` also lives at `src/lib/wells/archetypes.ts` (see §7).

## 7. Typed snapshot — `src/lib/wells/archetypes.ts`

The archetype registry is mirrored as a typed data module,
`src/lib/wells/archetypes.ts`, with a shape/lookup unit test
(`src/lib/wells/archetypes.test.ts`). It is a **standalone data module** — it
imports nothing from and is imported by nothing in the existing wells code (the
registry has no consumer yet; **#42d** is unbuilt), so it cannot destabilize the
build. It exposes:

- `WELL_ARCHETYPES: readonly WellArchetype[]` — the 10 entries, typed.
- `findArchetype(query): WellArchetype | undefined` — the same slug-or-alias,
  case-insensitive substring lookup `createFromArchetype` documents, so #42d can
  build on a tested resolver instead of re-implementing it.

It is a snapshot: if `archetypes.json` upstream changes, re-run the port. The
`template` field names the sibling `.wson`; not all templates exist under the
repo's `src/lib/wells/samples/` yet, so treat `template` as a reference label
until #42d wires template resolution.
