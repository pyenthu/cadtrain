# Profile System — design & plan (2026-05-23)

> Status: **PLANNING — not yet implemented.** The profile is foundational
> (it determines a lot downstream: every extrude/revolve/swept primitive
> consumes one), so we design it well before writing code.

## Vision

A **profile** is a 2D polygon that primitives extrude / revolve / sweep.
Today it is a frozen `[[x,y],…]` point array hand-edited in the SVG
`ProfileEditor`. We want profiles to be:

1. **Parametric** — each profile *kind* declares its own params and a
   generator `build(params) → Pt[]`. Tune the params → shape regenerates.
2. **Library-backed & searchable** — pick from a host of profiles via a
   searchable popup with SVG thumbnails.
3. **Two origins**: **built-in** kinds live in **app source** (statically
   editable, enhanced over time); **customized/saved** profiles live on the
   **volume** under `primitives/profiles/`.
4. **Extensible with custom functions** — advanced users author a generator
   function (sandboxed) stored on the volume.

## Decided

- **Storage model = "Parametric & live"** (user pick, 2026-05-23): source
  stores `{ kind, params }`; the polygon is regenerated at build time.
  Dragging a vertex **detaches** the profile to a custom `{ points }` list.

## Concepts & schema

### In-source profile descriptor (a union)
A primitive's `meta.profiles.<slot>` becomes one of:
```ts
{ kind: 'ellipse', params: { segments: 48, rMajor: 0.5, rMinor: 0.3 } } // parametric
{ points: [[x,y], …] }                                                  // detached / hand-drawn
[[x,y], …]                                                              // LEGACY → treated as { points }
```
Backward compatible: a bare array keeps working.

### Profile kind definition (registry entry)
```ts
type Pt = [number, number];
interface ProfileDef {
  id: string;            // 'ellipse', 'rect', 'hex', 'tube', …
  label: string;
  set: 'cartesian' | 'revolve';
  tags: string[];        // search keywords ('round','pipe','nut',…)
  params: Record<string, { label: string; default: number; min: number; max: number; step: number; unit?: string }>;
  build: (p: Record<string, number>) => Pt[];
  origin?: 'builtin' | 'volume';
}
```

### Built-in seed kinds (app source)
- **cartesian**: `ellipse`(segments, rMajor, rMinor — circle = equal radii),
  `rect`(w,h), `ngon`(n, r), `l`(legX, legY, t), `t`(w, h, web, flange),
  `plus`(arm, t), `star`(points, rOuter, rInner), `slot`(len, r),
  `ibeam`(w, h, flange, web), `channel`(w, h, t).
- **revolve** (r≥0 half-sections): `cylinder`(r, len), `tube`(od, id, len),
  `cone`(rBot, rTop, len), `barrel`(rEnd, rMid, len), `goblet`(…).

## Volume layout — `<volume>/primitives/profiles/<id>/`
New directory under `primitives/` (matches the directory-per-part pattern,
Rule 18). Each saved profile:
- `profile.json` — `{ id, label, set, tags, kind?, params?, points? }`.
  A saved *configured* profile = `kind + params`. A *custom-function*
  profile additionally has `source.ts`.
- `source.ts` (custom-fn only) — exports `build(p)` + a params schema,
  sandbox-executed like a primitive `source.ts`.
- (optional) `thumb.svg` cached preview.

Single live store: the profiles endpoints are **proxied to prod** when
`CADTRAIN_VOLUME_REMOTE_URL` is set (add to `VOLUME_PROXY_PATHS`).

## API endpoints (mirror primitives)
- `GET  /api/primitives/profiles/list` — built-in registry merged with
  volume `primitives/profiles/*` (volume shadows built-in on id collision).
- `GET  /api/primitives/profiles/source?id=` — custom-fn source.
- `POST /api/primitives/profiles/save` — write `primitives/profiles/<id>/`.
- (later) `delete`.

## Build / loader expansion  ⚠️ SUPERSEDED — see "Refined implementation" below
The naïve idea of expanding profiles "wherever `meta.profiles` is turned into
polygons" is WRONG: `meta.profiles` is never turned into polygons on the
server. The polygon→Manifold conversion happens **inside the sandboxed
primitive body** (`new CS([loop]).extrude` / `weldAndBuild(revolveProfile(...))`).
The deep-dive below relocates `resolveProfile` accordingly.

## UI — the profile popup (ProfileEditor)
1. **Search box** — filters built-in + volume by label/tag/id.
2. **Palette** — grid of SVG thumbnails (origin badge: built-in vs volume).
   *(Searchable palette is its own sub-feature — design now, build in P2.)*
3. **Select** → load defaults → render the kind's **param controls**
   (sliders/number inputs) → live-regenerate the polygon.
4. **SVG editor** below — drag a vertex → **detach** to `{ points }`
   (param controls hide; offer "re-link to kind").
5. **Save as profile** → writes to `primitives/profiles/`.
6. **Custom function** — advanced tab to author a generator fn (sandbox).

## Phasing + TODO

### P0 — Foundations & discovery
- [ ] Trace current profile data flow (ProfileEditor ↔ source `meta.profiles`
      ↔ extrude/revolve build). Document where polygons are produced today.
