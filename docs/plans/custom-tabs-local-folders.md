# Custom tabs + local/cloud folders

**Status:** planning (2026-07-01, user). Do NOT implement yet. Extends the shipped
3-tab sidebar (INTERNAL / BASIC / WELL, `docs/plans/sidebar-reorg.md`) with
user-defined tabs and machine-local folders. Ties to the deferred per-user/OAuth
work (`docs/plans/oauth-identity.md`, memory `todo_customize_dir_deferred`) and the
data-residency direction (memory `ai_data_residency_local_first`).

## The core model — two folder ORIGINS
Every custom tab / folder is one of two kinds, shown with distinct colors + a legend:
- **CLOUD** = tied to the **USER ID**. A per-user private space on the app volume,
  keyed by the authenticated user's id (`<volume>/users/<uid>/…`). Requires the OAuth
  identity port (`docs/plans/oauth-identity.md`, memory `todo_customize_dir_deferred`).
- **LOCAL** = a folder on the user's own MACHINE, via the browser **File System Access
  API** (`showDirectoryPicker()`). No account/auth needed — it's on-device. Handle
  persisted in IndexedDB (re-prompt permission per session). Local parts **bake
  CLIENT-SIDE** (`docs/plans/client-side-execution.md`) so nothing touches the server —
  fits data-residency (`ai_data_residency_local_first`).

The built-in INTERNAL / BASIC / WELL tabs are the shared/system space and stay as-is
(INTERNAL excluded from all custom/move operations).

## A. Custom tabs
- A user ADDS a custom top-level tab beyond the 3 fixed ones — a named, colored group
  in the left rail. Each custom tab is CLOUD (user-id-scoped) or LOCAL (a picked
  machine dir). Rule 16 still holds (location IS category) — per-origin roots.
- **Visually distinct** — custom tabs (and cloud-vs-local) each get a color (auto from
  a palette, cf. `src/lib/shared/instance-colors.ts`, or user-picked); a legend maps
  color→origin.
- Model change: the rail's fixed `['__internal','basic','completions']` becomes
  `fixed + dynamic[]` from a tabs manifest (label/color/origin/root). `activeView`
  already abstracts the render → mostly manifest + tab-CRUD + a local tree source.

## B. Adding folders (cloud or local)
- When ADDING a folder (to a tab, or into a folder), the user picks **CLOUD**
  (user-id-scoped volume) or **LOCAL** (`showDirectoryPicker`). Colored by origin.
- The sidebar merges the cloud tree (`/api/primitives/list`, user-scoped) with any
  LOCAL trees (read directly from the FS handle in the browser) into one rail; a
  moved/added folder re-groups under its tab.

## Relationship / sequencing
1. **LOCAL folders FIRST** — no OAuth needed (on-device): File System Access API +
   IndexedDB handle store + distinct color + client-side bake for local parts. This is
   the near-term deliverable, independent of the identity port.
2. **Custom tabs (LOCAL-backed)** — a custom tab pointing at a local dir; manifest +
   color; ships with (1).
3. **CLOUD per-user (tabs + folders)** — GATED on the OAuth identity port
   (`oauth-identity.md`): cloud folders/tabs keyed by user id in a private space;
   `/api/primitives/*` become user-scoped. Until OAuth lands, cloud stays the shared
   volume (today's behavior) and per-user cloud is deferred.
All build on the shipped 3-tab sidebar + the folder-move-between-tabs feature.

## Open questions
- Tab-config storage: a shared volume manifest now vs per-user store later (OAuth).
- Local-folder persistence: File System Access handles in IndexedDB; permission
  re-grant UX on each session; how `/api/primitives/list` + the sidebar merge a
  local tree with the cloud tree in one rail.
- Color scheme: reuse the instance-colors palette, or a user picker? A consistent
  "local = one hue, cloud = another, custom-tab = its own" legend.
- Do local parts appear in RAG/AI corpora? (Probably NO by default — private/on-disk;
  respects data-residency.)
