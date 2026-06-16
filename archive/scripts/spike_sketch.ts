/**
 * M.1 validation — compileSketch (ops → (r,z)) for each op type, then bake
 * the result through r_revolve. Run: bun scripts/spike_sketch.ts
 */
import { compileSketch, sketchToSvg, type SketchOp } from '../src/lib/cad/sketch';

function report(name: string, ops: SketchOp[]) {
  const pts = compileSketch(ops, 64);
  const minR = Math.min(...pts.map((p) => p[0]));
  const svg = sketchToSvg(ops);
  console.log(`\n[${name}]`);
  console.log('  pts   :', pts.length, '· minR', minR.toFixed(3), minR >= -1e-9 ? '(OK revolve)' : '(NEG r!)');
  console.log('  first :', pts.slice(0, 5).map((p) => `[${p[0].toFixed(2)},${p[1].toFixed(2)}]`).join(' '));
  console.log('  svg   :', svg.length, 'bytes');
  return pts;
}

// Flat collar — all lines.
report('flat collar (lines)', [
  { op: 'line', r: 0.5, z: 0 },
  { op: 'line', r: 0.5, z: 2 },
  { op: 'line', r: 1.5, z: 2 },
  { op: 'line', r: 1.5, z: 0 },
]);

// Filleted collar — round the two OD corners.
const filletPts = report('filleted collar', [
  { op: 'line', r: 0.5, z: 0 },
  { op: 'line', r: 0.5, z: 2 },
  { op: 'line', r: 1.5, z: 2 }, { op: 'fillet', radius: 0.3 },
  { op: 'line', r: 1.5, z: 0 }, { op: 'fillet', radius: 0.3 },
]);

// Chamfered collar — bevel the OD-top corner.
report('chamfered collar', [
  { op: 'line', r: 0.5, z: 0 },
  { op: 'line', r: 0.5, z: 2 },
  { op: 'line', r: 1.5, z: 2 }, { op: 'chamfer', dist: 0.4 },
  { op: 'line', r: 1.5, z: 0 },
]);

// Splined OD — a Bézier bulge on the outer wall.
report('splined OD', [
  { op: 'line', r: 0.5, z: 0 },
  { op: 'line', r: 0.5, z: 2 },
  { op: 'line', r: 1.5, z: 2 },
  { op: 'spline', r: 1.5, z: 0, ctrl: [[1.9, 1.3], [1.9, 0.7]] },
]);

// ── Bake the filleted collar through r_revolve (the real downstream) ──
const lit = '[' + filletPts.map((p) => `[${p[0].toFixed(4)},${p[1].toFixed(4)}]`).join(',') + ']';
const source = `export const meta = { id: 'spike_sketch', name: 'spike_sketch', kind: 'asm', uses: ['r_revolve'], params: [] };
export function spike_sketch() { const profile = ${lit}; const body = r_revolve(profile, 96); return body; }`;
try {
  const res = await fetch('http://localhost:3333/api/primitives/preview', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Volume-Local': '1' },
    body: JSON.stringify({ id: 'spike_sketch', name: 'spike_sketch', source, params: [], mode: 'sandbox' }),
  });
  console.log('\n[BAKE filleted collar]:', res.ok
    ? 'PASS — keys ' + Object.keys((await res.json()).full || {}).join(',')
    : 'FAIL ' + res.status + ' ' + (await res.text()).slice(0, 160));
} catch (e: any) { console.log('\n[BAKE]: SKIP — dev server down (' + (e?.message ?? e) + ')'); }
