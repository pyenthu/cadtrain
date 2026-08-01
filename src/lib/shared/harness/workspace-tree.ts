// src/lib/shared/harness/workspace-tree.ts — PURE workspace-tree + file-ref logic.
//
// A `.app` runs from a local DATA file plus sibling data files (a DLIS + a LAS, …). The
// durable link between the `.app` and those files is a REFERENCE — { name, path, type } —
// NOT bytes and NOT a handle (neither survives serialization). On reload the harness walks
// the re-opened workspace directory into a tree of FileNodes (each carrying its live FSA
// handle) and matches each stored ref back to a node by PATH → NAME. This module is that
// matching, with NO DOM / FSA / IndexedDB, so it is Node-testable. The browser store
// (workspace.svelte.ts) builds the trees + owns the handles; it delegates matching here.
//
// Mirrors SVTC's proven shape (src/lib/datasource/*): documents store refs, the workspace
// dir handle is the single anchor, resolution is path-first with a name fallback.

/** A persisted reference to a data file backing a slot (§0.5). Just enough to re-resolve
 *  against the workspace on reload — NO bytes, NO handle. `path` is slash-joined RELATIVE
 *  to the workspace root (excludes the root dir's own name). */
export interface FileRef {
  /** Base name, e.g. "well-a.wson". */
  name: string;
  /** Workspace-relative slash path, e.g. "wells/well-a.wson" (or just the name at root). */
  path: string;
  /** Optional data-file type hint (extension / mime) — carried, never used for matching. */
  type?: string;
}

/** A node in the workspace file tree. `handle` is a live FileSystemHandle in the browser,
 *  absent in tests (matching never dereferences it — the caller reads the handle). */
export interface FileNode {
  name: string;
  kind: 'file' | 'dir';
  /** Path relative to the workspace root — the root itself is '', its children are their name. */
  path: string;
  handle?: unknown;
  children?: FileNode[];
}

/** Normalize a path for storage + comparison: '\'→'/', strip leading './' and '/', drop empty
 *  and '.' segments, collapse repeated slashes. Case + the rest are preserved verbatim. */
export function normalizePath(path: string): string {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/');
}

/** Build a ref from its parts (path is normalized). `type` omitted when falsy. */
export function makeRef(name: string, path: string, type?: string): FileRef {
  return { name, path: normalizePath(path), ...(type ? { type } : {}) };
}

/** Build a ref straight from a workspace FileNode. */
export function refFromNode(node: Pick<FileNode, 'name' | 'path'>, type?: string): FileRef {
  return makeRef(node.name, node.path, type);
}

/** Depth-first flatten of a tree to its FILE nodes only (dirs excluded), sorted by path.
 *  Handy for a flat "pick a file" list in the studio. Null tree → []. */
export function flattenFiles(root: FileNode | null | undefined): FileNode[] {
  const out: FileNode[] = [];
  const walk = (n: FileNode | null | undefined) => {
    if (!n) return;
    if (n.kind === 'file') out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Resolve a ref against a tree. PATH-first: an exact normalized-path match wins. Fallback:
 *  the base NAME, but only when it is UNIQUE in the tree (an ambiguous name never silently
 *  binds to the wrong file — the studio surfaces it as "not linked"). Returns null if unmatched
 *  or the tree is absent. */
export function resolveRefNode(
  root: FileNode | null | undefined,
  ref: FileRef | null | undefined,
): FileNode | null {
  if (!root || !ref) return null;
  const files = flattenFiles(root);
  const wantPath = normalizePath(ref.path || ref.name);
  const byPath = files.find((f) => normalizePath(f.path) === wantPath);
  if (byPath) return byPath;
  const byName = files.filter((f) => f.name === ref.name);
  return byName.length === 1 ? (byName[0] ?? null) : null;
}

/** The link state of a ref given the current workspace tree — drives the studio's status badge. */
export type LinkStatus = 'linked' | 'missing' | 'no-workspace';

export function linkStatus(root: FileNode | null | undefined, ref: FileRef | null | undefined): LinkStatus {
  if (!ref) return 'missing';
  if (!root) return 'no-workspace';
  return resolveRefNode(root, ref) ? 'linked' : 'missing';
}
