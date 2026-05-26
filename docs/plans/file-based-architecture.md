# Plan: File-based architecture for /primitives (SVTC-pattern)

Status: **proposed** (2026-05-26). Supersedes `docs/plans/profiles-first-class.md`
(folded in below). Modeled on SVTC's file↔tab↔embed system
(`/Users/neerajsethi/code/SVTC/src/lib/{tabs,apps}`).

## Why

Today `/primitives` has grown organically: entry-keyed tabs that only render
`PrimitiveView`, profiles split across `profile.json` + `source.ts`, parts that
reference a profile via an inline `resolveProfile({kind:'X'})` literal, and a
still-live **raw-vertex** profile path (the old draggable editor) that keeps
leaking in (`Load… r_revolve` scaffolds a vertex array → old editor). SVTC solves
this generally: **every entity is a typed file; a tab is an open file; a file can
embed another file via a slot.** Adopt that.

## Architecture

### 1. Storage: volume-only
No local FS, no IndexedDB. Every file lives on the volume; one datasource
(`/api/volume`, already proxied to prod). **Tab state persists to the volume (or
session)** — not local storage.

### 2. File taxonomy — `<id>.<kind>.ts` (mid-extension = type)
All entities are **TS modules**; the **mid-extension** identifies the type. Flat
files (no per-entity folder) — baked artifacts live in the server cache (§4), not
sibling files.

| File | Type | `build`/`geom` returns | Client editor | Server route |
|---|---|---|---|---|
| `<id>.prvl.ts` | revolve profile | `(r,z)` half-section pts | `ProfileFnEditor` (Z-down) | profile resolve (sandbox) |
| `<id>.prex.ts` | extrude profile | cross-section pts | `ProfileFnEditor` (cartesian) | profile resolve |
| `<id>.prim.ts` | CAD primitive | `Manifold` | `PrimitiveView` | bake (transpile + sandbox) |
| `<id>.asm.ts` | assembly (composite) | `Manifold` | `PrimitiveView` / asm view | bake |

- The **mid-ext encodes semantics** the client needs without parsing: `prvl` vs
  `prex` carries the revolve/extrude axis convention (no separate `set` flag);
  `prim` vs `asm` is the leaf-vs-composite split (Rule 17, made explicit).
- The client **never executes** `.ts` — it dispatches by mid-ext to the right API.
- On the volume (proposed): `primitives/<cat>/<id>.prim.ts`,
  `primitives/<cat>/<id>.asm.ts`, `primitives/profiles/<id>.prvl.ts` / `.prex.ts`.

### 3. Client: app registry + tabs-as-files
- **`getApp(midExt) → editor`**: `prvl|prex → ProfileFnEditor`, `prim|asm →
  PrimitiveView`. (Solves the discriminated-tab problem generally.)
- **A tab = an open file**, keyed by volume path: `{ id: path, name, kind, dirty }`.
  Dedupe by path; persist `{tabs, activeId}` to the volume/session. (SVTC:
  `src/lib/tabs/tabs.svelte.js` — `openFile`/dedupe/persist; we drop the local/Drive
  tiers, keep volume only.)
- **Unified I/O** (`apps/shared/volumeIO`): `loadFile(path)` / `saveFile(path, content)`
  over `/api/volume`. (SVTC: `apps/shared/tabIO.js` `tabBytes`/`saveTab`.)

### 4. Server: route-by-mid-ext + bake cache
- The bake/resolve endpoints route by mid-ext (`.prim.ts`/`.asm.ts` → bake;
  `.prvl.ts`/`.prex.ts` → resolve).
- **Bake cache** keyed on **content + params** (not just filename), so a re-bake
  with identical inputs is a hit — this is *why* flat files work (no `mesh.glb`
  sidecars). Key ≈ `hash(path, contentHash, depContentHashes, paramsHash)`.
  **Busted on save** of the file AND of any file it embeds (a profile save
  invalidates the parts that slot it). Also fixes today's prod list/bake lag for
  edits (save → invalidate → fresh bake).

#### Design vs instance (cache granularity) — IMPORTANT
A file is a **design** (parametric definition + default params). A **reference
site** in a higher file supplies concrete params → an **instance**. **The cache
memoizes INSTANCES, not designs** — key ≈ `(designContentHash, instanceParams,
depInstanceKeys)`. Therefore:
- **Editing a design's source** (its shape/`build`) changes its content hash and
  invalidates **all** instances of it, transitively down the DAG (the shape changed).
- **Changing params at a reference site** (a higher assembly overriding a profile's
  `bore`) is an edit to the **referencing file** — params live in the *instance*,
  not the design. It yields a **new instance key**, dirties **only the referencing
  file's bake**, and leaves the **original design + every sibling instance untouched**.

