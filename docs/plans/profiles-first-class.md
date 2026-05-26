# Plan: Profiles as first-class, function-only entities

> **SUPERSEDED (2026-05-26) by `docs/plans/file-based-architecture.md`** — the
> profiles-only framing here was generalized into a full file-based architecture
> (volume-only · `<id>.<kind>.ts` typed files · mid-ext → app/API registry ·
> server bake cache · composition-by-reference / slots · tabs-as-files). The
> profile-specific decisions below (function-only, pick+lift) still hold; read the
> file-based doc for the current plan.

Status: **superseded**. Builds on `docs/plans/profiles-directory.md` (K.22).

## Motivation

Today a revolve part's profile can be one of two things:
1. a **function profile** — `resolveProfile({ kind: 'drill_pipe_box', params })` → the
   new way (lifted params, function editor); OR
2. a **raw vertex array** — `r_revolve([[r,z],…], segs)` → the OLD way (draggable
   vertex editor, baked points).

The vertex form is the problem. It appears whenever `r_revolve` is **instantiated**
(the `Load…` scaffold copies the polygon param's array default) or in legacy/
overwritten parts — and it opens the old vertex editor. The user's requirement:

> **There should be ONE `r_revolve`, it is always driven by a profile FUNCTION
> (default function), never raw vertices. The profile is a first-class thing:
> a parameter you pick, a folder, listed in the sidebar, and editable in its own
> tab.**

## Target model

- **Function profiles only.** No raw `[[r,z]]` arrays anywhere. The draggable
  vertex `ProfileEditor` is retired from the profile flow (it stays only for the
  unrelated warp-path popup).
- **Profile = folder** (already true): `primitives/profiles/<id>/` = `profile.json`
  (params schema) + `source.ts` (`export function build(p) → [[r,z],…]`).
- **Profile listed in the sidebar** under a **Profiles** section, alongside Basic /
  Industrial / Completions.
- **Profile editable as a tab** — click a profile → opens a tab rendering the
  full `ProfileFnEditor` (params · expressions · path · preview), saved like a
  primitive. A part shows an **"open in tab ↗"** button for its selected profile.
- **Profile = a parameter on a part (pick + lift).** A revolve part declares a
  `profile` param (which function), AND that profile's params (bore/wall/…) are
  **lifted** onto the part so dims are tweakable per-part. The profile's SHAPE
  (the `build()` path) is edited in the profile's own tab (shared across parts).

### Source shape of a revolve part (pick + lift)
```ts
export const meta = {
  id: 'dp_new', name: 'dp_new',
  uses: ['r_revolve'],
  params: {
    profile: { type: 'profile', set: 'revolve', default: 'drill_pipe_box' }, // WHICH function
    bore:    { label: 'bore ID', min: …, default: … },   // ← lifted from the profile
    wall:    { … },                                       // ← lifted
    // …the rest of drill_pipe_box's params, lifted
  },
};
export function dp_new(profile, bore, wall, /*…lifted…*/) {
  const section = resolveProfile({ kind: profile, params: { bore, wall, /*…*/ } });
  const body = r_revolve(section, 96);
  return body;
}
```
- `profile` is now a **param** (a profile id), not a baked literal. Swapping it
  re-lifts the new profile's param set.

## Current state (what exists, what's missing)

| Piece | State |
|---|---|
| `primitives/profiles/<id>/` folders | ✅ exists |
| `/api/primitives/profiles/{list,save,source,resolve}` | ✅ exists |
| `ProfileFnEditor.svelte` (function editor) | ✅ exists |
| `ProfilePalette.svelte` (selector) | ✅ exists |
| `/primitives/profiles` full-screen builder route | ✅ exists (commit 49a7ab4) |
| Create-from-profile (lift params) | ✅ `buildRevolveStubFromProfile` |
| r_revolve removed from create picker | ✅ (commit 0662d8f) |
| **Profiles section in the `/primitives` sidebar** | ❌ |
| **Profile-as-tab in the editor's tab model** | ❌ (tabs are primitives only) |
| **`profile` param type (pick) + swap/re-lift** | ❌ |
| **"open profile in tab" button** | ❌ |
| **`Load…` r_revolve → function-first** | ❌ (still scaffolds a vertex array) |
| **Vertex editor retired from profile flow** | ❌ (`leafEdit`/`profileEdit` literal modes + `ProfileEditor` still live) |

## Phases

### Phase A — Profiles in the sidebar + editable as tabs
- Sidebar: add a **Profiles** group listing curated + volume profile functions
  (from `PROFILE_REGISTRY` ∪ `/api/primitives/profiles/list`). Each is a folder
  entry with the `ƒ` badge for volume ones.
- Tab model: introduce a tab discriminator `{ kind: 'primitive' | 'profile', id }`.
  A `profile` tab renders `ProfileFnEditor` (fill mode) instead of `PrimitiveView`.
  Save writes via `profiles/save`; the tab reloads via `profiles/source`.
- Decide: keep the standalone `/primitives/profiles` route or fold it into the
  tabbed view. (Lean: keep the route as the "library", tabs as the editor.)

### Phase B — Profile as a parameter (pick + lift) + open-in-tab
- New param kind **`profile`** (`{ type:'profile', set:'revolve'|'cartesian', default:<id> }`).
  Rendered as a `ProfilePalette` selector (searchable, curated + ƒ volume).
- **Swap** a profile → re-lift: regenerate the lifted param set from the newly
  selected profile's schema (reuse `buildRevolveStubFromProfile`'s lift logic),
  preserving overlapping param values where names match.
