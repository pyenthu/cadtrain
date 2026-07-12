# tubing_hanger_spool_stack — Tubing-Hanger Spool + Hanger Coupling

## What this represents

The **wellhead spool that suspends the production tubing string**.
The Tubing Hanger Spool (THS) flanges between the casing head (lower)
and the Christmas tree (upper); the Tubing Hanger Coupling (THC) is
the union-nut coupling that lets the back-pressure valve (BPV) be
installed without rotating the tree. Sized per API 6A pressure class
(2K · 3K · 5K · 10K · 15K) on each flange independently. Vendor
source: Miracle Industries — *Tubing Hanger Spools and Couplings*.

The spool body lives on the well; the coupling is installed during
BPV / hanger operations. They are conceptually a stack: spool first,
hanger lands inside the bottom-prep counterbore, then the coupling
sits above the hanger to receive the BPV.

## Stack (Z-down — top = lower z)

```
z = 0.0      ┌─ Top flange (small OD — Christmas tree side)
             │  tubing_hanger_spool · z = 0 .. topFlangeThk
z = 1.5      ├─ Neck (body, narrower OD)
             │  tubing_hanger_spool · z = topFlangeThk .. length − bottomFlangeThk
z = 10.25    ├─ Bottom flange (large OD — casing-head side)
             │  tubing_hanger_spool · z = length − bottomFlangeThk .. length
z = 12.0     └─ (bottom of spool, also bottom-prep counterbore lip)

             ↓  bottom-prep counterbore (cut into the bottom face)
             ↓  recess: z = length − bottomPrepDepth .. length, OD = bottomPrepOD
             ↓  Tubing hanger lands here. Hanger isn't a primitive yet (TODO).

             ↑  Above the hanger, the coupling stacks on:
z′ = 0.0     ┌─ Union nut (couplingOD)
             │  tubing_hanger_coupling · z′ = 0 .. nutHeight
z′ = 1.5     ├─ Threaded body (tubingOD + 2·wall)
             │  tubing_hanger_coupling · z′ = nutHeight .. nutHeight+bodyHeight
z′ = 4.5     └─ (bottom of coupling — tubing screws in here)
```

For a unioned render of just the spool + coupling without modelling
the hanger, set the coupling's `tz` to land its top right at the
spool's bottom-prep counterbore depth.

## Primitives used

| Primitive | Purpose in this assembly |
|---|---|
| `tubing_hanger_spool` | The flanged spool body itself — top flange, neck, bottom flange, bottom-prep counterbore. |
| `tubing_hanger_coupling` | The union-nut coupling above the hanger — for BPV installation without rotating the tree. |
| (TODO) `tubing_hanger` | The actual hanger insert that lands in the bottom-prep counterbore. Not yet a primitive — see Open questions. |

## Starter `AuthoredComponent` spec

Defaults match the **THS-7x2.5625-2k** spool + **THC-4.5x2.375**
coupling row pair (most common 2M-class shallow completion).

```jsonc
{
  "id": "tubing_hanger_spool_stack_2k_7x2_5625",
  "name": "Tubing Hanger Spool Stack — 2K / 7-1/16\" × 2-9/16\"",
  "description": "API 6A 2M-class spool + 2-3/8\" EUE coupling. THS-7x2.5625-2k + THC-4.5x2.375.",
  "tags": ["wellhead", "tubing hanger", "THS", "THC", "2K", "API 6A"],
  "version": 1,
  "source": "manual",
  "parts": [
    {
      "id": "spool",
      "kind": "primitive",
      "prim": "tubing_hanger_spool",
      "params": {
        "length": 12.0,
        "topFlangeOD": 2.5625, "topFlangeThk": 1.5,
        "bottomFlangeOD": 7.0625, "bottomFlangeThk": 1.75,
        "neckOD": 4.5,
        "bore": 2.5625,
        "bottomPrepOD": 4.5, "bottomPrepDepth": 1.75
      },
      "transform": { "tz": 0 }
    },
    {
      "id": "coupling",
      "kind": "primitive",
      "prim": "tubing_hanger_coupling",
      "params": {
        "couplingOD": 4.5,
        "tubingOD": 2.375,
        "nutHeight": 1.5,
        "bodyHeight": 3.0,
        "wall": 0.35,
        "threadCount": 8,
        "threadDepth": 0.06,
        "bpvBore": 1.5
      },
      // Coupling sits ABOVE the hanger which lands in the bottom-prep
      // counterbore. With the hanger not yet modelled, place the
      // coupling at spool.length - bottomPrepDepth = 12.0 - 1.75
      // so its bottom matches the prep recess opening.
      "transform": { "tz": 10.25 }
    }
  ],
  "ops": []
}
```

