# Profiles directory — a structured parametric profile-function library (2026-05-24)

> Goal: cylindrically-symmetric parts become **pick a parametric profile
> function → `r_revolve`**, never hardcoded points. A profile = `params → (r,z)
> half-section`. Two tiers (curated `src` + user `volume`) behind one catalog.
> Kills the manual patchwork (e.g. dp_ball's baked `revolve2` point list).

## The model
A **profile function** is the parametric basis of a revolve part:
```ts
interface ProfileDef {
  id: string; label: string;
  set: 'revolve' | 'cartesian';   // revolve (r≥0 half-section) is the focus
  tags: string[];
  params: Record<string, { label; min; max; step; default; unit? }>;
  build: (p: Record<string, number>) => [number, number][];   // → (r,z) points
}
```
This already exists in `src/lib/shared/profile-presets.ts` → `PROFILE_REGISTRY`
(`cylinder`, `tube`, `cone`, `barrel`, `drill_pipe_pin`, `drill_pipe_box`). Even
a cylinder is a profile (`[[0,0],[r,0],[r,len],[0,len]]`). That's tier 1.

## Two tiers, one catalog
| Tier | Where | Authoring | Resolve |
|---|---|---|---|
| **Curated** | `src` `PROFILE_REGISTRY` | code (PR + rebuild) | sync, in-process + injected into the sandbox (`resolveProfile`) |
| **User / custom** | volume `primitives/profiles/<id>/` | in-GUI, no rebuild | server sandbox runs `build(p)` → points (async, endpoint pre-resolution) |

Volume profile dir (mirrors directory-per-part, Rule 18; `primitives/profiles/`
is invisible to the primitive list/source resolvers — they require `source.ts`
under `basic/industrial/completions`, and only recurse those):
```
primitives/profiles/<id>/
  profile.json   // { id, label, set, tags, params }  (the schema + metadata)
  source.ts      // export function build(p) { ... return [[r,z],…]; }   (P3)
```
A *configured* save (P2, already shipped) is `{ kind, params }` or `{ points }`;
a *function* profile (P3) adds `source.ts` with a sandboxed `build`.

The **catalog** = `/api/primitives/profiles/list` (already exists) merged with
`PROFILE_REGISTRY`; volume shadows src on id collision. Surfaced by the
searchable profile dropdown (already merges src + volume).

## Resolution (the one subtlety)
`resolveProfile(descriptor)` is pure + sync + injected into the primitive
sandbox — it can only resolve **src** kinds in-body. A **volume function**
profile's `build` is user code, so:
- the **list/preview endpoints pre-resolve** volume-function descriptors to
  points (run `build` in a sandbox server-side) before dispatch — the primitive
  body still receives plain points. Mirrors profile-system.md "Refined
  implementation".
- the sandbox for `build`: a pure `(p) => Pt[]` with only `Math` in scope (no
  Manifold needed — it returns points, not geometry). Far smaller surface than
  the primitive sandbox; deny `require`/`process`/`import`/`eval`.

## Quick-create: "revolve part from profile"
A one-click path so you never compose manually: from the profile catalog (or a
sidebar `+`), pick a profile function → scaffold a part whose `geom` is
`const p = r_revolve(resolveProfile({kind:'<id>', params:{…}}), 96); return p;`
with the profile's params lifted to the part's params (so the part is born
parametric — no baked points). This is what removes dp_ball-style patchwork.

## Phasing
- **P0 (done)** — tier-1 `PROFILE_REGISTRY` revolve functions (cylinder/tube/
  cone/barrel/drill_pipe_pin/box) + the searchable dropdown + 2-col draggable
  params.
- **P1 — grow tier 1**: more curated revolve profile functions (casing/tubing
  couplings, packer mandrel, x-over, …) in `src`. Cheap, high value.
- **P2 (endpoints done)** — volume `primitives/profiles/` list/save for
  *configured* profiles; "+ save" in the popup. Confirm the dropdown lists them.
- **P3 — volume *function* profiles**: `source.ts` `build(p)` per profile dir;
  a pure-function sandbox; endpoint pre-resolution; an in-GUI editor (params +
  build body) to author a profile function without a rebuild.
  - **P3a (done — `7d1eba8`)**: the resolver. `src/lib/server/profile-fn.ts`
    (`buildProfileFromSource`) — import-strip + esbuild ts→cjs + `new Function`,
    points-only (Math + params), denylist (require/process/Function/eval/fetch/
    `import(`) + ≥3-point shape guard. `profiles/list` runs `build(defaults)` →
    preview `points` (broken build → `buildError`, still listed). GUI pick path
    already bakes `v.points` → r_revolve. Seed: `primitives/profiles/casing_coupling`.
  - **P3b (done — `f0a6575`)**: in-GUI authoring. `ProfileFnEditor.svelte` (ƒ+
    in the leaf profile popup) — params SCHEMA editor + build(p) body + a live
    preview that round-trips `/api/primitives/profiles/resolve` ({source|id,
    params}→points; the server-side re-resolve path, since `resolveProfile` is
    sync/client/curated-only). `profiles/save` accepts {source, params:<schema>},
    validates build(defaults) before persisting, writes source.ts. On save the
    profile joins the palette (ƒ badge) and is auto-picked into the leaf. GUI-
    verified: author→preview(live)→save→pick→Apply bakes (5-vert taper, in sync).
- **P3c (done) — edit-existing function profiles**: `✎` on a ƒ entry in the
  palette dropdown opens `ProfileFnEditor` seeded from it (params + build body
  via `/api/primitives/profiles/source?id=`); Save overwrites by id = update.
  No `profiles/custom` dir — the volume `primitives/profiles/` already IS the
  custom store.
- **P4 (done) — quick-create**: "revolve part from profile" in the New-primitive
  popup. Pick a curated revolve profile FUNCTION (`profile:<kind>`) → scaffolds a
  part whose params ARE the profile's params (lifted), source =
  `r_revolve(resolveProfile({kind, params:{…the part's args}}), 96)`. Born
  parametric (E lift). resolveProfile is injected into the sandbox; curated kinds.

- **P5 (NEXT — function-first profiles, eliminate vertices).** Direction
  (2026-05-25): EVERY profile is a function (params → points), even simple shapes
  — a rect is a function of axial offset + side offsets of length/height; a
  cylinder is `r,len`. The hand-drawn VERTEX editor becomes secondary/removed; a
  points list is only ever a function's OUTPUT, never the authored thing.
  Rationale: parametric means functions define everything, and a function is far
  easier to modify in a structured way than a vertex soup. Curated
  `PROFILE_REGISTRY` + volume `ƒ` profiles already ARE functions — make it
  universal: default the profile popup to function mode, demote/retire the
  drag-vertex `ProfileEditor`, and ensure every primitive's profile arg is a
  `{kind|source, params}` function descriptor (points only as a resolved cache).

- **P6 (NEXT — profiles ARE part-like source: `meta` + `build`).** Direction
  (2026-05-25): a profile should be structurally identical to a part — ONE
  `source.ts` with `export const meta = { id, label, set, tags, params }` +
  `export function build(p) { return [[r,z],…]; }` — and edited the SAME way
  (Source tab + the params panel + AI refine), not a bespoke params-grid +
  body-textarea. Volume ƒ profiles are 90% there (profile.json = meta, source.ts
  = build); unify into ONE source (parse meta from the source like parts do).
  MIGRATE the curated kinds (cylinder/tube/cone/barrel/drill_pipe_pin/box) into
  this `source.ts` form so they're GUI-editable instead of hardcoded.
  - **Blocker to resolve here**: a part's `resolveProfile({kind})` resolves only
    CURATED kinds in-sandbox (sync). For an EDITED (source) profile to drive a
    part, either (a) the bake pre-resolves the profile's `build(partParams)`
    server-side (the deferred Approach-2 plumbing), or (b) inline the build into
    the part's source. The user chose the "function editor + library" model
    (option 2), which implies (a). · Curated stays the fast built-in tier; new/
    edited ones are source profiles. · Keep the picker (regression fix 23df4ae).

## Critical files
- `src/lib/shared/profile-presets.ts` — tier-1 registry + `resolveProfile` (sync).
- `src/routes/api/primitives/profiles/{list,save}/+server.ts` — volume tier (P2 done; P3 adds source.ts + sandbox-run).
- `src/lib/shared/ProfilePalette.svelte` — the searchable catalog (merges tiers).
- `src/lib/shared/PrimitiveView.svelte` — profile popup (param controls, +save) + the quick-create entry.
- a new pure-function sandbox for volume `build(p)` (P3) — small, points-only.

## Risks
- Volume `build` is user code → sandbox carefully (points-only, denylist). Async
  resolution means the list/preview endpoints, not `resolveProfile`, expand
  volume functions. · Don't let `primitives/profiles/` leak into the primitive
  list (it doesn't today — resolvers require `source.ts` under the recursed
  category dirs). · Keep `set:'revolve'` the focus; cartesian extrude profiles
  ride along for free.
