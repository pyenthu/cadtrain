// app_components/NodeTree/node-tree-layout.ts — PURE, headless layout math for the NodeTree
// component (an SSR-safe architecture graph). No Svelte, no DOM: normalize raw node/edge
// records → typed shapes, compute each node's DEPTH from its parentId chain, lay the forest out
// LEFT→RIGHT (x = depth·colWidth) with siblings stacked and parents centred over their subtree
// (y walks descendants), and render edge connectors as pure SVG path strings. Kept separate from
// NodeTree.svelte so it is unit-testable under vitest (environment:'node'). Mirrors the
// gantt-layout.ts pattern. See src/lib/app_components/CLAUDE.md + src/routes/design/architecture.ts.

// ──────────────────────────────────────────────────────────
// Record shapes (what a seeded list<record> variable holds)
// ──────────────────────────────────────────────────────────
export interface TreeNode {
  id: string;
  label: string;
  /** Parent node id; absent (or unresolved) → a root at depth 0. */
  parentId?: string;
  /** Colour bucket: system · container · route · api · lib · store · person · external. */
  kind: string;
  /** Optional per-node accent (overrides the kind stroke) — e.g. a container's C4 accent. */
  accent?: string;
  /** Technology label (containers/systems) shown as a second line. */
  tech?: string;
  blurb?: string;
  /** Route/api nodes may be clickable. */
  href?: string;
  /** Grayed + dashed (a planned/not-yet-built node). */
  planned?: boolean;
  /** Dashed + faded (an archived/deprecated node). */
  archived?: boolean;
}

export interface TreeEdge {
  source: string;
  target: string;
  /** Relationship bucket: summary · calls · mounts · flow · reads · writes · nav. */
  kind?: string;
  label?: string;
}

/** Which source-record keys map onto the normalized node fields. */
export interface NodeFieldMap {
  id?: string;
  label?: string;
  parentId?: string;
  kind?: string;
  accent?: string;
  tech?: string;
  blurb?: string;
  href?: string;
  planned?: string;
  archived?: string;
}
export interface EdgeFieldMap {
  source?: string;
  target?: string;
  kind?: string;
  label?: string;
}

const DEFAULT_NODE_FIELDS: Required<NodeFieldMap> = {
  id: 'id',
  label: 'label',
  parentId: 'parentId',
  kind: 'kind',
  accent: 'accent',
  tech: 'tech',
  blurb: 'blurb',
  href: 'href',
  planned: 'planned',
  archived: 'archived',
};
const DEFAULT_EDGE_FIELDS: Required<EdgeFieldMap> = {
  source: 'source',
  target: 'target',
  kind: 'kind',
  label: 'label',
};

/** Coerce an unknown source array into typed TreeNodes. Non-objects are dropped; id falls back
 *  to the index, label to the id, kind to 'lib'. An empty/absent parentId → a root. */
export function normalizeNodes(raw: unknown, fields: NodeFieldMap = {}): TreeNode[] {
  if (!Array.isArray(raw)) return [];
  const f = { ...DEFAULT_NODE_FIELDS, ...fields };
  const out: TreeNode[] = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const rec = r as Record<string, unknown>;
    const id = String(rec[f.id] ?? i);
    const pid = rec[f.parentId];
    out.push({
      id,
      label: String(rec[f.label] ?? rec[f.id] ?? id),
      parentId: pid != null && pid !== '' ? String(pid) : undefined,
      kind: String(rec[f.kind] ?? 'lib'),
      accent: rec[f.accent] != null ? String(rec[f.accent]) : undefined,
      tech: rec[f.tech] != null ? String(rec[f.tech]) : undefined,
      blurb: rec[f.blurb] != null ? String(rec[f.blurb]) : undefined,
      href: rec[f.href] != null ? String(rec[f.href]) : undefined,
      planned: !!rec[f.planned],
      archived: !!rec[f.archived],
    });
  });
  return out;
}

/** Coerce an unknown source array into typed TreeEdges. Edges missing source or target drop. */
export function normalizeEdges(raw: unknown, fields: EdgeFieldMap = {}): TreeEdge[] {
  if (!Array.isArray(raw)) return [];
  const f = { ...DEFAULT_EDGE_FIELDS, ...fields };
  const out: TreeEdge[] = [];
  raw.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const rec = r as Record<string, unknown>;
    const s = rec[f.source];
    const t = rec[f.target];
    if (s == null || t == null) return;
    out.push({
      source: String(s),
      target: String(t),
      kind: rec[f.kind] != null ? String(rec[f.kind]) : undefined,
      label: rec[f.label] != null ? String(rec[f.label]) : undefined,
    });
  });
  return out;
}

/** depth(id) = number of parentId hops to a root. Cycle-safe (a back-edge stops at 0); an
 *  unknown/absent parent → 0. Memoized across calls. */