## Variations

Each spool variant pairs naturally with a coupling variant by bore
size. Bind to the catalog rows in `static/kb/api/tubing-hanger.json`.

| Variant | Spool KB row | Coupling KB row | Spool key overrides | Coupling key overrides |
|---|---|---|---|---|
| 2K · 7-1/16" × 2-9/16" | `THS-7x2.5625-2k` | `THC-4.5x2.375` | (defaults above) | (defaults above) |
| 5K · 7-1/16" × 2-1/16" | `THS-7x2.0625-5k` | `THC-4.5x2.375` | `topFlangeOD: 2.0625, bore: 2.0625` | (same) |
| 5K · 9" × 3-1/8" | `THS-9x3.125-5k` | `THC-6.3125x3.5` | `topFlangeOD: 3.125, bottomFlangeOD: 9.0, bore: 3.125, bottomPrepOD: 6.3125` | `couplingOD: 6.3125, tubingOD: 3.5` |
| 5K · 11" × 4-1/16" | `THS-11x4.0625-5k` | `THC-6.875x4.5` | `topFlangeOD: 4.0625, bottomFlangeOD: 11.0, bore: 4.125, bottomPrepOD: 6.875` | `couplingOD: 6.875, tubingOD: 4.5` |
| 10K · 7-1/16" × 2-9/16" | `THS-7x2.5625-10k` | `THC-4.5x2.875` | (defaults — flanges same OD) | `tubingOD: 2.875` |
| 15K · 7-1/16" × 1-13/16" | `THS-7x1.8125-15k` | (no direct EUE match — use `THC-4.5x2.375` for the visual) | `topFlangeOD: 1.8125, bore: 1.8125` | (same) |

## References

- `static/kb/api/tubing-hanger.json` — 11-row KB (7 spool variants + 4 couplings)
- `src/lib/graph/parts/tubing_hanger_spool.ts` — primitive geom
- `src/lib/graph/parts/tubing_hanger_coupling.ts` — primitive geom
- Vendor: https://miracleoilfield.com/tubing-hanger-spools-and-couplings/ (accessed 2026-05-13)

## Open questions / TODOs

- **No `tubing_hanger` primitive yet.** The hanger insert (the
  conical body with seal stack that lands in the bottom-prep
  counterbore) isn't modelled. Once added, the stack diagram should
  insert it between the spool and the coupling, and the coupling's
  `tz` should be `spool.length − hangerHeight − couplingOverlap`
  rather than just `length − bottomPrepDepth`.
- **No `bpv_valve` primitive.** The Back-Pressure Valve that screws
  into the coupling's BPV bore is also implicit; adding it would let
  the assembly render the full installed-state.
- **Pressure-class is metadata only** — the geometry doesn't change
  between 2K / 5K / 10K / 15K (only flange thicknesses do in real
  life, and only `topFlangeThk` / `bottomFlangeThk` are exposed as
  params, not bound to the class). A `pressureClass` lookup param
  on the spool that adjusts the thicknesses (using `choices` style,
  see `slips.splitStart`) would close this.
- **Bolt circles, ring grooves, mounting holes** — none modelled.
  These are the visual cues a wellhead engineer reads first. Adding
  a `flange_face` sub-primitive (BX/R groove + bolt holes) would
  make the spool look like a real wellhead component rather than a
  flanged tube.
