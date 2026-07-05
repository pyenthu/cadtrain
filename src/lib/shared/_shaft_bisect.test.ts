import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildRevolveMesh } from './tf_examples/revolve';
import { creaseAwareCornerNormals, medianEdgeLength, toleranceWeldMap } from './trueform-adapter';

const LINES: string[] = [];
const log = (s: string) => LINES.push(s);

const WELD_TOL_FRACTION = 0.25;

/** Count side-wall positions carrying >1 distinct normal (sharp/flat reads). */
function splitStats(pos: ArrayLike<number>, index: Int32Array, normals: Float32Array) {
  // normals is [nt*9] non-indexed per-corner; pos is the ORIGINAL indexed buffer.
  const nt = index.length / 3;
  const byPos = new Map<string, Set<string>>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
      const o = t * 9 + k * 3;
      const nx = normals[o], ny = normals[o + 1], nz = normals[o + 2];
      if (Math.hypot(px, py) < 1e-6) continue;      // skip axis centres
      if (Math.abs(nz) >= 0.5) continue;            // side wall only
      const kk = `${px.toFixed(3)}|${py.toFixed(3)}|${pz.toFixed(3)}`;
      if (!byPos.has(kk)) byPos.set(kk, new Set());
      byPos.get(kk)!.add(`${nx.toFixed(2)}|${ny.toFixed(2)}|${nz.toFixed(2)}`);
    }
  }
  let multi = 0;
  for (const s of byPos.values()) if (s.size > 1) multi++;
  return { multi, total: byPos.size };
}

/** For a welded group, how many DISTINCT ring positions merged (over-weld tell). */
function weldGroupSizes(pos: ArrayLike<number>, weldOf: Int32Array) {
  const groups = new Map<number, number>();
  const nv = pos.length / 3;
  for (let i = 0; i < nv; i++) groups.set(weldOf[i], (groups.get(weldOf[i]) ?? 0) + 1);
  let maxG = 0, merged = 0;
  for (const c of groups.values()) { if (c > maxG) maxG = c; if (c > 1) merged++; }
  return { maxGroup: maxG, mergedGroups: merged, nv };
}

/** PROPOSED FIX: tolerance weld that NEVER merges two verts joined by a tri edge. */
function weldMapExcludeEdges(pos: ArrayLike<number>, tri: ArrayLike<number>, tol: number): Int32Array {
  const nv = (pos.length / 3) | 0;
  const nt = (tri.length / 3) | 0;
  const edges = new Set<number>();
  const ek = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    edges.add(ek(a, b)); edges.add(ek(b, c)); edges.add(ek(c, a));
  }
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const cell = tol > 0 ? tol : 1e-9;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  const e2 = tol * tol;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nb = grid.get(`${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy},${Math.floor(z / cell) + dz}`);
      if (!nb) continue;
      for (const j of nb) {
        if (j <= i) continue;
        if (edges.has(ek(i, j))) continue; // ← never weld edge-connected verts
        const ddx = pos[j * 3] - x, ddy = pos[j * 3 + 1] - y, ddz = pos[j * 3 + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= e2) uni(i, j);
      }
    }
  }
  const weldOf = new Int32Array(nv);
  for (let i = 0; i < nv; i++) weldOf[i] = find(i);
  return weldOf;
}

/** crease normals using an injected weldOf. */
function creaseNormalsWith(pos: ArrayLike<number>, tri: ArrayLike<number>, weldOf: Int32Array, creaseDeg: number): Float32Array {
  const nt = (tri.length / 3) | 0, nv = (pos.length / 3) | 0;
  const faceN = new Float32Array(nt * 3), faceU = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const e1x = pos[b * 3] - pos[a * 3], e1y = pos[b * 3 + 1] - pos[a * 3 + 1], e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3], e2y = pos[c * 3 + 1] - pos[a * 3 + 1], e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    faceN[t * 3] = nx; faceN[t * 3 + 1] = ny; faceN[t * 3 + 2] = nz;
    const l = Math.hypot(nx, ny, nz) || 1; faceU[t * 3] = nx / l; faceU[t * 3 + 1] = ny / l; faceU[t * 3 + 2] = nz / l;
  }
  const inc: number[][] = new Array(nv);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const rep = weldOf[tri[t * 3 + k]]; (inc[rep] ?? (inc[rep] = [])).push(t); }
  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) {
    const ux = faceU[t * 3], uy = faceU[t * 3 + 1], uz = faceU[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = tri[t * 3 + k]; let sx = 0, sy = 0, sz = 0; const list = inc[weldOf[v]];
      for (let j = 0; j < list.length; j++) { const t2 = list[j]; const dot = ux * faceU[t2 * 3] + uy * faceU[t2 * 3 + 1] + uz * faceU[t2 * 3 + 2];
        if (t2 === t || dot >= cosThresh) { sx += faceN[t2 * 3]; sy += faceN[t2 * 3 + 1]; sz += faceN[t2 * 3 + 2]; } }
      const l = Math.hypot(sx, sy, sz) || 1; const o = t * 9 + k * 3; out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l;
    }
  }
  return out;
}

function run(label: string, r: number, length: number, Ss: number[]) {
  const profile: [number, number][] = [[0, 0], [r, 0], [r, length], [0, length]];
  log(`\n=== ${label}  r=${r} length=${length} ===`);
  log('  S   chord      median     tol        chord<tol  maxWeldGrp  split(cur)  split(FIX)');
  for (const S of Ss) {
    const { points, faces } = buildRevolveMesh(profile, S);
    const idx = faces as Int32Array;
    const med = medianEdgeLength(points, idx);
    const tol = WELD_TOL_FRACTION * med;
    const chord = 2 * r * Math.sin(Math.PI / S);
    const weldOf = toleranceWeldMap(points, idx, tol);
    const g = weldGroupSizes(points, weldOf);
    const nrm = creaseAwareCornerNormals(points, idx, 60);
    const st = splitStats(points, idx, nrm);
    const weldFix = weldMapExcludeEdges(points, idx, tol);
    const nrmFix = creaseNormalsWith(points, idx, weldFix, 60);
    const stFix = splitStats(points, idx, nrmFix);
    log(
      `  ${String(S).padStart(2)}  ${chord.toFixed(5)}   ${med.toFixed(5)}   ${tol.toFixed(5)}   ` +
      `${chord < tol ? 'YES' : 'no '}        ${String(g.maxGroup).padStart(3)}         ${st.multi}/${st.total}       ${stFix.multi}/${stFix.total}`
    );
  }
}

describe('g_shaft revolve bisect 26/27/28', () => {
  it('decodes median/tol/split across S', () => {
    const Ss = [12, 20, 24, 25, 26, 27, 28, 30, 32, 48];
    run('DEFAULT (r=0.5)', 0.5, 5, Ss);
    run('OD 8.5 (r=4.25)', 4.25, 5, Ss);
    run('OD 8.5 long (r=4.25 len=20)', 4.25, 20, Ss);
    writeFileSync('/tmp/shaft_bisect.txt', LINES.join('\n'));
  });
});
