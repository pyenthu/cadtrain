// svg-silhouette.ts — PURE silhouette + crease outline extraction for the SVG
// emitter (batch-5b Phase 1). NO THREE, NO DOM, NO module state — typed-array /
// plain-number in, plain-number out — so it unit-tests in the bare `node` vitest
// env like svg-reduce.ts.
//
// The old outline projected EVERY 20° crease segment straight from
// `THREE.EdgesGeometry`, so a curved surface read as a web of triangle chords.
// This instead extracts only the DRAWABLE outline:
//
//   • SILHOUETTE — an edge whose two adjacent faces face OPPOSITE ways relative
//     to the view (one front-facing, one back-facing). View-dependent → the
//     classification is recomputed per camera (cheap; the adjacency is not).
//   • CREASE     — an edge whose two adjacent faces meet at a dihedral angle
//     ABOVE a threshold (a hard edge: box corners, shoulders). View-independent.
//   • BOUNDARY   — an edge with only ONE adjacent face (an open / cut-mesh rim).
//
// Contiguous drawn edges chain into polylines; near-collinear runs collapse to a
// single segment (kills the facet chords on smooth curves).
//
// Adjacency is welded by POSITION, not by vertex index: the bake hands
// non-indexed meshes where a shared edge's two triangles carry DISTINCT indices
// at IDENTICAL coordinates, so index adjacency would treat every edge as a
// boundary (memory: `r_sweep_normals_and_twist` — weld adjacency by position).

export interface SilhouetteInput {
  /** Triangle count. */
  triN: number;
  /** Per-triangle vertex indices (into `pos`). */
  a: ArrayLike<number>;
  b: ArrayLike<number>;
  c: ArrayLike<number>;
  /** Local vertex positions, xyz interleaved. */
  pos: ArrayLike<number>;
}

export interface OutlineEdge {
  /** Welded endpoint ids (into `WeldedAdjacency.vpos`). */
  v0: number;
  v1: number;
  /** Adjacent face ids. `f1 === -1` → boundary edge. */
  f0: number;
  f1: number;
}

export interface WeldedAdjacency {
  /** Welded vertex local positions, xyz interleaved (representative per weld). */
  vpos: number[];
  /** Per-triangle geometric UNIT normals, xyz interleaved (length 3·triN). */
  fn: Float32Array;
  /** Undirected edges (deduped by welded endpoint pair). */
  edges: OutlineEdge[];
}

export type OutlineKind = 'boundary' | 'crease' | 'silhouette';

export interface ClassifiedEdge {
  v0: number;
  v1: number;
  kind: OutlineKind;
}

/** Round coords to 1e-4 to weld coincident verts (matches THREE.EdgesGeometry's
 *  precisionPoints). Coincident CSG/weld verts are bit-identical or far closer. */
const WELD_PRECISION = 1e4;

/**
 * Build the position-welded edge→face adjacency + per-face geometric normals.
 * PURE — reads the typed arrays, returns fresh plain data.
 */