export function computeDepths(nodes: TreeNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const d = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id) as number;
    const n = byId.get(id);
    const pid = n?.parentId;
    if (!pid || !byId.has(pid) || seen.has(id)) {
      depth.set(id, 0);
      return 0;
    }
    seen.add(id);
    const v = 1 + d(pid, seen);
    depth.set(id, v);
    return v;
  };
  for (const n of nodes) d(n.id, new Set());
  return depth;
}

export interface LaidNode extends TreeNode {
  depth: number;
  /** Fractional row index (leaves are integers 0..L-1; parents are centred between children). */
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface LaidLink {
  source: string;
  target: string;
  /** 'hier' for a parent→child skeleton link; else the edge's kind. */
  kind: string;
  label?: string;
  path: string;
  mid: { x: number; y: number };
  /** Rightmost x the connector reaches — a same-column arc bows past the last column, so the SVG
   *  width must grow to it or the arc clips. */
  right: number;
}

export interface LayoutOpts {
  colWidth?: number;
  nodeW?: number;
  nodeH?: number;
  rowGap?: number;
  marginX?: number;
  marginY?: number;
}

export interface TreeLayout {
  nodes: LaidNode[];
  byId: Record<string, LaidNode>;
  /** Parent→child skeleton connectors (drawn subtly). */
  links: LaidLink[];
  width: number;
  height: number;
  opts: Required<LayoutOpts>;
}

const DEFAULT_OPTS: Required<LayoutOpts> = {
  colWidth: 210,
  nodeW: 172,
  nodeH: 40,
  rowGap: 46,
  marginX: 20,
  marginY: 28,
};

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A cubic-bezier connector between two points with horizontal control handles. Pure string. */
export function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(24, Math.abs(x2 - x1) * 0.5);
  return `M${round(x1)},${round(y1)} C${round(x1 + dx)},${round(y1)} ${round(x2 - dx)},${round(y2)} ${round(x2)},${round(y2)}`;
}

/** A vertical C-curve that exits (x,y1) rightward, bows out by `bulge`, and re-enters at (x,y2).
 *  For an edge between two nodes in the SAME column (equal depth → equal x, e.g. a route calling an
 *  api stacked below it) where a straight L→R connector would loop back THROUGH the boxes. The
 *  deepest column is rightmost, so bowing right stays on open canvas. Pure string. */
export function sideArcPath(x: number, y1: number, y2: number, bulge: number): string {
  return `M${round(x)},${round(y1)} C${round(x + bulge)},${round(y1)} ${round(x + bulge)},${round(y2)} ${round(x)},${round(y2)}`;
}

/** Lay the node forest out L→R by depth. Siblings stack (rowGap apart); a parent centres between
 *  its first and last child. Returns absolute geometry + parent→child skeleton links + canvas size. */
export function layoutTree(nodes: TreeNode[], opts: LayoutOpts = {}): TreeLayout {
  const o = { ...DEFAULT_OPTS, ...opts };
  const idset = new Set(nodes.map((n) => n.id));
  const depths = computeDepths(nodes);

  // children in input order; roots = nodes whose parent is missing/unresolved (input order).
  const childrenOf = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    if (n.parentId && idset.has(n.parentId)) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n);
      childrenOf.set(n.parentId, arr);
    } else {
      roots.push(n);
    }
  }

  // DFS assigns each LEAF the next integer row; a parent centres between its first/last child.
  const rowOf = new Map<string, number>();
  let cursor = 0;
  const assign = (n: TreeNode): void => {
    const kids = childrenOf.get(n.id) ?? [];
    if (kids.length === 0) {
      rowOf.set(n.id, cursor);
      cursor += 1;
      return;
    }
    for (const k of kids) assign(k);
    const rows = kids.map((k) => rowOf.get(k.id) as number);
    rowOf.set(n.id, (Math.min(...rows) + Math.max(...rows)) / 2);
  };
  for (const r of roots) assign(r);
  const leafCount = cursor;

  let maxDepth = 0;
  const laid: LaidNode[] = nodes.map((n) => {
    const depth = depths.get(n.id) ?? 0;
    const row = rowOf.get(n.id) ?? 0;
    if (depth > maxDepth) maxDepth = depth;
    const x = o.marginX + depth * o.colWidth;
    const cy = o.marginY + o.nodeH / 2 + row * o.rowGap;
    return { ...n, depth, row, x, y: cy - o.nodeH / 2, w: o.nodeW, h: o.nodeH, cx: x + o.nodeW / 2, cy };
  });

  const byId: Record<string, LaidNode> = {};
  for (const n of laid) byId[n.id] = n;

  // parent→child skeleton links (drawn under the seeded edges).
  const links: LaidLink[] = [];
  for (const n of laid) {
    const p = n.parentId ? byId[n.parentId] : undefined;
    if (!p) continue;
    links.push({
      source: p.id,
      target: n.id,
      kind: 'hier',
      path: linkPath(p.x + p.w, p.cy, n.x, n.cy),
      mid: { x: (p.x + p.w + n.x) / 2, y: (p.cy + n.cy) / 2 },
      right: Math.max(p.x + p.w, n.x),
    });
  }

  const width = o.marginX * 2 + maxDepth * o.colWidth + o.nodeW;
  const height = o.marginY * 2 + Math.max(0, leafCount - 1) * o.rowGap + o.nodeH;
  return { nodes: laid, byId, links, width, height, opts: o };
}

