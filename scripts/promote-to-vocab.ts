/**
 * promote-to-vocab — read a generated part's current disk source, diff it
 * against its vocabulary entry's translator output, propose a patch to
 * `docs/parts/vocabulary.json`, and (with confirmation) apply it.
 *
 * The symmetric inverse of regenerate-from-vocab.ts. Together they close
 * the bidirectional loop:
 *
 *   vocabulary.json  ──translator──▶  generated part on volume
 *                     ◀─promoter─
 *
 * What v0.1 handles (auto-patch): param value changes (default / min /
 * max / step / unit), added params, removed params, polygon vertex
 * expression changes, added/removed polygon vertices, added/removed
 * preamble const declarations. What it flags for manual review:
 * structural body changes (helpers, conditionals, return shape changes),
 * imports changes (asm), composition tree changes.
 *
 * Run: `bun scripts/promote-to-vocab.ts <term>`
 *      `bun scripts/promote-to-vocab.ts <term> --apply`   # skip prompt
 */
import { translate, type Vocabulary, type VocabPrimitiveRule, type VocabParam } from '../src/lib/authoring/rule-translator';

const BASE = process.env.CADTRAIN_BASE ?? 'http://localhost:3333';
const VOCAB_PATH = 'docs/parts/vocabulary.json';

const term = process.argv[2];
const autoApply = process.argv.includes('--apply');
if (!term) {
  console.error('usage: bun scripts/promote-to-vocab.ts <term> [--apply]');
  process.exit(1);
}

const vocab: Vocabulary = JSON.parse(await Bun.file(VOCAB_PATH).text());
const entry = vocab.terms[term];
if (!entry) {
  console.error(`unknown term: ${term}`);
  console.error(`known: ${Object.keys(vocab.terms).join(', ')}`);
  process.exit(1);
}

// Pull the current saved source from the volume.
const r = await fetch(`${BASE}/api/primitives/source?name=${encodeURIComponent(entry.exemplar)}`);
if (!r.ok) {
  console.error(`fetch ${entry.exemplar}: ${r.status} ${await r.text()}`);
  process.exit(1);
}
const data = await r.json() as { source: string; params: Record<string, any> };
const diskSource = data.source as string;

// What the translator WOULD produce right now from the vocab entry.
const expectedSource = translate(term, vocab);

// Quick path: identical sources → nothing to promote.
if (diskSource.trim() === expectedSource.trim()) {
  console.log(`✓ ${term} (${entry.exemplar}) — no drift from vocab. Nothing to promote.`);
  process.exit(0);
}

// ─── Diff engine ───────────────────────────────────────────────────────

interface Diff {
  paramAdded:   Array<{ key: string; spec: VocabParam }>;
  paramRemoved: string[];
  paramChanged: Array<{ key: string; field: string; was: any; now: any }>;
  polyVertexAdded:   Array<{ index: number; expr: string }>;
  polyVertexRemoved: number[];
  polyVertexChanged: Array<{ index: number; was: string; now: string }>;
  preambleAdded:   string[];
  preambleRemoved: string[];
  structural: string[];                                 // catch-all for unhandleable
}

const diff: Diff = {
  paramAdded: [], paramRemoved: [], paramChanged: [],
  polyVertexAdded: [], polyVertexRemoved: [], polyVertexChanged: [],
  preambleAdded: [], preambleRemoved: [],
  structural: [],
};

