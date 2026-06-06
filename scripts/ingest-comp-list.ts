#!/usr/bin/env bun
/**
 * ingest-comp-list — turn SVTC's comp_list.xlsx into vocabulary seeds.
 *
 * Reads ~/code/SVTC/static/comp_list.xlsx (57 completion components,
 * each with OD / ID / length / threading / company / tool_comp), parses
 * the SpreadsheetML zip directly (no openpyxl, no python — fflate is
 * the only dep), and emits docs/parts/vocabulary.seeds.json.
 *
 * Each row becomes a draft vocabulary term with `status: 'seed'` so the
 * loader + translator + lock pipeline treat it as REVIEW-PENDING (not
 * regen-eligible). The /vocab page surfaces seeds in their own group;
 * promoting a seed = writing a `rule:{...}` block + flipping status to
 * `'promoted'`.
 *
 * Curated v0.3 vocabulary.json is untouched.
 *
 *   bun scripts/ingest-comp-list.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';

const SRC = resolve(homedir(), 'code/SVTC/static/comp_list.xlsx');
const DST = resolve(process.cwd(), 'docs/parts/vocabulary.seeds.json');
const COMPJSON_DIR = resolve(process.cwd(), 'static/svtc-compjson');

if (!existsSync(SRC)) {
  console.error(`xlsx not found: ${SRC}`);
  process.exit(1);
}

// ─── unzip + read parts of the SpreadsheetML ──────────────────────────────

const archive = unzipSync(readFileSync(SRC));
const sharedRaw = strFromU8(archive['xl/sharedStrings.xml']!);
const sheetRaw  = strFromU8(archive['xl/worksheets/sheet1.xml']!);

// sharedStrings: <si><t>...</t></si> in document order.
const sharedStrings: string[] = [];
const reSI = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
let m: RegExpExecArray | null;
while ((m = reSI.exec(sharedRaw)) !== null) {
  // <si> may contain a single <t>...</t> or rich text with multiple <t>.
  const tText = [...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? '').join('');
  sharedStrings.push(decodeXml(tText));
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xD;/g, '\r')
    .replace(/&#xA;/g, '\n')
    .replace(/&amp;/g, '&');
}

// Sheet rows: <row r="N">…<c r="A2" t="s"><v>20</v></c>…</row>
type Cell = { col: string; type: string; value: string };
type Row  = { r: number; cells: Record<string, Cell> };
const rows: Row[] = [];
const reRow = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
const reCell = /<c\b[^>]*\br="([A-Z]+)(\d+)"(?:[^>]*\bt="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g;
let rm: RegExpExecArray | null;
while ((rm = reRow.exec(sheetRaw)) !== null) {
  const rowIdx = Number(rm[1]);
  const cells: Record<string, Cell> = {};
  let cm: RegExpExecArray | null;
  reCell.lastIndex = 0;
  while ((cm = reCell.exec(rm[2]!)) !== null) {
    const col = cm[1]!;
    const type = cm[3] ?? 'n';
    const inner = cm[4] ?? '';
    // <v>N</v> or a formula <f>…</f><v>cached</v>
    const vMatch = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
    let value = vMatch ? vMatch[1]! : '';
    if (type === 's') value = sharedStrings[Number(value)] ?? '';
    cells[col] = { col, type, value };
  }
  rows.push({ r: rowIdx, cells });
}

// Map columns to comp_list headers (from sheet1 we know A1..T1).
const headerRow = rows.find((r) => r.r === 1);
if (!headerRow) { console.error('no header row'); process.exit(1); }
const colKey: Record<string, string> = {};
for (const [col, cell] of Object.entries(headerRow.cells)) colKey[col] = cell.value;

console.log(`columns: ${Object.values(colKey).join(', ')}`);

// ─── translate rows → seed entries ────────────────────────────────────────

interface SizeVariant {
  comp_id: number;
  description: string;
  od_in?: number;
  id_in?: number;
  length_ft?: number;
  weight_lb?: number;
  company?: string;
  top_thread?: string;
  bot_thread?: string;
  grade?: string;
}
interface SeedTerm {
  kind: 'rev' | 'asm';
  status: 'seed';
  category: string;
  sub_category: string;
  description: string;
  synonyms: string[];
  // Defaults pulled from the FIRST row that introduced this slug.
  dims_from_catalogue: { od_in?: number; id_in?: number; length_ft?: number; weight_lb?: number };
  metadata: {
    tool_comp?: string;
    tags?: string[];
  };
  // Every row sharing the same tool_comp ends up here — different sizes
  // of the same component. The translator will eventually pick one as
  // the parametric exemplar; the rest stay as range hints.
  variants: SizeVariant[];
  compjson_ref?: string;
  rule: null;
}

function slugFromToolComp(toolComp: string, sub: string, idx: number): string {
  // tool_comp like "PACKERS.PACKER_BAKER_PERMANENT" → strip family prefix, lowercase.
  if (toolComp && toolComp.includes('.')) {
    const tail = toolComp.split('.').slice(1).join('_');
    return tail.toLowerCase();
  }
  if (toolComp) return toolComp.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (sub) return sub.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `seed_${idx}`;
}

function joinThread(size: string, type: string): string | undefined {
  const s = size?.trim(); const t = type?.trim();
  if (!s && !t) return undefined;
  if (s && t) return `${t} (${s})`;
  return s || t;
}

function num(v: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const seeds: Record<string, SeedTerm> = {};
const skipped: string[] = [];

for (const row of rows) {
  if (row.r === 1) continue;
  const get = (col: string) => row.cells[col]?.value ?? '';
  const compId = Number(get('A'));
  const category = get('B');
  const sub = get('C');
  const desc = get('D');
  const od = num(get('E'));
  const id = num(get('F'));
  const lenFt = num(get('G'));
  const weight = num(get('H'));
  const company = get('I');
  const topSize = get('J');
  const botSize = get('K');
  const topType = get('L');
  const botType = get('M');
  const grade = get('N');
  const toolComp = get('O');
  const tag1 = get('S');
  const tag2 = get('T');

  if (!category || !sub) { skipped.push(`row ${row.r}: missing category/sub`); continue; }

  const slug = slugFromToolComp(toolComp, sub, row.r);

  const variant: SizeVariant = {
    comp_id: compId,
    description: desc,
    ...(od != null ? { od_in: od } : {}),
    ...(id != null ? { id_in: id } : {}),
    ...(lenFt != null ? { length_ft: lenFt } : {}),
    ...(weight != null ? { weight_lb: weight } : {}),
    ...(company ? { company } : {}),
    ...(joinThread(topSize, topType) ? { top_thread: joinThread(topSize, topType)! } : {}),
    ...(joinThread(botSize, botType) ? { bot_thread: joinThread(botSize, botType)! } : {}),
    ...(grade ? { grade } : {}),
  };

  // Existing term? append a variant and merge synonyms — same tool_comp,
  // different size/threading.
  if (seeds[slug]) {
    seeds[slug].variants.push(variant);
    const merged = new Set(seeds[slug].synonyms);
    for (const s of [desc, sub, tag1, tag2]) if (s) merged.add(s);
    seeds[slug].synonyms = Array.from(merged);
    continue;
  }

  // tube-shaped families compose; pure-rev shapes get rev kind.
  const revFamilies = new Set(['Tubing', 'Flow Coupling']);
  const kind: 'rev' | 'asm' = revFamilies.has(sub) ? 'rev' : 'asm';

  const syns = Array.from(new Set([desc, sub, tag1, tag2].filter(Boolean) as string[]));
  const tags = Array.from(new Set([tag1, tag2].filter(Boolean) as string[]));

  const compjsonRef = toolComp && existsSync(resolve(COMPJSON_DIR, `${toolComp}.json`))
    ? `/svtc-compjson/${toolComp}.json` : undefined;

  seeds[slug] = {
    kind,
    status: 'seed',
    category,
    sub_category: sub,
    description: desc,
    synonyms: syns,
    dims_from_catalogue: {
      ...(od != null ? { od_in: od } : {}),
      ...(id != null ? { id_in: id } : {}),
      ...(lenFt != null ? { length_ft: lenFt } : {}),
      ...(weight != null ? { weight_lb: weight } : {}),
    },
    metadata: {
      ...(toolComp ? { tool_comp: toolComp } : {}),
      ...(tags.length ? { tags } : {}),
    },
    variants: [variant],
    ...(compjsonRef ? { compjson_ref: compjsonRef } : {}),
    rule: null,
  };
}

const out = {
  $schema: './vocabulary.schema.json',
  version: '0.1.0',
  source: 'SVTC static/comp_list.xlsx',
  ingested: new Date().toISOString().slice(0, 10),
  notes: [
    'K.68 Phase 2 SEED file — completion components ingested from SVTC.',
    'These are NOT translated by the rule-translator until status flips from "seed" to "promoted".',
    'compjson_ref points at static/svtc-compjson/<TOOL_COMP>.json — 2D vendor silhouette for visual review.',
    'Promotion path: review in /vocab → propose rule: {...} → bake-verify → flip status → translator picks it up.',
  ],
  stats: {
    rows_total: rows.length - 1,
    seeds: Object.keys(seeds).length,
    skipped: skipped.length,
    with_compjson: Object.values(seeds).filter((s) => s.compjson_ref).length,
    total_variants: Object.values(seeds).reduce((acc, s) => acc + s.variants.length, 0),
  },
  skipped,
  terms: seeds,
};

writeFileSync(DST, JSON.stringify(out, null, 2) + '\n');
console.log(`\nwrote ${DST}`);
console.log(`  seeds:   ${out.stats.seeds}`);
console.log(`  w/ ref:  ${out.stats.with_compjson}`);
console.log(`  skipped: ${out.stats.skipped}`);
if (skipped.length) for (const s of skipped) console.log(`  - ${s}`);