So a higher assembly never invalidates the original part/profile: the profile's
*manifestation* (its resolved geom at those params) is the **instance**, cached
under the assembly's reference; the design is shared + immutable to param overrides.
Param overrides are **persisted in the referencing file** (so editing them = editing
that file's content → only its bake re-runs). Only a **source edit of the design**
propagates down the reference graph.

**Staleness across the graph — always-latest, no version field (decided).** The
bake key is a **Merkle hash of the reference DAG**:
`key(A) = hash(A.content, A.instanceParams, key(dep1), key(dep2), …)` (recursive).
So a sub-part `S` contributes `key(S)` into every ancestor's key. When `S`'s design
changes, `key(S)` changes → every ancestor's key changes → their cache entries miss
→ they re-bake fresh on next open. An assembly "knows" `S` changed because its key is
**derived from `S`'s current content at bake time**, not stored against a snapshot —
the content hash *is* the version (no manual bump, catches external edits too).
Keep a per-file `contentHash` updated on save so the DAG isn't fully re-hashed every
request. **No explicit version/pin now** (always-latest); the reference shape may add
an optional pin later for frozen/published assemblies (ties to per-user/public space)
without a migration.

#### Hashing cost — negligible
We hash the **source** (a few KB of `.ts`), not the baked mesh (the cache *value*,
which is never hashed for the key). Per-file `contentHash` is computed **once on
save** and cached, so a bake just **composes cached dep hashes** (sub-ms even for a
deep DAG). Even a large file would hash at hundreds of MB/s–GB/s (SHA-256) or
multiple GB/s (xxHash/Blake3); our inputs are KB → instant. Hash choice is free at
this size — xxHash64 for speed, or SHA-256 if we want content-addressed dedup.

### 5. Composition by reference (assemblies + slots are one concept)
**Everything composes by reference to volume files — no inlining.** An `.asm.ts`
references other volume files (`.prim.ts` / `.asm.ts` / `.prvl.ts`) by id, each
with per-instance params + a transform (`mv`/`rot`) + a CSG op. A profile **slot**
on a part is the *same* mechanism — a typed reference to a `.prvl.ts`. The bake
walks the reference **DAG** (recursive: an asm can reference sub-asms), baking each
node (cached) and composing. This is essentially the existing `meta.uses` +
dep-injection loader (`loadPrimitiveGeomById` resolves deps by id, injects by name)
— so the assembly mechanism mostly already exists; the re-arch formalizes it as
`.asm.ts` (reference-composer) vs `.prim.ts` (leaf). Cache busting follows the DAG:
editing a referenced file invalidates everything that references it.

- A `.prim.ts`/`.asm.ts` declares a **profile slot**:
  `profileSlots: { body: { label, kind: 'revolve', assigned: '<profile-id>' } }`.
- A **`ProfileSlotPicker`** (modal, SVTC `FileSlotPicker.svelte`) assigns which
  profile; **candidates filtered by mid-ext** (revolve slot → `*.prvl.ts` only).
- **Pick + lift** (locked decision): assigning a profile lifts its params onto the
  part for per-part dims; the profile's *shape* (`build`) is edited in the profile's
  own tab (shared across parts). Swapping the profile re-lifts.
- **Lazy resolve** on open (SVTC `autoReconnect`): the slot reference resolves to
  the profile file at bake; compiles to the existing `resolveProfile`.
- **"open ↗"** button on a slot → `tabs.openFile(profilePath)` → edit the profile
  in its own tab.

## Mapping from today → target
| Today | Target |
|---|---|
| `primitives/<cat>/<id>/source.ts` | `primitives/<cat>/<id>.prim.ts` (or `.asm.ts`) |
| `primitives/profiles/<id>/{profile.json, source.ts}` | `primitives/profiles/<id>.prvl.ts` / `.prex.ts` (meta+build in one module) |
| entry-keyed tabs, PrimitiveView-only | path-keyed tabs + app registry |
| inline `resolveProfile({kind:'X'})` literal | a profile **slot** (`assigned: id`) that compiles to it |
| raw `r_revolve([[r,z]], n)` vertex path + old editor | **gone** — r_revolve always fills a profile slot |
| `/api/primitives/{source,list,…}` + `/profiles/*` | route by mid-ext; one bake/resolve dispatch + bake cache |

## Phases (re-sequenced)

- **P0 — Taxonomy + migration + server.**
  - **P0a — SHIPPED 2026-05-26** (`bcd3f2b`): mid-ext taxonomy + the flat-file
    migration. `scripts/migrate_to_file_kinds.py` renamed every `source.ts`→
    `.prim.ts` and merged each profile `profile.json`+`source.ts`→ one
    `.prvl.ts`/`.prex.ts` module (meta + `build()`); **prod volume migrated**
    (42 primitives + 4 profiles; `t_bolt_driven` husk removed; full backup at
    `.volume-backup/`). `src/lib/server/primitive-paths.ts` is the single resolver
    (`findPrim`/`findProfile`/`listEntitiesIn`) — new flat files resolve first,
    legacy folders still READ (dual-read) so deploy + migration was zero-downtime.
    Endpoints `source`/`save`/`list`/`delete`/`restore` + `profiles/*` rewritten;
    `profile-fn.ts` gained `composeProfileModule`/`splitProfileModule`;
    `primitives-meta.ts` gained `evalMetaLiteral`. Validated end-to-end on a local
    mirror, then prod (canary + full).
  - **P0b — remaining:** the **content-hash bake cache** (memoize instances on
    `hash(content, params, depKeys)`, always-latest, busted on save). Non-destructive,
    additive — the next piece.
- **P1 — App registry + tabs-as-files.** Volume-backed tab store keyed by path;
  `getApp(midExt)`; profile tabs render `ProfileFnEditor`. Sidebar lists files
  (incl. a Profiles section).
- **P2 — Profile slots (pick + lift) + open-in-tab.** `profileSlots` on parts;
  `ProfileSlotPicker` filtered by mid-ext; lift params; swap re-lifts; "open ↗".
  Bake resolves the slotted profile.
- **P3 — Kill vertex profiles.** `Load…`/create scaffold function-first (fill a
  slot, never a vertex array); retire the draggable vertex editor from the profile
  flow (warp-path keeps it).
- **P4 — Migrate legacy vertex parts** (dp_new's revolve2, archived dp_*) to slots.

## Future: per-user volume space
Later, the volume gains **per-user space** (customization + building per user) —
tying to the identity plan (bundle L, `docs/plans/oauth-identity.md` +
`customize-directory.md`). The file-based model is **user-scoped-ready**: a file's
path carries its owner (e.g. a shared root vs `users/<userId>/…`); the registry +
bake cache + reference resolution key on the full path, so a user's `.prim.ts`/
`.prvl.ts` and references resolve within their space. References may point at shared
(public) files or the user's own. Design now so paths/ids are owner-qualified and
the cache + slot-resolver don't assume a single global namespace.

## Decisions locked (2026-05-26)
- **Volume-only** storage; tab state persists to volume/session (not local).
- **Assemblies = composition by reference** to volume files (no inlining); slots
  are the same reference mechanism; bake walks the reference DAG.
- **Cache memoizes INSTANCES** `(designContentHash, params, depKeys)`, never designs;
  param overrides live in the referencing file.
- **Always-latest via content-hash Merkle keys** — no version field; a design source
  edit auto-invalidates dependents on next open. Pinning deferred (reference shape
  stays pin-capable).
- **`<id>.<kind>.ts`** files; **mid-ext = type key** for client app + server route.
- **Flat files**; baked artifacts in a **server bake cache** (content+params, busted on save).
- **Profile content = a `.ts` module** (meta + `build()`), same sandbox as today.
- **Pick + lift** profile params (not self-contained).
- **Function-only** profiles; vertex editor retired from the profile flow.

## Open questions / risks
- **Cache key + dependency busting**: an assembly's bake depends on its embedded
  profiles' content — invalidation must follow the dependency graph (a profile
  save busts dependent parts). Define the dep index.
- **Migration safety**: renaming every volume file is destructive — script + backup
  + verify; keep a one-shot reversible mapping.
- **Tab persistence shape** on the volume (a `tabs.json`? per-session?).
- **`/primitives/profiles` route** — fold into the tabbed file view or keep as a
  library landing.
- **`.asm.ts` vs `.prim.ts`** boundary — when does a part become an assembly?
  (heuristic: declares `profileSlots` or composes >1 instance ⇒ asm.)

## SVTC references (implementation guide)
- Tabs: `SVTC/src/lib/tabs/tabs.svelte.js` (open/dedupe/persist; path = id).
- App registry: `SVTC/src/lib/apps/registry.js` (`getApp(ext)`).
- Unified I/O: `SVTC/src/lib/apps/shared/tabIO.js` (`tabBytes`/`saveTab`).
- Slot picker + embedding: `SVTC/src/lib/apps/tpl/FileSlotPicker.svelte` +
  `TplApp.svelte` (`fileSlots`, `assignedFile`, `autoReconnect` lazy resolve).

## Related
- `docs/plans/profiles-first-class.md` (superseded — the profiles-only framing)
- `docs/CAD_AUTHORING.md`, CLAUDE.md Rule 17/18 (primitives/components/recipes; location=category)
- `src/lib/server/primitive-loader.ts` (bake + the existing 30s profile cache → evolve into the bake cache)
