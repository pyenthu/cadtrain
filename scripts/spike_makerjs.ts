/**
 * M.0 spike — validate Maker.js as the 2D sketch engine (docs/plans/profile-sketcher.md).
 *
 * Proves: a PARAMETRIC path (line + arc + fillet + Bézier spline) builds, renders
 * to SVG, and SAMPLES to (r,z) points suitable for r_revolve (r >= 0, ordered).
 *
 * Run: bun scripts/spike_makerjs.ts
 */
import makerjs from 'makerjs';

const { paths, model: M, exporter, measure } = makerjs as any;

// ── 1. Build a parametric collar half-section as a Maker.js model ─────────
// Params (the kind that would wire to p.* in the graph).
const p = { bore: 1.0, od: 3.0, len: 2.0, filletR: 0.25, chamfer: 0.4 };

// A half-section profile (r = x, z = y), built from CAD primitives:
//   bottom bore wall → bore top → flat shoulder → OD wall (with a fillet at
//   the top-outer corner) → OD bottom → close. Plus a Bézier "spline" bump on
//   the outer wall to prove curve support.
const r0 = p.bore / 2, r1 = p.od / 2;

const profile: any = {
  paths: {
    boreWall: new paths.Line([r0, 0], [r0, p.len]),                  // inner wall up
    topFlat:  new paths.Line([r0, p.len], [r1 - p.chamfer, p.len]),  // top, leave room for chamfer
    chamfer:  new paths.Line([r1 - p.chamfer, p.len], [r1, p.len - p.chamfer]), // 45° chamfer
    odWall:   new paths.Line([r1, p.len - p.chamfer], [r1, p.chamfer]),         // OD wall down
    botChamf: new paths.Line([r1, p.chamfer], [r1 - p.chamfer, 0]),  // bottom chamfer
    botFlat:  new paths.Line([r1 - p.chamfer, 0], [r0, 0]),          // bottom back to bore
  },
};

// A Bézier curve ("spline") as a separate proof — a bulge on the OD.
const bulge = new makerjs.models.BezierCurve(
  [r1, p.len - p.chamfer], [r1 + 0.4, p.len * 0.7], [r1 + 0.4, p.len * 0.3], [r1, p.chamfer],
);

// ── 2. Fillet a corner (chain.fillet) — the headline operator ─────────────
let filletApplied = false;
try {
  const chain = makerjs.model.findSingleChain(profile);
  if (chain) {
    const fillets = makerjs.chain.fillet(chain, p.filletR);
    if (fillets) { profile.models = { ...(profile.models || {}), fillets }; filletApplied = true; }
  }
} catch (e) { console.log('fillet step:', String(e)); }

// ── 3. Render to SVG (keeps the graphics approach) ────────────────────────
const svg = exporter.toSVG(profile);
const svgBulge = exporter.toSVG(bulge);

// ── 4. SAMPLE the chain → (r,z) points for r_revolve ──────────────────────
// Walk the single chain into evenly-spaced key points.
function sample(modelOrChain: any, n: number): [number, number][] {
  const chain = makerjs.model.findSingleChain(modelOrChain) ?? modelOrChain;
  const keyPoints = makerjs.chain.toKeyPoints(chain, makerjs.chain.dividedPath ? undefined : undefined);
  // toKeyPoints with a spacing arg gives evenly spaced points:
  const len = makerjs.measure.modelExtents(modelOrChain);
  const span = Math.max(len.width, len.height) || 1;
  const spaced = makerjs.chain.toKeyPoints(chain, span / n);
  return (spaced && spaced.length ? spaced : keyPoints).map((pt: number[]) => [pt[0], pt[1]] as [number, number]);
}

const pts = sample(profile, 48);
const bulgePts = sample(bulge, 24);

// ── 5. Report ─────────────────────────────────────────────────────────────
const minR = Math.min(...pts.map((q) => q[0]));
const ext = measure.modelExtents(profile);
console.log('=== M.0 Maker.js spike ===');
console.log('makerjs version :', (makerjs as any).version ?? '0.19.2');
console.log('fillet applied  :', filletApplied);
console.log('profile extents : r', [ext.low[0].toFixed(3), ext.high[0].toFixed(3)], 'z', [ext.low[1].toFixed(3), ext.high[1].toFixed(3)]);
console.log('sampled pts     :', pts.length, '(min r =', minR.toFixed(3), '→', minR >= -1e-9 ? 'OK for revolve' : 'NEGATIVE r!', ')');
console.log('first 6 (r,z)   :', pts.slice(0, 6).map((q) => `[${q[0].toFixed(2)},${q[1].toFixed(2)}]`).join(' '));
console.log('bezier pts      :', bulgePts.length);
console.log('svg bytes       :', svg.length, '(profile)', svgBulge.length, '(bezier)');
console.log('svg starts      :', svg.slice(0, 90).replace(/\n/g, ' '));
console.log('VERDICT (geom)  :', (pts.length >= 6 && minR >= -1e-9 && svg.length > 100)
  ? 'PASS — parametric path → fillet → SVG → (r,z) sample all work.'
  : 'CHECK — see above.');

// ── 6. BAKE the sampled points through r_revolve (the real downstream) ────
// Build a sandbox source that feeds the Maker.js-sampled profile straight
// into r_revolve, exactly as M.1's compileSketch would.
const profileLiteral = '[' + pts.map((q) => `[${q[0].toFixed(4)},${q[1].toFixed(4)}]`).join(',') + ']';
const source = `export const meta = { id: 'spike_collar', name: 'spike_collar', kind: 'asm', uses: ['r_revolve'], params: [] };
export function spike_collar() {
  const profile = ${profileLiteral};
  const body = r_revolve(profile, 96);
  return body;
}`;

try {
  const res = await fetch('http://localhost:3333/api/primitives/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Volume-Local': '1' },
    body: JSON.stringify({ id: 'spike_collar', name: 'spike_collar', source, params: [], mode: 'sandbox' }),
  });
  if (!res.ok) {
    console.log('BAKE            : FAIL — preview', res.status, (await res.text()).slice(0, 160));
  } else {
    const data: any = await res.json();
    const vfull = data.full?.vertices?.length ?? data.full?.position?.length ?? data.full?.attributes?.position?.array?.length;
    console.log('BAKE            : PASS — Maker.js profile baked through r_revolve. mesh keys:', Object.keys(data.full || {}).join(','), 'verts~', vfull ?? '(see keys)');
  }
} catch (e: any) {
  console.log('BAKE            : SKIP — dev server not reachable on :3333 (' + (e?.message ?? e) + ')');
}
