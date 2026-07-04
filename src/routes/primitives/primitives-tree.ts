/**
 * primitives-tree.ts — pure folder-tree helpers for the /primitives sidebar.
 *
 * EXTRACTED 2026-06-16 (modularize plan P11, step 1 — the safe pure-logic cut
 * before the Sidebar component extraction). Every function here is PURE: state
 * the in-component versions closed over (`tree`, `sortMode`, the filter `pass`
 * predicate) is now an explicit parameter. No `$state`, no mutation, no DOM —
 * so relocating them cannot change rendering. Outputs are byte-identical to the
 * originals for the same inputs.
 */

/** A primitive file row in the sidebar. */
export interface Entry { id: string; source: 'bundle' | 'volume' | 'stdlib' | 'stdstale'; }

/** A folder node in the on-volume tree (basic / completions/<family>/… / archive). */
export interface FolderNode { name: string; path: string; parts: Entry[]; children: FolderNode[]; }

/** Valid move/copy destination paths — kept in sync with the server's CAT_RE
 *  (`/api/primitives/move`) AND the mkdir PATH_RE (`/api/primitives/mkdir`), so
 *  ANY user-created folder is a legal target (Rule 16 — location IS category).
 *  1–3 segments of `[a-z][a-z0-9_]*`; the reserved top-level names `profiles`
 *  (profile store) and `stdlib` / `stdstale` (read-only src engines) are excluded. */
export const MOVE_TARGET_RE = /^(?!(?:profiles|stdlib|stdstale)(?:\/|$))[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*){0,2}$/i;

/** Display label for a top-level folder name. */
export function tabLabel(name: string): string {
  if (name === 'archive') return 'Archived';
  if (name === 'stdlib') return 'Stdlib';
  if (name === 'stdstale') return 'Stale';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Total parts in a subtree (direct + all descendants) — the folder count badge. */
export function subtreeCount(node: FolderNode): number {
  return node.parts.length + node.children.reduce((n, c) => n + subtreeCount(c), 0);
}

/** True when `node` (or any descendant) has a part matching the live filter.
 *  `pass` is the per-entry filter predicate (returns true for all when the
 *  filter box is empty, so this returns true then too). */
export function subtreeMatches(node: FolderNode, pass: (e: Entry) => boolean): boolean {
  return node.parts.some(pass) || node.children.some((c) => subtreeMatches(c, pass));
}

/** Folder children in the current sort mode (alpha by name; default = readdir order). */
export function sortFolders(xs: FolderNode[], sortMode: 'default' | 'alpha'): FolderNode[] {
  return sortMode === 'alpha' ? [...xs].sort((a, b) => a.name.localeCompare(b.name)) : xs;
}

/** Walk the tree to the node at a relative path ('' → root, else by name segments). */
export function nodeAt(tree: FolderNode | null, path: string): FolderNode | null {
  if (!tree) return null;
  if (!path) return tree;
  let n: FolderNode = tree;
  for (const seg of path.split('/')) {
    const c = n.children.find((x) => x.name === seg);
    if (!c) return null;
    n = c;
  }
  return n;
}

/** The folder path that holds part `id`, or null. */
export function findPartDir(tree: FolderNode | null, id: string): string | null {
  if (!tree) return null;
  const walk = (n: FolderNode): string | null => {
    if (n.parts.some((p) => p.id === id)) return n.path;
    for (const c of n.children) { const r = walk(c); if (r != null) return r; }
    return null;
  };
  return walk(tree);
}

/** Valid move/copy destinations from the tree (excludes `fromDir`, the bare
 *  `completions` container, and anything not matching MOVE_TARGET_RE), with the
 *  nesting depth for indenting the menu. */
export function moveTargets(tree: FolderNode | null, fromDir: string): { path: string; depth: number }[] {
  const out: { path: string; depth: number }[] = [];
  const walk = (n: FolderNode, depth: number) => {
    if (n.path && n.path !== fromDir && MOVE_TARGET_RE.test(n.path)) out.push({ path: n.path, depth });
    for (const c of n.children) walk(c, depth + 1);
  };
  if (tree) for (const c of tree.children) walk(c, 0);
  return out;
}

/** True when the folder at `path` is a legal move/copy destination for a part
 *  currently in `excludeDir` ('' = allow every folder, for copy-in-place). It
 *  must be a non-root path matching MOVE_TARGET_RE and not the source folder.
 *  Drives both the flat and the tabbed-tree pickers. */
export function isMoveTarget(path: string, excludeDir: string): boolean {
  return !!path && path !== excludeDir && MOVE_TARGET_RE.test(path);
}

/** The top-level folder name that owns `path` ('completions/svtc' → 'completions').
 *  Used to pre-select the move-picker tab for the part's current folder and to
 *  route a freshly-created folder to the right sidebar tab. Empty for ''. */
export function topLevelOf(path: string): string {
  return path ? (path.split('/')[0] ?? '') : '';
}

/** Built-in folders that can't be MOVED as a source (they anchor the sidebar
 *  layout). Kept in sync with the server's PROTECTED set in
 *  `/api/primitives/folder/move`. */
export const FOLDER_PROTECTED_ROOTS = new Set(['basic', 'completions', 'archive', 'profiles']);
/** Reserved top-level buckets — never a valid folder-move source OR target.
 *  Kept in sync with the server's INTERNAL set in `/api/primitives/folder/move`. */
export const FOLDER_INTERNAL_TOPS = new Set(['archive', 'stdlib', 'stdstale', 'profiles']);
/** 1–3 segments of [a-z][a-z0-9_]* — the server's folder-move PATH_RE. */
const FOLDER_PATH_RE = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*){0,2}$/i;

