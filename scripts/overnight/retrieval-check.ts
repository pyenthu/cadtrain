// scripts/overnight/retrieval-check.ts (#49) — does the corpus we just grew actually get RETRIEVED?
//
// WHY THIS EXISTS. rankGolden() hands the model only its TOP 3 goldens. So a corpus can grow from 38
// to 63 pairs and the model's prompt stay byte-identical — the new pairs simply never crack the top 3.
// That is exactly what happened on 2026-08-06: gap-fill staged 25 atoms, the eval moved -1.4pp/-2.3pp
// with σ=0.00 across three "after" runs, and the honest reading was not "inconclusive" but "the input
// never changed". A measurement of a change that never reached the model is not a weak result; it is
// not a result at all.
//
// So before trusting any before/after delta, assert the new material is reachable. This probes the
// SAME endpoint the build path uses (/api/app/ground → buildGrounding) with the SAME prompts the eval
// drives, then maps the returned grounding text back to exact golden FILES by their .md first line —
// which is what buildGrounding renders as each example's key.
//
//   bun run scripts/overnight/retrieval-check.ts --corpus <dir> [--url http://localhost:3334]
//                                                [--docType dashboard] [--match trial-]
//
// Exit 0 always (informational — never blocks a run). Machine-readable final line:
//   RETRIEVAL_CHECK hits=<probes that retrieved >=1 matching golden>/<probes> files=<distinct files>
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const corpus = flag('--corpus');
const url = flag('--url', 'http://localhost:3334')!;
const docType = flag('--docType', 'dashboard')!;
const match = flag('--match', 'trial-')!;

if (!corpus) {
  console.error('usage: retrieval-check.ts --corpus <dir> [--url ...] [--docType ...] [--match ...]');
  process.exit(2);
}

/** The prompts the eval actually drives (opsdash script, appkit/ai/eval-fixtures.ts). Probing with
 *  invented prompts would measure a different retrieval than the one under test. */
const PROBES = [
  'Create an app called opsdash titled "Sales — Dashboard", docType dashboard.',
  'Seed a "months" variable with monthly records (month, revenue, orders).',
  'Add a stat grid.',
  'Inside the stat grid add a KPI tile "Revenue" with value 128400 as currency, delta +12 up.',
  'Add a line chart titled "Revenue by month" reading months, x = month, y = revenue.',
  'Add a data table reading months with columns month, revenue, orders, sortable, with totals.',
];

// ── map each golden's md FIRST LINE → its filename (that line is its rendered retrieval key) ──
const goldenDir = join(corpus, 'golden');
let names: string[] = [];
try {
  names = (await readdir(goldenDir)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
} catch {
  console.error(`retrieval-check: cannot read ${goldenDir}`);
  process.exit(2);
}

const keyToFile = new Map<string, string>();
for (const n of names) {
  try {
    const md = await readFile(join(goldenDir, `${n}.md`), 'utf8');
    const first = md.split('\n').find((l) => l.trim())?.trim();
    if (first) keyToFile.set(first, n);
  } catch {
    /* a .md without a readable pair simply can't be retrieved — skip */
  }
}

console.log(`[retrieval-check] ${keyToFile.size} retrievable goldens in ${goldenDir}`);
console.log(`[retrieval-check] probing ${PROBES.length} prompts @ ${url}  docType=${docType}  match="${match}"`);

let hits = 0;
const seen = new Set<string>();

for (const prompt of PROBES) {
  let grounding = '';
  try {
    const res = await fetch(`${url}/api/app/ground`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, docType }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    grounding = ((await res.json()) as { grounding?: string }).grounding ?? '';
  } catch (e) {
    console.log(`  ERR  ${String((e as { message?: string })?.message ?? e)}  ← ${prompt.slice(0, 52)}…`);
    continue;
  }

  // Which goldens did buildGrounding actually pick? Match on the rendered .md first line.
  const picked = [...keyToFile.entries()].filter(([key]) => grounding.includes(key)).map(([, file]) => file);
  const matched = picked.filter((f) => f.startsWith(match));
  if (matched.length) hits++;
  for (const f of matched) seen.add(f);

  const shortPrompt = prompt.length > 52 ? prompt.slice(0, 52) + '…' : prompt;
  console.log(`  ${matched.length ? 'HIT ' : 'miss'} ${shortPrompt}`);
  console.log(`       retrieved: ${picked.length ? picked.join(' · ') : '(none)'}`);
}

console.log('');
if (hits === 0) {
  console.log(`[retrieval-check] NO EFFECT EXPECTED — 0/${PROBES.length} probes retrieved a "${match}" golden.`);
  console.log('[retrieval-check] The model never sees this material, so any before/after delta is noise,');
  console.log('[retrieval-check] not evidence. rankGolden() takes only the top 3 — the new pairs lose to');
  console.log('[retrieval-check] whatever already ranks. Fix retrieval (or the keys), not the volume.');
}
console.log(`RETRIEVAL_CHECK hits=${hits}/${PROBES.length} files=${seen.size}`);
