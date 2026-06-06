# `src/lib/authoring/` — vocabulary → source compilers

Deterministic compilers that turn structured vocabulary entries into
runnable `.prim.ts` / `.asm.ts` source. **No LLMs in this directory** —
every transform is pure JS code that can be diffed, locked, and re-run.

```
src/lib/authoring/
├── rule-translator.ts        # K.68 — translate a vocabulary.json term → .rev.ts / .asm.ts
├── proposal-translator.ts    # K.69 — translate a proposed-vocab-entries.json entry (boolean_modify kind)
└── compjson-to-profile.ts    # K.69 — 2D drawing → r_revolve polygon (half-section inference)
```

## Why this layer exists

The generative-AI / RAG-then-translate pipeline (Rule 24) needs a
**deterministic core** in the middle: vocabulary → translator → source.
LLMs may propose vocab terms above this layer; the WebGPU LLM may
fill in gaps below; but the translator itself is pure code, so:

- Same vocab + same translator → same source (idempotent, lock-able).
- Drift is detectable: hash the translator output, compare to the locked hash.
- The LLM never has to write `.prim.ts` syntax — it composes rule
  primitives in a constrained grammar and the translator emits code.

## `rule-translator.ts` — K.68 vocabulary.json compiler

Entry: `translate(termId, vocab)` returns a source string.

Three rule kinds (`vocabulary.schema.json`):

- **`kind: 'primitive'`** — single revolved body. Two sub-templates:
  - `template: 'cylinder'` — fixed shaft profile.
  - `template: 'polygon_inline'` — explicit `(r, z)` polygon + optional
    `preamble[]` of `const` lines (e.g. `const ri = pipeOD/2 - wall;`).
- **`kind: 'compose'`** — assembly. Imports other terms by alias + composes
  via a TreeNode (`call`, `method`, `list`, `stack`, `mv`).

Emits a function named `<termId>` with positional params in
`meta.params` declaration order, plus a `meta` block with `id`,
`uses` (the `r_*` dependencies), and `generated_from` (provenance:
term, vocab_version, rule_hash).

## `proposal-translator.ts` — K.69 boolean_modify compiler

Entry: `translateProposed(termId, entry)` from
`docs/parts/proposed-vocab-entries.json`.

Adds a fourth rule kind on top of rule-translator's three:

- **`kind: 'boolean_modify'`** — revolved body + CSG modifier chain.
  - `body` is a standard `polygon_inline` primitive (preamble + polygon
    expressions).
  - `modifiers[]` is an ordered list of `{ op, shape }` where `op` is
    one of `subtract` / `add` / `intersect` and `shape` is a named
    primitive from a small fixed set.

Supported shape kinds:

- **`tilted_slab`** — rectangular slab whose top face is the cut plane,
  rotated around an axis (`tilt_axis: 'x'|'y'|'z'`) by `tilt_angle_deg`
  (number or param-name string), anchored at `anchor_z`. The slab's body
  falls into one half-space so `subtract` carves only that wedge (no
  engulf-everything bug from a centered cube — the body is NOT centered
  through origin). First use: `mule_shoe`'s 45° angled bottom cut.

Future shape kinds (placeholder slots, not yet implemented):
`cylindrical_hole_ring` (port subs), `thin_slot_ring` (slotted liners),
`lateral_pocket` (side-pocket mandrels), `j_slot_grooves` (indexing).

Why this matters for K.68 generative AI: the LLM proposes shape
kinds from a fixed vocabulary rather than hand-crafting source. One new
shape kind = a multiplier across many parts.

## `compjson-to-profile.ts` — K.69 deterministic 2D→3D inference

Entry: `inferProfile(doc, opts)` returns `{ polygon, internal_features,
warnings, bbox, axisymmetric, scale_in_per_px }`. Auxiliary:
`inferredToRevSource(termId, inferred, opts)` emits a runnable `.rev.ts`.

The SVTC compjson drawings (DrawingML-extracted polyline JSON in
`static/svtc-compjson/`) are **half-section views**: LEFT half is the
section cut (bore + internal seats), RIGHT half is the OD silhouette.
For axisymmetric tubular parts the section element IS the half-section
profile; the inference:

1. Classify elements by half-x (left = section, right = outer, fullspan
   = background).
2. Pick the dominant section element (largest polygon by area).
3. Transform: `r = (centerline - x) * scale`, `z = y * scale`. Centerline
   vertices → `r = 0`. Tiny-negative `r` clamped to 0 (float drift).
4. Calibrate `scale = (od_in / 2) / odPx` from the seed's catalogue OD.
5. Detect internal features (yellow=seat, red=mark, black=elastomer)
   as sub-polygons for compose-layer follow-ups.

Tested live: `mule_shoe` (5-vert chamfered tip), `tubing_pup`
(4-vert cylinder), `flow_coupling` (4-vert cylinder),
`nipple_r_landing` (16-vert profile — auto-captures **4 landing
grooves on the OD** as alternating r-bands). Pure geometric inference;
no GenCAD, no DeepCAD, no model weights.

## Rules for Claude (when editing in this directory)

1. Never add LLM calls here. The translators are pure code on purpose.
   If a rule kind can't be deterministically compiled, that's a vocab
   schema gap to fix above, not an "ask Claude" step inside.
2. Keep the emitted source style consistent with existing volume parts:
   `meta.params` block (with `default`/`min`/`max`/`step`/`unit`), `??=`
   default fallbacks in the function head, named instances for the
   sidebar visibility rule (Rule 20).
3. Hash inputs deterministically (djb2 over the rule JSON) so
   `vocabulary.lock.json` can detect drift.
4. New shape kinds in `proposal-translator.ts` get a documented entry
   above + an emitter function. Keep the emitter as a sandbox-legal IIFE
   so the runtime injection doesn't break (see `tilted_slab` as the
   template).
5. When `compjson-to-profile.ts` flags `axisymmetric: false`, prefer
   surfacing the warning in `/vocab` over silently extrapolating —
   non-axisymmetric features (side ports, J-slots) need composition,
   not just a revolve.
