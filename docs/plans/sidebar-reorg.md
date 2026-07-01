# /primitives sidebar reorg — 3 main vertical tabs (INTERNAL / BASIC / WELL)

Status: implemented (presentation-only). Branch: `worktree-agent-adc9d069837d40bdb` (off `main`).

## Goal

Reorganize the leftmost **vertical category tabs** of `/primitives` from the
current per-top-folder rail (Basic · Completions · Archived · stdlib · stdstale
+ any user folder) into a **3-tab hierarchy**:

```
MAIN TABS (vertical rail):
  INTERNAL   → folders: ARCHIVED, STDLIB, STALE      (system / read-only / trashed)
  BASIC      → volume basic/ parts (+ any other user top-level folder)
  WELL       → volume completions/<family>/[<sub>/]  (downhole completions)
```

This is a **PRESENTATION-ONLY regrouping** (Rule 16 stays intact — location IS
category). No files move on the volume; no part paths change; the same
`/api/primitives/list` `tree` drives everything. We only regroup how the rail
buckets the existing top-level dirs.

## Current architecture (as-found)

- `/api/primitives/list` returns a recursive `tree` (root children = the
  on-volume top-level dirs) plus `stdlib` / `stdstale` Entry arrays (git-tracked
  engine sources, served by `src/lib/server/stdlib.ts`, NOT on the volume).
- `src/routes/primitives/+page.svelte` renders a vertical rail (`.prim-tabrail`)
  = one `.prim-tabbtn` per `topFolders` (tree root children) + two fixed `src`
  tabs (`__stdlib`, `__stdstale`).
- `activeTab` (string) scopes the file tree to ONE branch; `activeNode` +
  `activeKind` derive from it; the scoped render draws `activeNode.children` as
  folder rows + `activeNode.parts` as file rows, all with one `activeKind`.
- Pure tree helpers live in `src/routes/primitives/primitives-tree.ts`
  (`tabLabel`, `subtreeCount`, `subtreeMatches`, `sortFolders`, `nodeAt`,
  `findPartDir`, `moveTargets`, `MOVE_TARGET_RE`).
- `/graph-editor` and `GraphEditorPane` do NOT depend on the sidebar grouping
  (their `activeTab` is an unrelated AI-context field). Verified by grep.

Prod top folders today: `archive`, `basic`, `BASIC_WELL` (user folder),
`completions`. `stdlib` (7 engines) + `stdstale` (`r_extrude`) come from src.

## Target model

Introduce a synthetic `INTERNAL_TAB = '__internal'` sentinel and constrain
`activeTab` to `{ '__internal' | 'basic' | 'completions' }` (BASIC = `basic`,
WELL = `completions`, so drag-drop `to=` paths + create paths stay real dirs).

A single `activeView` derived replaces `activeNode` / `activeKind`:

| Tab | folder rows (depth 0, each with its kind) | direct files | createPath |
|---|---|---|---|
| **INTERNAL** | `archive` (kind `archive`), `stdlib` (kind `stdlib`), `stdstale` (kind `stdstale`) | — | `null` (no create) |
| **BASIC** | `basic`'s children (kind `volume`) **+ any other top folder** not in {basic, completions, archive} e.g. `BASIC_WELL` (kind `volume`) | `basic`'s parts (dir `basic`) | `basic` |
| **WELL** | `completions`'s children = families (kind `volume`) — keeps the family sub-tree | `completions`'s parts (dir `completions`) | `completions` |

`archive`/`stdlib`/`stdstale` render as real `folderNode` rows (expand/collapse
in place) so INTERNAL nests them exactly as required. The read-only `stdlib`/
`stdstale` synthetic nodes (`__stdlib` / `__stdstale` paths) are reused as-is.

**Extra user top folders** (e.g. `BASIC_WELL`) land under **BASIC** as sibling
folder rows so nothing becomes unreachable — BASIC is the general user bucket,
WELL is specifically completions.

## Correctness — create / trash / list stay right (Rule 16)

- **Create**: toolbar `＋ new` shows only when `activeView.createPath` is set
  (BASIC→`basic`, WELL→`completions`; hidden on INTERNAL). Per-folder `⋯`
  create/rename/delete menus on `volume`-kind folder rows are unchanged, so
  creating into `basic/…`, `completions/<family>/…`, or a user folder works as
  before. INTERNAL rows are `archive`/`stdlib`/`stdstale` kinds → no create menu.
- **Trash**: `deletePrim` is unchanged. Soft-delete still moves to `archive/`
  (recoverable). The ARCHIVED folder row inside INTERNAL is a drop target
  (`to=archive`) — drag-to-archive preserved; the INTERNAL tab button also
  routes a drop to `archive`. Archived rows keep permanent-delete.
- **List / move**: `/api/primitives/list` and `move`/`rename`/`mkdir` endpoints
  are untouched. `moveTargets` / `MOVE_TARGET_RE` unchanged, so the "Move to…"
  menu still offers `basic | archive | completions/<family>[/sub]`.
- **stdlib/stdstale**: still read-only (no create/rename/trash, server 403s);
  the client already gates these off by kind.

## Files changed

- `src/routes/primitives/+page.svelte` — rail = 3 fixed tabs; `activeView`
  derived; scoped render iterates `activeView.folders`/`.files`; toolbar uses
  `createPath`; drop-to-tab preserved (BASIC→basic, INTERNAL→archive); onMount
  normalizes any legacy persisted `activeTab`.
- `src/routes/primitives/primitives-tree.ts` — `tabLabel` maps `stdstale`→
  `Stale`, `stdlib`→`Stdlib` (folder-row labels under INTERNAL).
- `docs/plans/sidebar-reorg.md` (this file) + `TODO.md` entry.

## Verification

- `bun run test` (vitest) + `bun run build` green.
- Load `/primitives`: three tabs render; INTERNAL nests ARCHIVED/STDLIB/STALE;
  BASIC lists basic parts + `BASIC_WELL`; WELL lists the completions families;
  create/trash/open still work.