- **"open in tab ↗"** button next to the selector → opens the selected profile's
  tab (Phase A).
- **Bake (P6):** `primitive-loader.profileAwareArgValues` currently scans
  `resolveProfile({ kind: 'literal' })`. Extend it to resolve a profile whose
  `kind` is a **param** — i.e. resolve by the param's runtime value. Keep the
  literal path working (zero regression).

### Phase C — Eliminate vertex profiles
- `Load…` scaffold (`PrimitiveView`): when the loaded primitive has a **polygon
  param** (r_revolve/r_extrude), scaffold a **function profile** (`profile` param
  + lift, default kind cylinder for revolve), NOT a vertex array.
- Retire vertex editing in the profile flow: remove `openLeafProfile`/`leafEdit`,
  the `profileEdit` `'literal'`/`'profile'` modes, and `<ProfileEditor>` from those
  popups. Profiles are edited via their tab / the selector only. (`ProfileEditor`
  stays for the warp-path popup.)
- The "promote inline literal → meta.profiles" path is removed (no inline literals).

### Phase D — Migrate existing vertex parts
- Convert raw-vertex `r_revolve` parts (e.g. `dp_new`'s `revolve2`, archived `dp_*`)
  to function profiles, or remove them. One-time data cleanup.

## Sequencing

A → B → C → D, each shippable + GUI-verified before the next. (Considered "C first
to stop the bleeding"; chose A→D so the function-first replacement exists before we
remove the vertex path.)

## Decisions (locked 2026-05-26)
- **Pick + lift** (not self-contained): the part picks the profile AND lifts its
  params for per-part dims; the shape is edited in the profile's tab.
- **Function-only**: no vertex profiles. Vertex `ProfileEditor` retired from the
  profile flow.
- **Plan-doc-first** (this file), reconciled into `/plan`, then build.

## Open questions / risks
- **Swap re-lift UX**: changing the `profile` param changes which params exist on
  the part. Need a clean re-scaffold (preserve matching values; drop/add the rest)
  + clear feedback.
- **P6 param-driven kind**: resolving a profile from a param value (not a literal)
  needs the bake to know the param's value at scan time — verify the loader can do
  this without a sandbox round-trip.
- **Tab model**: mixing primitive + profile tabs in one strip vs separate.
- **`/primitives/profiles` route** vs tabbed profiles — keep both or consolidate.
- **List staleness** (separate issue, mitigated by `pendingCreated`): profile
  creates/edits will hit the same prod-list lag — reuse the optimistic pattern.

## Related
- `docs/plans/profiles-directory.md` (the profile library foundation)
- `src/lib/cad/primitive-stub.ts` (`buildRevolveStubFromProfile` — the lift logic)
- `src/lib/server/primitive-loader.ts` (P6 `profileAwareArgValues`)
- `src/lib/shared/{ProfileFnEditor,ProfilePalette,ProfileEditor}.svelte`
