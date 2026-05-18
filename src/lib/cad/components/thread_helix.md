# thread_helix — Helical Thread Band

## What this represents

A parametric helical thread band. Single primitive that generates a
spiral ridge in 3D, suitable for subtracting into a body's OD to cut
external threads. Standalone render shows the positive helix so the
tooth shape is visible during authoring; the recipe composition
decides whether to add (thread shown as a positive feature) or
subtract (thread cut into a parent body).

Models any parallel-axis external thread — drillstring tool joints
(API V), casing/tubing (LTC/EUE), production wellhead studs (ACME),
or generic mechanical screws (Square).

## Coordinate convention

Z-down. The thread band sits with its lowest cross-section at z=0
and grows upward (toward the well surface in drillstring use, which
in our convention is LOWER z values — yes, "up" in Z is "shallower"
along the well). Composing into a parent: the parent decides the
band's start position via the recipe's implicit-`top` translation
(set `top: {expr: "p.startOffset"}` on the band instance to offset
it along the parent's axis).

## Composition

- `helix_band(od, length, tpi, depth, profile, taper)` from
  `manifold-helpers.ts` (the underlying primitive)
- Many-wedges approach: a small tooth block placed at each angular
  step along the helix, then unioned. ~24 segments per turn for
  smooth visual; tri count scales with `numTurns * 24`.

## Parameters

| name | default | range | unit | what it controls |
|---|---|---|---|---|
| od | 4.5 | 0.5–12 | in | Outer diameter of the body the thread targets — places the tooth tip just past `od/2` so a subtract leaves a clean cut |
| length | 2 | 0.25–10 | in | Axial length of the threaded band |
| tpi | 4 | 2–16 | (n/a) | Threads per inch — pitch = 1/tpi |
| depth | 0.06 | 0.02–0.25 | in | Radial cut depth into the body wall |
| profile | 0 (Square) | 0–2 | choices | Tooth cross-section: Square (full), V60 (narrow crest), ACME (medium) |
| taper | 0 | 0–5 | deg/side | Thread taper per side — 0 = straight, ~1.78 = NPT pipe taper |

## Z-down note + sign of taper

Taper shrinks the cut depth linearly with z — at z=0 the cut is the
full `depth`, at z=length the cut is `depth - length*tan(taper)`.
This fades the thread out toward the bottom of the band (higher z in
drilling convention). For "fade in from the top" (NPT-style), set
`taper > 0` and the user sees full-depth threads at the top, vanishing
near the bottom.

## Composing into a body

Typical recipe pattern (see `library/test/tube_threaded/part.json`):

```jsonc
"instances": [
  { "name": "BODY", "call": "hollow_cylinder", "args": { … } },
  { "name": "THR",  "call": "thread_helix",    "args": {
      "od":     { "expr": "p.od" },        // match parent OD
      "length": { "expr": "p.threadLen" },
      "tpi":    { "expr": "p.tpi" },
      "depth":  { "expr": "p.threadDepth" },
      "profile":{ "expr": "p.profile" },
      "taper":  { "expr": "p.taper" },
      "top":    { "expr": "p.startOffset" }  // implicit-top translation
    }
  }
],
"composition": [
  { "op": "add",      "of": "BODY" },
  { "op": "subtract", "of": "THR" }
]
```

The `top` arg on `THR` uses the interpreter's implicit-translation
feature so the band's start position is a slider, not a manual mv
chip.

## Performance notes

Tri count scales linearly with `tpi * length` (turns) and quadratically
with body resolution at boolean time. For interactive editing keep
`length × tpi ≤ ~20` (e.g. 2" × 8 TPI = 16 turns) — beyond that the
192+ cube unions begin to dominate rebuild time.

## Validation

None today. Future: warn when `depth >= wall/2` (thread cuts through
the wall) or when `tpi × pitch_axial_extent > 1` (teeth overlap
axially).
