/**
 * Shared helpers for the /design "Folder tree" hierarchy views.
 *
 * Four sibling layouts (Treemap · Icicle · Circle pack · Tree) all render the
 * SAME `FOLDER_TREE` data via d3-hierarchy. This module holds the bits they
 * share so the visual language stays identical: the area colour palette, the
 * "area key" (the top folder under src/ that a node belongs to), LOC/label
 * formatting, and the tooltip payload shape.
 */
import type { HierarchyNode } from 'd3-hierarchy';
import type { FolderNode } from './folder-tree';

/** A muted, print-friendly palette — one hue per top-level area. */
export const AREA_PALETTE = [
  '#cc2222', // accent red
  '#2f6db3', // blue
  '#3f9e6b', // green
  '#c07a1e', // amber
  '#7a4fb0', // purple
  '#1f9ea6', // teal
  '#b0416f', // magenta
  '#5a7d2a', // olive
  '#946b3d', // brown
  '#4a5b8c', // slate
  '#a6431f', // rust
  '#5f6b74', // grey (files at root / fallback)
] as const;

/**
 * The "area" a node belongs to — the folder that gives it its colour.
 *
 * src/ (depth 0) is the root; its direct children (depth 1) are `lib`,
 * `routes` and a few loose files. Almost everything lives under `lib` or
 * `routes`, so keying purely on depth-1 collapses to two colours. We take the
 * most informative top-level area: the ancestor at depth 2 when it exists
 * (e.g. `cad`, `server`, `primitives`, `vocab`), else the depth-1 name.
 */
export function areaKey(node: HierarchyNode<FolderNode>): string {
  const anc = node.ancestors().reverse(); // [root, …, node]
  return anc[2]?.data.name ?? anc[1]?.data.name ?? anc[0]?.data.name ?? 'src';
}

/** Build a stable name→colour map from the areas present in the tree. */
export function makeAreaColor(
  root: HierarchyNode<FolderNode>,
): (node: HierarchyNode<FolderNode>) => string {
  const areas: string[] = [];
  root.each((n) => {
    const k = areaKey(n);
    if (!areas.includes(k)) areas.push(k);
  });
  areas.sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  areas.forEach((a, i) => map.set(a, AREA_PALETTE[i % AREA_PALETTE.length]));
  return (node) => map.get(areaKey(node)) ?? AREA_PALETTE[AREA_PALETTE.length - 1];
}

/** Lighten a hex colour toward white by `amt` (0..1) — used for depth shading. */
export function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const to2 = (c: number) => mix(c).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function fmtLoc(n: number | undefined): string {
  if (!n) return '0';
  return n.toLocaleString('en-US');
}

/** A node is a folder iff it has children in the source data. */
export function isFolder(node: HierarchyNode<FolderNode>): boolean {
  return !!(node.data.children && node.data.children.length);
}

/** Payload for the shared floating tooltip. */
export interface TipData {
  path: string;
  kind: 'file' | 'folder';
  loc: number;
}

export function tipFor(node: HierarchyNode<FolderNode>): TipData {
  return {
    path: node.data.path,
    kind: isFolder(node) ? 'folder' : 'file',
    // node.value is the summed LOC (folders) or own LOC (files).
    loc: node.value ?? node.data.loc ?? 0,
  };
}