- [ ] Add `Pt`, `ProfileDescriptor` union, `ProfileDef` types in a new
      `src/lib/shared/profile-presets.ts`.
- [ ] Seed built-in parametric kinds (port existing presets → param form).
- [ ] No behavior change yet (still emits points to existing consumers).

### P1 — Parametric in the popup ("Parametric & live")
- [ ] Popup renders param controls for the selected built-in kind; live regen.
- [ ] Source stores `{ kind, params }`; `resolveProfile` expands at build.
- [ ] Drag a vertex → detach to `{ points }`; legacy arrays still resolve.

### P2 — Volume profiles + searchable palette
- [ ] `primitives/profiles/` dir + `list`/`save` endpoints (add to proxy).
- [ ] Searchable palette w/ SVG thumbnails pulling built-in + volume.
- [ ] "Save as profile" from the popup.

### P3 — Custom-function profiles
- [ ] Sandbox-eval generator fns stored on the volume; advanced editor tab.

## Open questions — RESOLVED (deep-dive 2026-05-23)
1. **Units** — params are in local profile space (scaled by the primitive
   downstream). Confirmed by code (`r_revolve` default uses raw local r,z).
2. **Shadowing** — YES, a volume profile shadows a built-in of the same id
   (mirrors primitives shadowing bundles). Implement in the `list` merge (P2).
3. **Ellipse** — `rMajor` along x, `rMinor` along y, `segments` = vertex count;
   circle = `rMajor === rMinor`.
4. **Detach** — drag → `{ points }` AND keep a hidden `_gen:{kind,params}` so
   "re-link to kind" is possible (non-breaking; `resolveProfile` checks
   `'points' in d` first, so `_gen` is ignored at build).
5. **Param surface** — popup only for P1; mirroring into the main Parameters
   panel is deferred.

## Refined implementation (deep-dive 2026-05-23)

### Profile data-flow today (3 paths)
- **A — `type:'polygon'` param**: only `r_extrude` + `r_revolve`. Authored as
  `meta.params.<n>` with `type:'polygon'` + `default:[[x,y]]`; parsed by
  `extractMetaFromSource` (`primitives-meta.ts`); edited via the `✎`
  ProfileEditor popup; `JSON.stringify`'d into `appliedArgs`; POSTed to
  `/preview` + `/bake-preview`; `JSON.parse`'d inside the primitive body →
  `CS.extrude` / `revolveProfile`.
- **B — composite inline literal**: composite calls `r_extrude([[...]], h)`;
  `recognize-composite.ts` finds the span; popup splices the literal back in.
- **C — `meta.profiles.<slot>`**: encapsulated default; body refs `…value`.
- The polygon→Manifold conversion happens INSIDE the sandboxed primitive body,
  reached identically by preview + bake-preview via `buildPrimitiveGeom` — ONE
  chokepoint, but inside the sandbox.

### Key placement decision
`resolveProfile(d) → Pt[]` = pure, sync, dependency-free fn in
`profile-presets.ts` (handles `{points}`, legacy `[[x,y]]`, built-in
`{kind,params}`). **Inject it into the sandbox scope** (`primitive-sandbox.ts`)
— the single edit reaching preview, bake-preview, AND recipe composites.
Built-in kinds resolve sync in-body; **volume** kinds (P2/P3, async) are
pre-resolved in the endpoint before dispatch.

### P0 (no behavior change)
- New `src/lib/shared/profile-presets.ts`: types + `PROFILE_REGISTRY` (port
  existing presets verbatim → byte-identical at defaults) + `resolveProfile`.
- vitest: parametric output matches old presets to 1e-9.

### P1 (parametric in popup)
- P1.1 inject `resolveProfile` into `primitive-sandbox.ts` arg names.
- P1.2 `r_extrude`/`r_revolve` body → `resolveProfile(…)` (bare arrays still
  work). These live on the PROD volume — save via `/api/primitives/save`, NOT
  the `volume_backup/` snapshot.
- P1.3 endpoint pre-resolution hook for volume kinds (thin guard in P1).
- P1.4 popup: kind selector + per-kind param sliders → live `resolveProfile`
  → ProfileEditor displays points; write the DESCRIPTOR (not points) to pending.
- P1.5 drag-to-detach: parent converts descriptor → `{points,_gen}`, hides
  param controls.
- P1.6 composite/inline parity: `recognize-composite.ts` + `profilePtsPreview`
  learn to read `{points}`/`{kind,params}` (else thumbnail silently empty).

### Critical files
`profile-presets.ts` (NEW) · `primitive-sandbox.ts` (inject) ·
`PrimitiveView.svelte` (popup) · `r_extrude`/`r_revolve` `source.ts` (consume
via resolveProfile; save via endpoint) · `recognize-composite.ts`.

### Risks
- `extractMetaFromSource` evals the object form fine, but `PrimMeta` TS types
  (`params.default`, `profiles.value`) must widen to the descriptor union.
- Recognizer assumes bare arrays → parametric inline literals lose their
  preview icon unless P1.6 is done.
- Editing `r_extrude`/`r_revolve` mutates the SHARED prod store.
- 31 sources hold inline `[[x,y]]` — all keep working via the legacy branch;
  none need migration. `r_tube`/`r_cone`/`r_tapered_tube` are already
  parametric (scalar params, no polygon param) → out of scope for P1.
