/**
 * regenerate-from-vocab — run the rule-translator over every term in
 * docs/parts/vocabulary.json, save the generated source to the volume
 * (under basic/dp_test/<exemplar_id>.<kind>.ts), and bake-verify.
 *
 * Run: `bun scripts/regenerate-from-vocab.ts`
 *
 * Output: a markdown summary table — per term: translate · save · bake
 * status + verts/z-extent/outer-r. Failures print the exact error so we
 * can patch either the vocabulary entry, the translator, or surface the
 * missing template / dep.
 */
import { translate, type Vocabulary, type VocabEntry } from '../src/lib/authoring/rule-translator';

const BASE = process.env.CADTRAIN_BASE ?? 'http://localhost:3333';

// Build order — generate atomic primitives first, then composes that reference them.
// Compose terms have to wait for their dep exemplars to be on the volume since the
// loader needs to resolve them at bake time.
const BUILD_ORDER = [
  'shaft', 'collar', 'cone', 'frustum', 'pin', 'box', // rev primitives
  'tube', 'sub', 'xover', 'joint',                    // asm composes
  // 'stand'  // deferred — needs repeat node support (K.54)
];

type Row = {
  term: string;
  exemplar: string;
  kind: 'rev' | 'asm';
  translate: 'ok' | string;
  save: 'ok' | string;
  bake: 'ok' | string;
  verts?: number;
  z_extent?: number;
  outer_r?: number;
  expects?: any;
  expects_match?: string;
};

async function fetchJSON<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  if (!r.ok) throw new Error(`${input} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function main() {
  const vocab: Vocabulary = JSON.parse(await Bun.file('docs/parts/vocabulary.json').text());

  // Confirm dp_test folder exists on the volume.
  await fetch(`${BASE}/api/volume?path=primitives/basic/dp_test&action=mkdir`, { method: 'POST' });

  const rows: Row[] = [];

  for (const term of BUILD_ORDER) {
    const entry = vocab.terms[term];
    if (!entry) {
      rows.push({ term, exemplar: '?', kind: 'rev', translate: `unknown term`, save: '-', bake: '-' });
      continue;
    }
    const row: Row = {
      term, exemplar: entry.exemplar, kind: entry.kind,
      translate: 'ok', save: '-', bake: '-', expects: entry.expects_bake,
    };

    // Translate
    let source: string;
    try {
      source = translate(term, vocab);
    } catch (e: any) {
      row.translate = e?.message ?? String(e);
      rows.push(row);
      continue;
    }

    // Save to basic/dp_test/
    try {
      const saveResp = await fetch(`${BASE}/api/primitives/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.exemplar, source, kind: entry.kind, dir: 'basic/dp_test' }),
      });
      if (!saveResp.ok) throw new Error(`HTTP ${saveResp.status}: ${(await saveResp.text()).slice(0, 200)}`);
      row.save = 'ok';
    } catch (e: any) {
      row.save = e?.message ?? String(e);
      rows.push(row);
      continue;
    }

    // Bake-verify
    try {
      // Read params back to get the canonical default array
      const d = await fetchJSON<{ params: Record<string, { default: number }>; source: string }>(
        `${BASE}/api/primitives/source?name=${entry.exemplar}`,
      );
      const paramKeys = Object.keys(d.params ?? {});
      const params = paramKeys.map((k) => d.params[k]!.default);
      const bakeResp = await fetchJSON<any>(`${BASE}/api/primitives/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: d.source, name: entry.exemplar, params }),
      });
      if (!bakeResp.ok) throw new Error(`bake failed: ${bakeResp.message}`);
      const pos: number[] = bakeResp.full?.positions ?? [];
      const N = pos.length / 3;
      let zMin = 1e9, zMax = -1e9, rMax = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
        const r = Math.sqrt(x * x + y * y);
        if (r > rMax) rMax = r;
      }
      row.bake = 'ok';
      row.verts = N;
      row.z_extent = +(zMax - zMin).toFixed(3);
      row.outer_r = +rMax.toFixed(3);
      // Match against expects_bake when present (skip null fields)
      const exp = entry.expects_bake ?? {};
      const mismatches: string[] = [];
      if (typeof exp.verts === 'number' && exp.verts !== N) mismatches.push(`verts: got ${N}, expected ${exp.verts}`);
      if (typeof exp.z_extent === 'number' && Math.abs(exp.z_extent - (zMax - zMin)) > 0.05) mismatches.push(`z: got ${(zMax - zMin).toFixed(3)}, expected ${exp.z_extent}`);
      if (typeof exp.outer_r === 'number' && Math.abs(exp.outer_r - rMax) > 0.05) mismatches.push(`r: got ${rMax.toFixed(3)}, expected ${exp.outer_r}`);
      row.expects_match = mismatches.length === 0 ? '✓' : '⚠ ' + mismatches.join('; ');
    } catch (e: any) {
      row.bake = (e?.message ?? String(e)).slice(0, 200);
    }

    rows.push(row);
  }

  // Print a markdown summary table.
  console.log('\n# Regeneration summary — vocabulary v' + vocab.version + '\n');
  console.log('| term | exemplar | kind | translate | save | bake | verts | z | r | matches expects |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.term} | ${r.exemplar} | ${r.kind} | ${r.translate === 'ok' ? '✓' : '✗ ' + r.translate} | ` +
      `${r.save === 'ok' ? '✓' : (r.save === '-' ? '-' : '✗ ' + r.save)} | ` +
      `${r.bake === 'ok' ? '✓' : (r.bake === '-' ? '-' : '✗ ' + r.bake)} | ` +
      `${r.verts ?? '-'} | ${r.z_extent ?? '-'} | ${r.outer_r ?? '-'} | ${r.expects_match ?? '-'} |`,
    );
  }
}

main().catch((e) => { console.error('runner failed:', e); process.exit(1); });
