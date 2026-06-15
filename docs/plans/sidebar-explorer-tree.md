# Plan — Windows-Explorer-style sidebar folder tree (`/primitives`)

Status: PLAN (not started). Reconcile a lane into `/plan` (Rule 19) when scoped.
Memory anchor: `todo_sidebar_tree`.

## User request (verbatim)

> "The sidebar does not have the folders expandable in the same list. I want to
> have the format and behaviour similar to the Windows Explorer."

Plus the earlier related ask:

> "the part+ and +folder should be a menu nav in a + button next to the Basic
> folder name … as we had before"

So two things:

1. **One Explorer-style tree.** The `/primitives` sidebar should render folders
   AND files in ONE scrolling list where folders expand/collapse **in place**
   (children indent beneath, siblings stay visible) — NOT the current drill-in
   vertical folder-TAB rail + breadcrumb navigation that replaces the view.
2. **A single `+` menu** next to a folder name (New part here / New folder
   here), NOT two separate `+part` / `+folder` buttons.

## Key finding — a near-complete prior attempt already exists

`git log --all` shows commit **`2f4a71b`** — *"feat(primitives): rebuild sidebar
as a single expand/collapse file tree"* — living on the **stale worktree branch
`worktree-agent-a423b631d015287f3`** (NOT an ancestor of `main`; never merged).
It touches ONLY `src/routes/primitives/+page.svelte` (+188 / −303) and `bun run
build` was clean.

It already built almost everything the user wants:

- A recursive `folderNode` Svelte snippet (chevron `▸/▾` + `📁/📂` + name +
  subtree-count badge) rendered over the `/api/primitives/list` `tree` field.
- Inline expand/collapse with per-path state in a `Record<string,boolean>`
  persisted to `localStorage` (`prim-tree-expanded`); `basic` + `completions`
  default-expanded.
- `partRow` snippet reworked to take `(entry, depth, kind)` — inline
  `padding-left: 12 + depth*14px` indent, `📄` file icon, source badge, and the
  existing open-tab / drag-to-canvas / `✎` rename / `🗑` trash affordances.
- `stdlib` / `stdstale` surfaced as **synthetic read-only tree branches**
  (`path: '__stdlib'` / `'__stdstale'`, no real on-volume dir → no create /
  rename / trash).
- `subtreeCount()` + `subtreeMatches()` so a live filter force-expands matching
  folders and hides the rest.
- `⛁ Cache` moved to a **footer row** that toggles `<CacheBrowser/>` in MAIN
  (replacing the old cache tab).
- Deleted the entire vertical-tab rail + breadcrumb machinery (`activeTab`,
  `navPath`, `navByTab`, `crumbs`, `selectTab`, `descend`, `isSrcTab`,
  `isCacheTab`, `openGroups`, `openFamilies`, and their CSS).

**What to SALVAGE:** essentially the whole diff — it is the bulk of PR1 + PR2.
Cherry-pick or hand-port `2f4a71b` as the starting point rather than rebuilding
from scratch.

