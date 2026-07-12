/**
 * brep-coverage.test.ts — the differential MF-vs-BREP parity audit.
 *
 * GATED behind BREP_AUDIT=1 (it reads cached part sources from the scratchpad
 * and falls back to prod for deps — network + slow OCCT bakes, not for the
 * default suite). Run with:
 *   BREP_AUDIT=1 BREP_SRC=<dir> bun run test src/lib/server/brep-coverage.test.ts
 *
 * Emits a JSON matrix + a console summary (primitive vs assembly coverage,
 * pass/fail per part with the exact BREP error) to $BREP_OUT.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { diffPart, extractMeta, type DiffResult } from '../brep-audit';

const AUDIT = process.env.BREP_AUDIT === '1';
const SRC_DIR = process.env.BREP_SRC || '';
const OUT = process.env.BREP_OUT || '/tmp/brep-matrix.json';
const PROD = 'https://cadtrain.up.railway.app';

/** fetchFn for dep resolution: serve source from the local cache dir first
 *  (writing prod hits back into it), so an audit run is mostly offline + fast. */
function makeFetch(srcDir: string): typeof fetch {
  const cache = new Map<string, string | null>();
  const readLocal = (name: string): string | null => {
    if (cache.has(name)) return cache.get(name)!;
    const p = join(srcDir, name + '.ts');
    const v = existsSync(p) ? readFileSync(p, 'utf8') : null;
    cache.set(name, v);
    return v;
  };
  return (async (url: any, _init?: any): Promise<any> => {
    const u = String(url);
    const m = u.match(/[?&]name=([^&]+)/);
    const idm = u.match(/[?&]id=([^&]+)/);
    // /api/primitives/source?name=X
    if (u.includes('/api/primitives/source') && m) {
      const name = decodeURIComponent(m[1]);
      let src = readLocal(name);
      if (src == null) {
        try {
          const r = await fetch(`${PROD}/api/primitives/source?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20000) });
          if (r.ok) { const d = await r.json(); if (typeof d?.source === 'string' && d.source.length > 20) { src = d.source; try { writeFileSync(join(srcDir, name + '.ts'), src); } catch { /* */ } cache.set(name, src); } }
        } catch { /* offline dep */ }
      }
      if (src == null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ source: src }) };
    }
    // /api/primitives/profiles/source?id=X — proxy straight to prod.
    if (u.includes('/api/primitives/profiles/source') && idm) {
      try {
        const r = await fetch(`${PROD}/api/primitives/profiles/source?id=${idm[1]}`, { signal: AbortSignal.timeout(20000) });
        return r;
      } catch { return { ok: false, status: 502, json: async () => ({}) }; }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

describe.skipIf(!AUDIT)('BREP coverage audit (MF oracle vs BREP)', () => {
  it('bakes every reachable part through MF + BREP and diffs', async () => {
    expect(SRC_DIR && existsSync(SRC_DIR)).toBeTruthy();
    const fetchFn = makeFetch(SRC_DIR);
    const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts')).sort();
    const results: DiffResult[] = [];
    for (const f of files) {
      const id = f.replace(/\.ts$/, '');
      const source = readFileSync(join(SRC_DIR, f), 'utf8');
      // Skip obviously-non-part files (engines w/o meta.params get n/a).
      const meta = extractMeta(source);
      if (!meta) { continue; }
      let r: DiffResult;
      try { r = await diffPart(id, source, fetchFn); }
      catch (e: any) { r = { id, kind: '?', usesEngines: false, usesRawMesh: false, usesWarp: false, mf: 'fail', brep: 'fail', parity: 'n/a', mfError: 'harness: ' + String(e?.message ?? e).slice(0, 120) }; }
      results.push(r);
      const tag = `${r.parity === 'pass' ? 'PASS' : r.brep === 'ok' ? 'DIFF' : 'FAIL'}`;
      // eslint-disable-next-line no-console
      console.log(`[${tag}] ${id.padEnd(42)} kind=${r.kind.padEnd(4)} mf=${r.mf} brep=${r.brep} par=${r.parity}` +
        (r.volRelErr !== undefined ? ` volErr=${(r.volRelErr * 100).toFixed(1)}% bboxErr=${((r.bboxRelErr ?? 0) * 100).toFixed(1)}%` : '') +
        (r.brepError ? `  BREP:${r.brepError}` : '') + (r.mfError ? `  MF:${r.mfError}` : ''));
    }

    // ── summary ──────────────────────────────────────────────────────────────
    const isAsm = (r: DiffResult) => r.isAssembly;
    const prims = results.filter((r) => !isAsm(r));
    const asms = results.filter((r) => isAsm(r));
    const mfOk = (arr: DiffResult[]) => arr.filter((r) => r.mf === 'ok');
    const brepOk = (arr: DiffResult[]) => arr.filter((r) => r.brep === 'ok');
    const parityPass = (arr: DiffResult[]) => arr.filter((r) => r.parity === 'pass');
    const line = (label: string, arr: DiffResult[]) =>
      `${label}: N=${arr.length}  MFok=${mfOk(arr).length}  BREPok=${brepOk(arr).length}  PARITY(vsMF)=${parityPass(arr).length}/${mfOk(arr).length}`;
    // eslint-disable-next-line no-console
    console.log('\n════════ COVERAGE SUMMARY ════════');
    // eslint-disable-next-line no-console
    console.log(line('PRIMITIVES', prims));
    // eslint-disable-next-line no-console
    console.log(line('ASSEMBLIES', asms));
    // eslint-disable-next-line no-console
    console.log(line('ALL       ', results));

    // Parts where MF works but BREP fails → the gap list.
    const gaps = results.filter((r) => r.mf === 'ok' && r.brep !== 'ok');
    // eslint-disable-next-line no-console
    console.log(`\n──── GAPS (MF ok, BREP fail): ${gaps.length} ────`);
    for (const g of gaps) console.log(`  ${g.id.padEnd(42)} ${g.kind}  ${g.brepError}`);

    // Parts that BREP bakes but diverge from MF (potential mapping bug).
    const diffs = results.filter((r) => r.mf === 'ok' && r.brep === 'ok' && r.parity === 'fail');
    // eslint-disable-next-line no-console
    console.log(`\n──── DIVERGENCES (both ok, parity fail): ${diffs.length} ────`);
    for (const d of diffs) console.log(`  ${d.id.padEnd(42)} ${d.kind}  volErr=${((d.volRelErr ?? 0) * 100).toFixed(1)}% bboxErr=${((d.bboxRelErr ?? 0) * 100).toFixed(1)}% (MFvol=${d.volMF?.toFixed(2)} BREPvol=${d.volBREP?.toFixed(2)})`);

    try { mkdirSync(resolve(OUT, '..'), { recursive: true }); } catch { /* */ }
    writeFileSync(OUT, JSON.stringify(results, null, 2));
    // eslint-disable-next-line no-console
    console.log(`\nmatrix → ${OUT}`);
    expect(results.length).toBeGreaterThan(0);
  }, 1_800_000);
});
