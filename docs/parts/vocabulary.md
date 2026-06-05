# cadtrain part vocabulary

A compositional grammar for drill-string parts. The canonical source is `vocabulary.json` (machine-readable); this file is the human read-through.

Every term is one of:

- **Primitive** — a leaf revolve/extrude part defined by a `template` + `engine`.
- **Composition** — combines OTHER terms via `imports` + a `composition` tree (the K.62 IR).

The translator (Phase 2, `src/lib/authoring/rule-translator.ts`) compiles each rule into a `.rev.ts` or `.asm.ts` source. The translator is deterministic — no LLM. LLM tiers (L4 WebGPU / L5 Claude) produce a RULE conforming to this schema, then the translator handles correctness.

## Terms (v0.1.0)

| term | kind | rule kind | inherits | exemplar | bake (verts · z · outer-r) |
|---|---|---|---|---|---|
| **shaft** | rev | primitive (cylinder) | — | dt_shaft | 258 · 3.0 · 1.0 |
| **tube** | asm | compose (A.subtract(B)) | shaft × 2 | dt_tube | 1536 · 3.0 · 2.25 |
| **collar** | rev | primitive (collar_flat) | — | dt_collar | 512 · 1.5 · — |
| **pin** | rev | primitive (dp_spec_pin) | shaft | dt_pin | 1344 · 9.625 · 2.625 |
| **box** | rev | primitive (dp_spec_box) | tube | dt_box | TBD |
| **joint** | asm | compose (box→tube→pin) | box + tube + pin | dt_joint | TBD |
| **stand** | asm | repeat (N × joint) | joint | dt_stand | TBD |

### shaft — the primitive
> Cylindrical profile, half-section (r, len). The atomic primitive — every other rotational shape extends this.

Synonyms: cylinder, solid rod, round bar.

### tube — composition
> Open tube — a smaller shaft subtracted from a larger shaft. Outer radius = `od/2`; inner radius = `od/2 - wall`.

Synonyms: pipe, hollow shaft, open cylinder.

Rule: `tube(od, wall, length) = shaft(r=od/2, len=length) .subtract( shaft(r=od/2 - wall, len=length) )`

### collar — primitive with stepped OD
> Locally-larger OD over a portion of length, revolved. A flange / shoulder / sleeve.

Synonyms: flange, shoulder, sleeve, ring.

### pin — male connection
> Male tapered connection — shaft body + upset joint shoulder + tapered nose. Used as the male end of a tool joint.

Synonyms: male connection, tapered pin, drill-pipe pin.

Extends: shaft.

### box — female connection (complement of pin)
> Female complement of pin — counterbored receptacle; the female end of a tool joint mating with a pin.

Synonyms: female connection, box-end, drill-pipe box.

Extends: tube.

### joint — unit drill-pipe joint
> A box + tube body + pin stacked end-to-end via `tail()` datums. The unit drill-pipe joint.

Synonyms: tool joint, pipe joint, drill-pipe joint, single.

Rule: `joint(od, wall, body_len) = [ box(), mv(tube(od, wall, body_len), [0,0,tail(box)]), mv(pin(), [0,0,tail(tube)]) ]`

### stand — N joints stacked
> N joints stacked end-to-end via `tail()` — typically 3 for a "triple" stand.

Synonyms: triple, drill-pipe stand.

Rule: `stand(n, od, wall, body_len) = Array.from({length:n}, (_,i) => mv(joint(od, wall, body_len), [0,0,prev.tail]))`

## How a description gets translated

User describes: *"drill pipe pin, 4 1/2" OD, NC50 thread"*

1. **L1 vocabulary lookup** — "pin" matches term `pin` directly. Synonym map also catches "drill-pipe pin", "tapered pin", "male connection".
2. **Parse the modifiers** — "4 1/2" OD" → `pipeOD: 4.5` (or maybe `jointOD: 4.5` depending on context). "NC50 thread" → thread spec (separate KB; not yet wired).
3. **Translator runs** — pin's `rule.primitive` template (`dp_spec_pin`) + filled param map → emit `.rev.ts` source.
4. **Bake** with default params → render in supervision panel preview.
5. **Supervisor (you) reviews** → Accept (Y) caches to L2 → done.

## Open questions to resolve in Phase 2

- **`expects_bake` for box / joint / stand**: TBD until the translator runs them. The first translator pass populates these.
- **Param namespacing in compose rules** — **DECIDED 2026-06-05 (Q1)**: HIDDEN. Box / Pin / Tube's deep params (pipeOD, jointOD, jtUpset, jointTaper, threadTaper, …) stay as STATIC defaults inside the joint's rule — NOT lifted to `joint.params`. Joint exposes only `{od, wall, body_len}`. Same for stand. Deep-dial overrides go through editing the joint's rule (which is itself an authored part you can edit), not through assembly-level params. Encoded as `param_lifting: "hidden"` on `joint` and `stand`.
- **Profile params vs assembly params**: `pin.rule.profile_params_map` is the bridge. Translator needs to honour it correctly.
- **Thread specs (NC50, NC46, …)**: not in vocabulary yet. Separate KB (probably `docs/parts/thread_specs.json`).
- **Synonym embeddings**: L1 is exact + synonym list match for v0.1. L2 takes over for fuzzy/semantic matching once embeddings are wired.