/** Resolve seeded edges to drawable connectors, attaching at the near box edges (source right →
 *  target left when target is to the right; else the mirrored sides). Endpoints not present drop. */
export function layoutEdges(edges: TreeEdge[], byId: Record<string, LaidNode>): LaidLink[] {
  const out: LaidLink[] = [];
  for (const e of edges) {
    const s = byId[e.source];
    const t = byId[e.target];
    if (!s || !t) continue;
    const kind = e.kind ?? 'calls';
    // Same column (equal depth, e.g. route→api both at the deepest level): a straight L→R connector
    // would exit the right edge and loop back to the same-column left edge, drawing a teardrop over
    // the boxes. Instead bow a clean vertical C-curve out the shared right edge (open canvas).
    if (s.depth === t.depth) {
      const x = Math.max(s.x + s.w, t.x + t.w);
      const bulge = Math.min(150, Math.max(30, Math.abs(t.cy - s.cy) * 0.42));
      out.push({
        source: e.source,
        target: e.target,
        kind,
        label: e.label,
        path: sideArcPath(x, s.cy, t.cy, bulge),
        mid: { x: x + bulge * 0.66, y: (s.cy + t.cy) / 2 },
        right: x + bulge,
      });
      continue;
    }
    // Different column → attach at the near edges (source-right → target-left, or mirrored for a
    // back-edge that points leftward) with horizontal handles.
    let x1: number;
    let x2: number;
    if (t.cx >= s.cx) {
      x1 = s.x + s.w;
      x2 = t.x;
    } else {
      x1 = s.x;
      x2 = t.x + t.w;
    }
    out.push({
      source: e.source,
      target: e.target,
      kind,
      label: e.label,
      path: linkPath(x1, s.cy, x2, t.cy),
      mid: { x: (x1 + x2) / 2, y: (s.cy + t.cy) / 2 },
      right: Math.max(x1, x2),
    });
  }
  return out;
}

/** The SVG width needed to show `layout` plus any connectors that bow past the last column (a
 *  same-column arc). Max of the tree width and every laid edge's rightmost reach + a small gutter. */
export function canvasWidth(layout: TreeLayout, laidEdges: LaidLink[]): number {
  let max = layout.width;
  for (const e of laidEdges) if (e.right + layout.opts.marginX > max) max = e.right + layout.opts.marginX;
  return round(max);
}

// ──────────────────────────────────────────────────────────
// Palette — node colours by kind, edge colours by relationship kind
// ──────────────────────────────────────────────────────────
export interface NodeColor {
  fill: string;
  stroke: string;
  text: string;
}

export const NODE_COLORS: Record<string, NodeColor> = {
  system: { fill: '#e2e8f0', stroke: '#475569', text: '#1e293b' },
  container: { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e3a8a' },
  route: { fill: '#e0f2fe', stroke: '#0284c7', text: '#075985' },
  api: { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  lib: { fill: '#ffedd5', stroke: '#ea580c', text: '#7c2d12' },
  store: { fill: '#f3e8ff', stroke: '#9333ea', text: '#581c87' },
  person: { fill: '#f1f5f9', stroke: '#64748b', text: '#334155' },
  external: { fill: '#f8fafc', stroke: '#94a3b8', text: '#475569' },
};

export function nodeColor(kind: string): NodeColor {
  return NODE_COLORS[kind] ?? NODE_COLORS.lib;
}

export const EDGE_COLORS: Record<string, string> = {
  summary: '#475569',
  calls: '#0284c7',
  mounts: '#6366f1',
  flow: '#f59e0b',
  reads: '#16a34a',
  writes: '#dc2626',
  nav: '#64748b',
  hier: '#cbd5e1',
};

export function edgeColor(kind: string): string {
  return EDGE_COLORS[kind] ?? '#94a3b8';
}

/** The distinct node kinds present, in first-seen order, each with its colour — for a legend. */
export function nodeLegend(nodes: TreeNode[]): Array<{ kind: string; color: NodeColor; count: number }> {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (!counts.has(n.kind)) order.push(n.kind);
    counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  }
  return order.map((kind) => ({ kind, color: nodeColor(kind), count: counts.get(kind) as number }));
}

/** Trim a label to at most `n` chars with an ellipsis (SVG text has no CSS truncation). */
export function truncate(s: string, n = 24): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