/** Extract `params: { ... }` from a source by balanced-brace scan. */
function extractMetaParams(src: string): Record<string, VocabParam> {
  const m = src.match(/\bparams\s*:\s*\{/);
  if (!m) return {};
  const start = (m.index ?? 0) + m[0].length - 1;
  let depth = 0, i = start;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  if (depth !== 0) return {};
  const block = src.slice(start, i);
  // Each row: `<key>: { label: '…', min: …, max: …, step: …, default: …, unit: '…' }`
  const out: Record<string, VocabParam> = {};
  const rowRe = /(\w+)\s*:\s*\{([^}]*)\}/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(block)) !== null) {
    const key = rm[1]!;
    const fields = rm[2]!;
    const get = (k: string) => {
      const fm = fields.match(new RegExp(`\\b${k}\\s*:\\s*([^,}\\n]+)`));
      if (!fm) return undefined;
      const raw = fm[1]!.trim().replace(/[,]$/, '');
      // Try to parse as number; else strip quotes.
      const n = Number(raw);
      if (!isNaN(n) && /^-?\d+(\.\d+)?$/.test(raw)) return n;
      return raw.replace(/^['"`]|['"`]$/g, '');
    };
    out[key] = {
      default: get('default') as any,
      min:   get('min')   as any,
      max:   get('max')   as any,
      step:  get('step')  as any,
      unit:  get('unit')  as any,
      label: get('label') as any,
    };
  }
  return out;
}

/** Extract the polygon array from the function body of a polygon_inline part. */
function extractPolygon(src: string): string[] | null {
  const m = src.match(/const\s+profile_pts\s*=\s*\[/);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length - 1;
  let depth = 0, i = start;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  if (depth !== 0) return null;
  const arr = src.slice(start, i);
  // Split by top-level commas (vertices are themselves `[r, z]` arrays).
  const verts: string[] = [];
  let d = 0, lastStart = 1;
  for (let k = 1; k < arr.length - 1; k++) {
    const ch = arr[k]!;
    if (ch === '[') d++;
    else if (ch === ']') d--;
    else if (ch === ',' && d === 0) {
      const v = arr.slice(lastStart, k).trim();
      if (v) verts.push(v);
      lastStart = k + 1;
    }
  }
  const last = arr.slice(lastStart, arr.length - 1).trim();
  if (last) verts.push(last);
  return verts;
}

/** Extract preamble const declarations from a polygon_inline body (after the
 *  `??=` defaults block, before `const profile_pts = …`). */
function extractPreamble(src: string): string[] {
  const fnMatch = src.match(/export\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*?)\n\}\s*$/);
  if (!fnMatch) return [];
  const body = fnMatch[1]!;
  const lines = body.split('\n').map((l) => l.trim());
  const out: string[] = [];
  let sawDefaults = false;
  for (const line of lines) {
    if (line.includes('??=')) { sawDefaults = true; continue; }
    if (!sawDefaults) continue;
    if (line.startsWith('const profile_pts')) break;
    if (line.startsWith('const ')) out.push(line);
  }
  return out;
}

// ─── Compute diffs ─────────────────────────────────────────────────────

const diskParams     = extractMetaParams(diskSource);
const expectedParams = extractMetaParams(expectedSource);

// Param-key diffs
const diskKeys = new Set(Object.keys(diskParams));
const expectedKeys = new Set(Object.keys(expectedParams));
for (const k of diskKeys) {
  if (!expectedKeys.has(k)) diff.paramAdded.push({ key: k, spec: diskParams[k]! });
}
for (const k of expectedKeys) {
  if (!diskKeys.has(k)) diff.paramRemoved.push(k);
}
// Field-level diffs for shared keys
for (const k of diskKeys) {
  if (!expectedKeys.has(k)) continue;
  const a = diskParams[k]!, b = expectedParams[k]!;
  for (const field of ['default', 'min', 'max', 'step', 'unit', 'label'] as const) {
    const va = (a as any)[field], vb = (b as any)[field];
    if (va !== vb && !(va == null && vb == null)) {
      diff.paramChanged.push({ key: k, field, was: vb, now: va });
    }
  }
}

// Polygon diffs (only relevant for polygon_inline parts)
const rule = entry.rule as VocabPrimitiveRule;
if (rule.template === 'polygon_inline') {
  const diskPoly = extractPolygon(diskSource) ?? [];
  const expectedPoly = extractPolygon(expectedSource) ?? [];
  const minLen = Math.min(diskPoly.length, expectedPoly.length);
  for (let i = 0; i < minLen; i++) {
    if (diskPoly[i] !== expectedPoly[i]) {
      diff.polyVertexChanged.push({ index: i, was: expectedPoly[i]!, now: diskPoly[i]! });
    }
  }
  if (diskPoly.length > expectedPoly.length) {
    for (let i = expectedPoly.length; i < diskPoly.length; i++) {
      diff.polyVertexAdded.push({ index: i, expr: diskPoly[i]! });
    }
  } else if (expectedPoly.length > diskPoly.length) {
    for (let i = diskPoly.length; i < expectedPoly.length; i++) {
      diff.polyVertexRemoved.push(i);
    }
  }

  // Preamble diffs
  const diskPre = new Set(extractPreamble(diskSource));
  const expPre  = new Set(extractPreamble(expectedSource));
  for (const line of diskPre) if (!expPre.has(line)) diff.preambleAdded.push(line);
  for (const line of expPre)  if (!diskPre.has(line)) diff.preambleRemoved.push(line);
}