**What to AVOID / FIX (this is exactly the user's complaint):** `2f4a71b`
implemented the per-folder create affordance as **TWO separate hover-revealed
buttons** —

```svelte
{#if kind === 'volume'}
  <button class="prim-folder-act" ... onclick={() => createPartIn(node.path)}>＋</button>
  <button class="prim-folder-act sub" ... onclick={() => createSubfolderIn(node.path)}>＋📁</button>
{/if}
```

The user wants ONE `+` button that opens a small menu (New part / New folder).
PR2 below replaces those two buttons with a single `+` → popover menu.

> Worktree hygiene: `worktree-agent-a423b631d015287f3` is a leftover agent
> worktree. Treat `2f4a71b` as a source to port FROM; do the real work on a
> fresh branch off `main`. Don't try to fast-forward `main` onto that branch
> (it predates current `main` sidebar work — `d304403` inline rename `✎`,
> `1c1fd88` `A↓` sort toggle, `e14f00f` broken-refs scan; the port must keep
> those).

## Data source — `/api/primitives/list` (already tree-shaped)

`src/routes/api/primitives/list/+server.ts` already returns a recursive
`tree: FolderNode` field alongside the flat groups:

```ts
interface FolderNode { name: string; path: string; parts: PrimEntry[]; children: FolderNode[]; }
```

`buildNode()` walks `primitives/` depth-first (capped at depth 4 = the 3-level
resolver cat/family/subfolder + root), excludes the reserved `profiles/` dir,
treats a legacy `<id>/source.ts` folder as a PART not a subdir, and de-dupes
`stdlib`/`stdstale` twins out of every branch. The response also carries
`stdlib` + `stdstale` flat entry lists. **No server change is required** — the
hierarchy the tree needs is already on the wire (Rule 16: location IS category,
derived from the FS, no index to drift).

Endpoints the create/move flows use (confirmed present):

- `POST /api/primitives/mkdir?path=<rel>` — create a folder. 1–3 segments,
  each `[a-z][a-z0-9_]*`; `profiles` reserved; recursive + idempotent; proxied
  to prod. (NOTE: the create-folder call goes through this endpoint, **not**
  `/api/volume?action=mkdir`.)
- `POST /api/primitives/move?id=<id>&to=<category>` — `to` ∈
  `basic | basic/<sub> | archive | completions/<family>(/<sub>)?`. Moving the
  file IS the regroup; id unchanged so cross-refs survive; stdlib rejected
  (403); proxied to prod.

## 1. Tree data model

Render off the server `FolderNode` tree directly — no separate normalization
layer is needed (the server already normalizes). The client adds only:

- **Top-level branches** = `tree.children` (volume dirs: `basic`,
  `completions`, `archive`, plus any user-created top dir — appear
  automatically).
- **Synthetic read-only branches** for engine sources, built client-side as
  `$derived` `FolderNode`s with reserved paths that can never collide with a
  real volume path:
  - `stdlibNode  = { name:'stdlib',   path:'__stdlib',   parts: stdlibSorted,   children:[] }`
  - `stdstaleNode= { name:'stdstale', path:'__stdstale', parts: stdstaleSorted, children:[] }`
- **Expand/collapse state** — `let expanded = $state<Record<string,boolean>>({})`
  keyed by tree path. `isExpanded(path)` defaults `basic` + `completions` open.
  Persist to `localStorage('prim-tree-expanded')`; reload in `onMount`. Helper
  `ensureExpanded(path)` used after create so the new node is visible in place.
  (Using a `Record` rather than a `Set` matches `2f4a71b` and serializes
  cleanly; either is fine — keep ONE.)
- **`kind` propagation** — each branch carries a `kind: 'volume' | 'archive' |
  'stdlib' | 'stdstale'` that decides badge text, which row-actions show, and
  whether create is offered. `archive` files get permanent-delete + no rename;
  `stdlib`/`stdstale` are fully read-only; `volume` gets rename + soft-delete +
  the `+` create menu.

Remove the now-dead nav state: `activeTab`, `navPath`, `navByTab`, `crumbs`,
`selectTab`, `descend`, `currentNode`, `isSrcTab`, `isArchiveTab`,
`isCacheTab`, `openGroups`, `openFamilies`, `toggleGroup`, `toggleFamily`,
`persistNav`, and the localStorage keys `prim-active-tab` / `prim-nav-path` /
`prim-open-groups` / `prim-open-families`.

## 2. Render — recursive folder/file rows (ONE scrolling list)

A recursive `{#snippet folderNode(node, depth, kind)}`:

- Folder row = `▸/▾` chevron + `📁/📂` icon + name + `(subtreeCount)` badge,
  `style="padding-left: {8 + depth*14}px"`, `onclick` toggles expand.
- When open, render `sortFolders(children).filter(subtreeMatches)` first, then
  `sortBy(parts).filter(pass)` as `{@render partRow(e, depth+1, kind)}`, then an
  `empty` / `no matches` placeholder when both are zero.
- Top-of-tree render order: volume `tree.children` (flag `archive` →
  `kind:'archive'`), then `stdlibNode`, then `stdstaleNode`, then the `⛁ Cache`
  footer row.
- Files: `📄` icon + id + source badge; reuse the existing open-tab,
  drag-to-canvas (`draggable` unless coarse pointer), inline `✎` rename
  (preserve the `main` `d304403` flow), and trash (soft → `archive/` for volume,
  permanent for archive entries). Carry the `data-tip` / drift `⚠` affordances
  through unchanged.
- Filter behaviour: while `filter.trim()` is non-empty, treat every folder as
  open and hide non-matching subtrees (`subtreeMatches`). Keep `A↓` sort toggle
  (`main` `1c1fd88`) — `sortFolders` for dirs, `sortBy` for parts.

**Svelte-5 gotchas to heed:**

- `grid_display_none_auto_placement` — the prior tab-rail bug. Render collapsed
  children by **not emitting them at all** (`{#if open}`), NOT by
  `display:none`. Do not put the tree rows in a CSS grid with a fixed track
  count; use plain flex/block rows with inline `padding-left` indent. This is
  how `2f4a71b` does it and is the safe path.
- `{@const}` must be the immediate child of a block tag (it already is inside
  the snippet body).
- Indent is inline-per-depth (`12 + depth*14px`) — no per-level CSS class to
  maintain.

## 3. The single `+` menu (the fix the user asked for)

Replace the two `prim-folder-act` buttons with ONE `+` button on the folder row
(volume kind only), revealed on hover / focus, that opens a small anchored menu:

- **Menu items:** `＋ New part here` → `createPartIn(node.path)`; `📁 New folder
  here` → `createSubfolderIn(node.path)`. (Both functions already exist in
  `2f4a71b` — only the trigger changes.) Optionally a third disabled-styled
  header showing `primitives/<path>/` for orientation.
- **Anchoring / dismissal:** small popover positioned to the `+` button via
  `getBoundingClientRect()`, `position: fixed`, `z-index: 1000` (memory
  `floating_panel_z_index`); close on outside-click and `Escape`; only one menu
  open at a time (track `menuOpenForPath: string | null`). Honor
  `feedback_popup_over_inline` (popups over inline editors) and
  `feedback_no_help_cursor` (no `?` cursor; `data-tip` signals hoverability).
  There is no shared `FloatingPanel.svelte` component in the repo today — the
  existing anchored-popover pattern (see the RAG `✨` prompt popover and
  `floating-tip.ts` in `src/lib/shared/`) is the reference; a ~30-line local
  popover is acceptable rather than introducing a new shared component.
- **Top-level `＋ folder` toolbar button** (already in `2f4a71b`) stays — it
  creates a new top-level dir via `addTopFolder()` → `mkFolder(name)` →
  `ensureExpanded(name)`. (This is the "create at root" entry point that has no
  parent folder row to hang a `+` on.)
- `expand_on_icon_click` — opening the menu (or creating into a folder) should
  `ensureExpanded(node.path)` so the result is immediately visible in place.
- Keep the name prompts (`window.prompt`) exactly as `2f4a71b` has them for
  PR2; a nicer inline-name affordance is out of scope (and would re-trip the
  inline-vs-popup convention) unless the user asks.

## 4. Behaviour parity

- **Create-into-active-dir** — `createPartIn(dir)` opens a fresh tab with
  `openTab(id, dir)`; the `.prim.ts` lands in `dir` on first Save (location IS
  category, Rule 16). `createSubfolderIn(parent)` enforces max depth 3 and calls
  `mkdir`. Both already correct in `2f4a71b`.
- **Trash → archive/** — volume files keep `🗑` soft-delete (moves to
  `primitives/archive/`); archive-branch files keep permanent-delete. Unchanged.
- **Move between folders** — there is currently NO move UI in the sidebar (the
  header comment even says "no … move"), though `POST /api/primitives/move`
  exists and `to` accepts `basic[/<sub>] | archive | completions/<family>[/<sub>]`.
  - **PR4 (optional, Explorer-true):** drag a file row onto a folder row →
    `move?id=&to=<folder.path>`, with the folder row showing a drop-target
    highlight on `dragover`. Reuse the existing `draggable` file rows (today
    they drag onto the canvas to drop a `Call`); a folder-row drop target is the
    new bit. Watch `touch_implicit_pointer_capture` for mobile (set
    `touch-action:none` + `releasePointerCapture` at drag start) — or simply
    gate drag-move to non-coarse pointers and ship a right-click / `…` "Move
    to…" menu item as the touch fallback. Confirm scope with the user before
    building PR4; the user's literal ask is the tree + the `+` menu, so PR4 is a
    nice-to-have that completes Explorer parity.

## 5. Risk-sequenced, smallest-first PRs

Each PR: `bun run build` clean + `bun run test:volume` green (the volume e2e
exercises `/primitives`); record an e2e run per Rule 12; prompt for headed/
headless per Rule 11. Per Rule 23 (non-trivial UI flow rebuild), add a
gitignored subagent test spec in `.claude/agents/` that drives the real tree in
Chrome AND verifies via curl, runs twice identical, before calling it done.

- **PR1 — Tree model + read-only render.** Port the `2f4a71b` `folderNode` /
  `partRow(depth,kind)` snippets, `expanded` state + persistence,
  `subtreeCount` / `subtreeMatches` / `sortFolders`, synthetic `stdlib` /
  `stdstale` nodes, and the `⛁ Cache` footer row. Delete the vertical-tab rail +
  breadcrumb + group/family fold machinery and dead CSS. Keep the `main`-side
  inline rename (`d304403`) and `A↓` sort (`1c1fd88`). Ship WITHOUT the new
  create menu yet (temporarily keep `2f4a71b`'s two buttons OR a single
  no-op-stubbed `+`). Verify: every existing volume part + stdlib/stdstale
  appears once, folders expand/collapse in place, filter force-expands.
  *Highest line-churn, lowest behavioural risk — it's a render swap.*
- **PR2 — Single `+` menu + create/rename/trash wiring.** Replace the two
  `prim-folder-act` buttons with the one `+` → popover menu (New part / New
  folder). Wire `createPartIn` / `createSubfolderIn` / `addTopFolder` to it;
  confirm soft-trash → `archive/` and permanent-delete in the archive branch.
  Verify create lands the file in the clicked folder (curl `/list` shows new
  path) and the folder auto-expands.
- **PR3 — Persistence + filter polish.** Confirm `prim-tree-expanded` survives
  reload; default-open `basic` + `completions`; collapse-all / expand-all is
  optional. Make sure a stored path whose dir was deleted degrades gracefully
  (stale keys are harmless — `isExpanded` just returns its default). Edge: empty
  folders show `empty`, filtered-empty show `no matches`.
- **PR4 — (optional) drag-move into a folder.** Folder-row drop target →
  `move?id=&to=path`; optimistic move + reconcile against `/list`
  (`prod_list_staleness`). Non-coarse pointers only, with a "Move to…" menu
  fallback for touch. Gate behind user go-ahead.

## Touch surface

- `src/routes/primitives/+page.svelte` — the ONLY file that changes (matches
  `2f4a71b`). No server change; `/api/primitives/{list,mkdir,move}` already
  cover the data + mutations.

## Acceptance

- Folders and files in ONE scrolling list; clicking a folder expands/collapses
  in place with siblings still visible; nested `completions/<family>/<sub>`
  expand recursively.
- A single `+` next to a folder name opens a menu with New part / New folder
  (no two-button affordance anywhere).
- stdlib/stdstale read-only branches + `⛁ Cache` footer preserved; rename /
  soft-trash / permanent-delete / drag-to-canvas parity intact; expand state
  persists across reload.