export function buildWelded(input: SilhouetteInput): WeldedAdjacency {
  const { triN, a, b, c, pos } = input;

  const weldMap = new Map<string, number>();
  const vpos: number[] = [];
  const weldId = (vi: number): number => {
    const x = pos[3 * vi], y = pos[3 * vi + 1], z = pos[3 * vi + 2];
    const key = `${Math.round(x * WELD_PRECISION)},${Math.round(y * WELD_PRECISION)},${Math.round(z * WELD_PRECISION)}`;
    let id = weldMap.get(key);
    if (id === undefined) {
      id = vpos.length / 3;
      weldMap.set(key, id);
      vpos.push(x, y, z);
    }
    return id;
  };

  const fn = new Float32Array(triN * 3);
  const edgeMap = new Map<string, OutlineEdge>();
  const addEdge = (u: number, v: number, f: number): void => {
    const lo = u < v ? u : v, hi = u < v ? v : u;
    if (lo === hi) return; // degenerate edge (welded to a point)
    const key = `${lo}_${hi}`;
    const e = edgeMap.get(key);
    if (e) { if (e.f1 < 0) e.f1 = f; }
    else edgeMap.set(key, { v0: lo, v1: hi, f0: f, f1: -1 });
  };

  for (let t = 0; t < triN; t++) {
    const w0 = weldId(a[t]), w1 = weldId(b[t]), w2 = weldId(c[t]);
    // geometric normal from the welded corner positions
    const ax = vpos[3 * w0], ay = vpos[3 * w0 + 1], az = vpos[3 * w0 + 2];
    const bx = vpos[3 * w1], by = vpos[3 * w1 + 1], bz = vpos[3 * w1 + 2];
    const cx = vpos[3 * w2], cy = vpos[3 * w2 + 1], cz = vpos[3 * w2 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    fn[3 * t] = nx; fn[3 * t + 1] = ny; fn[3 * t + 2] = nz;
    addEdge(w0, w1, t);
    addEdge(w1, w2, t);
    addEdge(w2, w0, t);
  }

  return { vpos, fn, edges: [...edgeMap.values()] };
}

/**
 * Classify each edge as boundary / crease / silhouette against the current view.
 * `creaseCos` = the cosine of the crease threshold: an interior edge is a CREASE
 * when its two face normals' dot product is BELOW it (dihedral above threshold).
 * A remaining interior edge is a SILHOUETTE when its two faces straddle the view
 * (one `faceN·V > 0`, one `< 0`). `view` = V, the surface→camera direction. PURE.
 */
export function classifyOutlineEdges(
  adj: WeldedAdjacency,
  view: [number, number, number],
  creaseCos: number,
): ClassifiedEdge[] {
  const { fn, edges } = adj;
  const vl = Math.hypot(view[0], view[1], view[2]) || 1;
  const vx = view[0] / vl, vy = view[1] / vl, vz = view[2] / vl;

  const out: ClassifiedEdge[] = [];
  for (const e of edges) {
    if (e.f1 < 0) { out.push({ v0: e.v0, v1: e.v1, kind: 'boundary' }); continue; }
    const i0 = 3 * e.f0, i1 = 3 * e.f1;
    const n0x = fn[i0], n0y = fn[i0 + 1], n0z = fn[i0 + 2];
    const n1x = fn[i1], n1y = fn[i1 + 1], n1z = fn[i1 + 2];
    const dot = n0x * n1x + n0y * n1y + n0z * n1z;
    if (dot < creaseCos) { out.push({ v0: e.v0, v1: e.v1, kind: 'crease' }); continue; }
    const s0 = n0x * vx + n0y * vy + n0z * vz;
    const s1 = n1x * vx + n1y * vy + n1z * vz;
    if (s0 * s1 < 0) out.push({ v0: e.v0, v1: e.v1, kind: 'silhouette' });
  }
  return out;
}

/**
 * Chain a set of undirected edges (welded id pairs) into polylines by shared
 * endpoint. Greedy: start from any unused edge and extend both ends while a
 * continuing unused edge exists (arbitrary choice at junctions — fine for v1).
 * Returns arrays of welded vertex ids (each a polyline path). PURE.
 */
export function chainEdges(edges: Array<[number, number]>): number[][] {
  // incident edge list per vertex (as indices into `edges`)
  const inc = new Map<number, number[]>();
  const push = (v: number, ei: number): void => {
    const l = inc.get(v);
    if (l) l.push(ei); else inc.set(v, [ei]);
  };
  edges.forEach(([u, v], ei) => { push(u, ei); push(v, ei); });

  const used = new Uint8Array(edges.length);
  // next unused incident edge from `v` other than `skip`
  const nextFrom = (v: number, skip: number): number => {
    const l = inc.get(v);
    if (!l) return -1;
    for (const ei of l) if (ei !== skip && !used[ei]) return ei;
    return -1;
  };
  const other = (ei: number, v: number): number => {
    const [u, w] = edges[ei];
    return u === v ? w : u;
  };

  const chains: number[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const [u0, v0] = edges[start];
    const chain: number[] = [u0, v0];
    // extend forward from v0
    let cur = v0, prev = start;
    for (;;) {
      const ei = nextFrom(cur, prev);
      if (ei < 0) break;
      used[ei] = 1;
      const nx = other(ei, cur);
      chain.push(nx);
      prev = ei; cur = nx;
    }
    // extend backward from u0
    cur = u0; prev = start;
    for (;;) {
      const ei = nextFrom(cur, prev);
      if (ei < 0) break;
      used[ei] = 1;
      const nx = other(ei, cur);
      chain.unshift(nx);
      prev = ei; cur = nx;
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Collapse near-collinear interior points of a 2D polyline (flat [x0,y0,x1,y1…])
 * into fewer segments: drop an interior point when the turn angle there is below
 * `angleTol` (radians). Endpoints and genuine corners (turn > tol) are kept, so a
 * straight facet run becomes ONE segment while sharp corners survive. PURE.
 */
export function mergeCollinearPolyline(pts: number[], angleTol: number): number[] {
  const n = pts.length >> 1;
  if (n <= 2) return pts.slice();
  const out: number[] = [pts[0], pts[1]];
  for (let i = 1; i < n - 1; i++) {
    const ax = out[out.length - 2], ay = out[out.length - 1];
    const bx = pts[2 * i], by = pts[2 * i + 1];
    const cx = pts[2 * i + 2], cy = pts[2 * i + 3];
    const e1x = bx - ax, e1y = by - ay;
    const e2x = cx - bx, e2y = cy - by;
    const l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue; // coincident → drop b
    const cos = (e1x * e2x + e1y * e2y) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang > angleTol) out.push(bx, by); // genuine corner → keep
    // else near-collinear → drop b (measured against the retained point a)
  }
  out.push(pts[2 * (n - 1)], pts[2 * (n - 1) + 1]);
  return out;
}

/** Build a `<path>` d-string subpath (M…L…) from a flat point list. */
export function polylineToPath(pts: number[]): string {
  const n = pts.length >> 1;
  if (n < 2) return '';
  let d = `M${pts[0].toFixed(2)},${pts[1].toFixed(2)}`;
  for (let i = 1; i < n; i++) d += `L${pts[2 * i].toFixed(2)},${pts[2 * i + 1].toFixed(2)}`;
  return d;
}
