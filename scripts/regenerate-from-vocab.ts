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
  // rev primitives first (asm composes depend on them being live)
  'shaft', 'cone', 'frustum',
  'collar_flat', 'collar_tapered', 'collar_rounded',
  'pin', 'box',
  // asm composes
  'tube', 'sub', 'xover', 'joint',
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

  // Lock file pass — package-lock.json / Cargo.lock equivalent for the
  // vocabulary. Git-tracked snapshot of (rule_hash, source_hash, bake)
  // per term so PR diffs surface every regeneration change.
  const updateLock = process.argv.includes('--update-lock');
  const lockPath = 'docs/parts/vocabulary.lock.json';
  let prevLock: any = {};
  try { prevLock = JSON.parse(await Bun.file(lockPath).text()); } catch { /* none yet */ }
  const newLock: any = { vocab_version: vocab.version, terms: {} };
  const drift: string[] = [];
  for (const r of rows) {
    if (r.translate !== 'ok' || r.bake !== 'ok') continue;
    // Re-fetch the saved source to hash it (the runner already POSTed it).
    const d = await fetchJSON<{ source: string }>(`${BASE}/api/primitives/source?name=${r.exemplar}`);
    const sourceHash = hashStr(d.source);
    const entry = vocab.terms[r.term]!;
    const ruleHash = hashStr(JSON.stringify(entry.rule));
    newLock.terms[r.term] = {
      rule_hash: ruleHash,
      source_hash: sourceHash,
      bake: { verts: r.verts, z_extent: r.z_extent, outer_r: r.outer_r },
    };
    const prev = prevLock?.terms?.[r.term];
    if (prev) {
      const changes: string[] = [];
      if (prev.rule_hash !== ruleHash) changes.push(`rule_hash ${prev.rule_hash} → ${ruleHash}`);
      if (prev.source_hash !== sourceHash) changes.push(`source_hash ${prev.source_hash.slice(0, 8)} → ${sourceHash.slice(0, 8)}`);
      if (prev.bake?.verts !== r.verts) changes.push(`verts ${prev.bake?.verts} → ${r.verts}`);
      if (Math.abs((prev.bake?.z_extent ?? 0) - (r.z_extent ?? 0)) > 0.001) changes.push(`z ${prev.bake?.z_extent} → ${r.z_extent}`);
      if (Math.abs((prev.bake?.outer_r ?? 0) - (r.outer_r ?? 0)) > 0.001) changes.push(`r ${prev.bake?.outer_r} → ${r.outer_r}`);
      if (changes.length) drift.push(`  ${r.term}: ${changes.join('; ')}`);
    } else if (Object.keys(prevLock?.terms ?? {}).length > 0) {
      drift.push(`  ${r.term}: new term (no prior lock entry)`);
    }
  }
  if (drift.length) {
    console.log('\n## Drift vs vocabulary.lock.json\n');
    for (const d of drift) console.log(d);
    if (!updateLock) {
      console.log('\nRun with --update-lock to refresh the lock file (intentional changes).');
    }
  }
  if (updateLock || Object.keys(prevLock?.terms ?? {}).length === 0) {
    await Bun.write(lockPath, JSON.stringify(newLock, null, 2) + '\n');
    console.log(`\n→ wrote ${lockPath}`);
  }
}

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

main().catch((e) => { console.error('runner failed:', e); process.exit(1); });
