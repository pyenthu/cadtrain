/**
 * #77 first artifact — HEADLESS bake proof that w_well_native's DEFAULT params
 * reproduce w2_completion_vert's geometry EXACTLY.
 *
 *   S_orig = /preview bake of the ORIGINAL w2_completion_vert (no params).
 *   S_new  = /preview bake of the PROBE (w_probe → w_well_native(defaults)),
 *            which feeds the declared meta.params defaults through the emitted
 *            `Array.from(p.<list>, s => src({col: s.col…}))` path.
 * PASS iff tris + verts + z-extent match AND the clean w_well_native /compiles.
 * No $lib import — plain fetch, runnable with `bun scratch/issue-77-param-well/bake-compare.ts`
 * (dev server up on :3333; run transform.ts first to produce the sources).
 */
import { readFileSync } from 'fs';

const BASE = process.env.CADTRAIN_BASE ?? 'http://localhost:3333';
const DIR = new URL('.', import.meta.url).pathname;

function stats(full: any) {
  const pos: number[] = full?.positions ?? [];
  const verts = pos.length / 3;
  const tris = Array.isArray(full?.index) && full.index.length ? full.index.length / 3 : pos.length / 9;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { const z = pos[i]!; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  return { verts, tris, zmin: +zmin.toFixed(4), zmax: +zmax.toFixed(4), zext: +(zmax - zmin).toFixed(4) };
}
async function preview(name: string, source: string) {
  const r = await fetch(`${BASE}/api/primitives/preview?bust=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, source, params: [] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(`preview ${name} ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return stats(j.full);
}
async function compile(name: string, source: string) {
  const r = await fetch(`${BASE}/api/primitives/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, source, bust: true }) });
  const j = await r.json().catch(() => ({}));
  return { supported: j?.supported === true, reason: j?.reason };
}

const origSrc = (await (await fetch(`${BASE}/api/primitives/source?name=w2_completion_vert`)).json()).source;
const cleanSrc = readFileSync(`${DIR}/w_well_native.asm.ts`, 'utf8');
const probeSrc = readFileSync(`${DIR}/w_well_native.probe.asm.ts`, 'utf8');

const cNew = await compile('w_well_native', cleanSrc);
const S_orig = await preview('w2_completion_vert', origSrc);
const S_new = await preview('w_probe', probeSrc);
const match = S_orig.verts === S_new.verts && S_orig.tris === S_new.tris && S_orig.zmin === S_new.zmin && S_orig.zmax === S_new.zmax;

console.log('ORIGINAL w2_completion_vert :', JSON.stringify(S_orig));
console.log('w_well_native (defaults)    :', JSON.stringify(S_new));
console.log('compile w_well_native supported:', cNew.supported, cNew.reason ?? '');
console.log(match && cNew.supported ? 'PASS — identical bake' : 'FAIL');
if (!(match && cNew.supported)) process.exit(1);