/** True when `maybe` is `ancestor` itself or nested underneath it. Segment-aware
 *  so `basic/foo` is NOT reported as under `basic/foobar` (a raw `startsWith`
 *  would get that wrong). Used to reject dropping a folder into its own subtree. */
export function isPathAtOrUnder(ancestor: string, maybe: string): boolean {
  if (!ancestor) return true; // the root contains everything
  return maybe === ancestor || maybe.startsWith(`${ancestor}/`);
}

/** Pure validity + destination for dropping FOLDER `from` INTO folder `to`
 *  (nesting): the moved folder becomes `${to}/${leaf(from)}`. Returns
 *  `{ ok, dest, reason? }`. Mirrors every guard in the server's
 *  `/api/primitives/folder/move` so an invalid drop never fires a doomed
 *  request AND the drop-target highlight only appears on legal targets:
 *    - both paths must be 1–3 segment volume folder paths,
 *    - `from` can't be a built-in root (basic/completions/archive/profiles),
 *    - neither top segment may be an internal bucket (archive/stdlib/stdstale/profiles),
 *    - `to` can't be `from` itself or anywhere inside `from`'s subtree,
 *    - the result can't already be where `from` lives (drop onto its own parent = no-op),
 *    - the nested result can't exceed the 3-segment depth limit.
 *  `reason === 'already there'` is the benign no-op case (silent). */
export function folderMoveInto(from: string, to: string): { ok: boolean; dest: string; reason?: string } {
  const bad = (reason: string) => ({ ok: false, dest: '', reason });
  if (!from || !to) return bad('missing path');
  if (!FOLDER_PATH_RE.test(from)) return bad(`"${from}" is not a movable folder`);
  if (!FOLDER_PATH_RE.test(to)) return bad(`"${to}" is not a valid destination folder`);
  if (FOLDER_PROTECTED_ROOTS.has(from.toLowerCase())) return bad(`"${from}" is a built-in folder and can't be moved`);
  const fromTop = from.split('/')[0].toLowerCase();
  const toTop = to.split('/')[0].toLowerCase();
  if (FOLDER_INTERNAL_TOPS.has(fromTop)) return bad(`"${from}" is internal (archive / stdlib / stale) and can't be moved`);
  if (FOLDER_INTERNAL_TOPS.has(toTop)) return bad(`"${to}" is an internal bucket — not a drop target`);
  // Dropping a folder onto itself or into its own descendant would orphan it.
  if (isPathAtOrUnder(from, to)) return bad(`can't move "${from}" into itself or its own subtree`);
  const leaf = from.split('/').pop()!;
  const dest = `${to}/${leaf}`;
  if (dest === from) return bad('already there'); // dropped back onto its current parent
  if (dest.split('/').length > 3) return bad('nesting too deep (max 3 levels)');
  return { ok: true, dest };
}

/** Insert an (empty) folder at `path` into `tree`, creating any missing
 *  intermediate nodes. Returns true when the tree actually gained a node (the
 *  path was absent); false when every segment already existed. MUTATES `tree`
 *  in place — the caller reassigns for reactivity. This is the folder analogue
 *  of the parts `pendingCreated` optimistic insert: the proxied /list lags
 *  writes by seconds (memory prod_list_staleness), so a brand-new folder needs
 *  to be surfaced immediately rather than waiting for the server to catch up. */
export function ensureFolderPath(tree: FolderNode, path: string): boolean {
  if (!path) return false;
  let n: FolderNode = tree;
  let acc = '';
  let changed = false;
  for (const seg of path.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg;
    let c = n.children.find((x) => x.name === seg);
    if (!c) {
      c = { name: seg, path: acc, parts: [], children: [] };
      n.children = [...n.children, c];
      changed = true;
    }
    n = c;
  }
  return changed;
}
