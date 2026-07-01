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

/** Valid move/copy destination paths (the server's CAT_RE): basic | archive |
 *  completions/<family> (+ one optional <sub>), each segment [a-z][a-z0-9_]*. */
export const MOVE_TARGET_RE = /^((?:basic|archive)(?:\/[a-z][a-z0-9_]*)?|completions\/[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)?)$/i;

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