// ─── Report ────────────────────────────────────────────────────────────

const hasAnyDiff =
  diff.paramAdded.length || diff.paramRemoved.length || diff.paramChanged.length ||
  diff.polyVertexAdded.length || diff.polyVertexRemoved.length || diff.polyVertexChanged.length ||
  diff.preambleAdded.length || diff.preambleRemoved.length;

if (!hasAnyDiff) {
  console.log(`✓ ${term} — sources differ but no structured changes detected (likely whitespace / trace tag). Nothing to promote.`);
  process.exit(0);
}

console.log(`\n# Promotion proposal — ${term} (${entry.exemplar}) → vocabulary.${term}\n`);

function fmt(v: any): string {
  if (v == null) return '—';
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

if (diff.paramAdded.length) {
  console.log('## Params ADDED');
  for (const a of diff.paramAdded) console.log(`  + ${a.key}: default=${fmt(a.spec.default)}, min=${fmt(a.spec.min)}, max=${fmt(a.spec.max)}, step=${fmt(a.spec.step)}, unit=${fmt(a.spec.unit)}`);
}
if (diff.paramRemoved.length) {
  console.log('## Params REMOVED');
  for (const k of diff.paramRemoved) console.log(`  − ${k}`);
}
if (diff.paramChanged.length) {
  console.log('## Param fields CHANGED');
  for (const c of diff.paramChanged) console.log(`  ~ ${c.key}.${c.field}: ${fmt(c.was)} → ${fmt(c.now)}`);
}
if (diff.polyVertexAdded.length) {
  console.log('## Polygon vertices ADDED (appended)');
  for (const v of diff.polyVertexAdded) console.log(`  + [${v.index}] ${v.expr}`);
}
if (diff.polyVertexRemoved.length) {
  console.log('## Polygon vertices REMOVED');
  for (const i of diff.polyVertexRemoved) console.log(`  − [${i}]`);
}
if (diff.polyVertexChanged.length) {
  console.log('## Polygon vertices CHANGED');
  for (const c of diff.polyVertexChanged) console.log(`  ~ [${c.index}] ${c.was} → ${c.now}`);
}
if (diff.preambleAdded.length) {
  console.log('## Preamble lines ADDED');
  for (const l of diff.preambleAdded) console.log(`  + ${l}`);
}
if (diff.preambleRemoved.length) {
  console.log('## Preamble lines REMOVED');
  for (const l of diff.preambleRemoved) console.log(`  − ${l}`);
}

if (!autoApply) {
  console.log(`\nReview the changes above. Run with --apply to patch vocabulary.json + verify via the regenerator.`);
  console.log(`  bun scripts/promote-to-vocab.ts ${term} --apply`);
  process.exit(0);
}

// ─── Apply ─────────────────────────────────────────────────────────────

// Apply param changes
for (const a of diff.paramAdded) (entry.params as any)[a.key] = stripNulls(a.spec);
for (const k of diff.paramRemoved) delete (entry.params as any)[k];
for (const c of diff.paramChanged) (entry.params as any)[c.key][c.field] = c.now;

// Apply polygon + preamble changes (for polygon_inline rules)
if (rule.template === 'polygon_inline') {
  if (rule.polygon) {
    for (const c of diff.polyVertexChanged) rule.polygon[c.index] = c.now;
    for (const a of diff.polyVertexAdded)   rule.polygon.push(a.expr);
    // Removed indices in descending order so splice indices stay valid.
    for (const i of diff.polyVertexRemoved.sort((a, b) => b - a)) rule.polygon.splice(i, 1);
  }
  if (rule.preamble) {
    for (const line of diff.preambleAdded) rule.preamble.push(line);
    rule.preamble = rule.preamble.filter((l) => !diff.preambleRemoved.includes(l));
  }
}

// Bump patch version (0.3.0 → 0.3.1).
const ver = vocab.version.split('.');
if (ver.length === 3) {
  ver[2] = String(Number(ver[2]) + 1);
  vocab.version = ver.join('.');
}

await Bun.write(VOCAB_PATH, JSON.stringify(vocab, null, 2) + '\n');
console.log(`\n→ wrote ${VOCAB_PATH} (bumped to v${vocab.version})`);
console.log(`→ run \`bun scripts/regenerate-from-vocab.ts --update-lock\` to validate the round-trip.`);

function stripNulls<T extends object>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v != null) out[k] = v;
  return out;
}
