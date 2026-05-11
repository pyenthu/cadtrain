#!/usr/bin/env bun
/**
 * Knowledge-base extractor: Casing & Tubing operational data.
 *
 * Source : kb-sources/825214624-Casing-and-Tubing-Data-2019-01.pdf (June 2019,
 *          Excel-exported operator inventory — 234 rows of per-pipe specs:
 *          size, weight, supplier, grade, connection, OD, wall, ID, drift,
 *          burst, collapse, yield, make-up torque, color bands).
 * Output : static/kb/api/casing-tubing-data.json (committed).
 *
 * Pipeline:
 *   1. pdftotext -layout <input>           → column-preserved plain text
 *   2. for each data row, anchor on the grade-column pattern (e.g. J-55,
 *      L-80.1, P-110, Q-125, X-42, TN-95HS, VM-95HCSS, B). The grade is
 *      the cleanest non-numeric anchor — supplier and connection names can
 *      have spaces, so positional splitting alone is unreliable. With the
 *      grade located, everything left of it (after size+weight) is the
 *      supplier, everything right (before the next numeric column =
 *      Connection OD) is the connection.
 *   3. parse the remaining 20 numeric/text columns by anchoring on the
 *      joint-length class column (R-1/R-2/R-3) — that splits the row into
 *      a fixed-shape numeric tail.
 *
 * Re-run after tweaks:    bun run scripts/kb/build_casing_tubing_data.ts
 * No flags by design — input + output paths are hard-coded to the only
 * source this script handles. Generalisation lives in a future kb-lib if a
 * second similar source ever shows up.
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';

const INPUT_PDF  = resolve('kb-sources/825214624-Casing-and-Tubing-Data-2019-01.pdf');
const OUTPUT_JSON = resolve('static/kb/api/casing-tubing-data.json');

// Grade-token shape test. A grade token is single-word, ≤16 chars, AND
// either matches the bare "B" sentinel (API-5L Grade B), OR contains BOTH
// a letter and a digit (J-55, L-80.1, P-110, X-42, TN-95HS, VM-95HCSS,
// SM-125TT, SM-2535-110, Sanicro28-110, etc.). The "no internal space"
// rule is what saves us from false positives like the connection name
// "VAM 21-NA", which would otherwise match the letter+digit predicate.
function isGradeShape(t: string): boolean {
  if (t.includes(' ')) return false;
  if (t.length > 16) return false;
  if (t === 'B') return true;
  return /[A-Za-z]/.test(t) && /\d/.test(t);
}

// Size normalisation: "2-3/8\"" → 2.375, "13-3/8\"" → 13.375, "40\"" → 40.
function parseSize(raw: string): number | null {
  const m = raw.match(/^(\d+)(?:-(\d+)\/(\d+))?["']?$/);
  if (!m) return null;
  const whole = parseInt(m[1], 10);
  if (!m[2]) return whole;
  return whole + parseInt(m[2], 10) / parseInt(m[3], 10);
}

// Numeric coercion with sentinel: "-" → null; "1,500" → 1500; "8.06" → 8.06.
function num(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const t = raw.trim();
  if (t === '' || t === '-' || t === '—') return null;
  const cleaned = t.replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function str(raw: string | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const t = raw.trim();
  return t === '' || t === '-' || t === '—' ? null : t;
}

type Row = {
  id_9cat: string | null;
  type: 'LP' | 'CSG' | 'TBG' | string;
  size_label: string;
  size_in: number | null;
  weight_lbft: number | null;
  supplier: string | null;
  grade: string;
  connection: string | null;
  connection_od_in: number | null;
  connection_length_in: number | null;
  joint_length_class: string | null;
  wall_in: number | null;
  pipe_id_in: number | null;
  connection_id_in: number | null;
  drift_in: number | null;
  drift_length_in: number | null;
  thread_per_in: number | null;
  thread_makeup_loss: number | null;
  burst_psi: number | null;
  collapse_psi: number | null;
  pipe_yield_klbf: number | null;
  joint_yield_klbf: number | null;
  mut_min_ftlb: number | null;
  mut_opti_ftlb: number | null;
  mut_max_ftlb: number | null;
  color_band_1: string | null;
  color_band_2: string | null;
  color_band_3: string | null;
};

function parseRow(line: string, pendingId: string | null): Row | null {
  // Tokenise on >=2 spaces — preserves supplier/connection inner spaces.
  const tokens = line.trim().split(/\s{2,}/).filter(Boolean);
  if (tokens.length < 10) return null;

  let i = 0;
  // 9CAT — either leading 10-digit ID inline, OR carried from a wrapped row.
  let id_9cat: string | null = null;
  if (/^\d{10}$/.test(tokens[i])) {
    id_9cat = tokens[i++];
  } else if (pendingId) {
    id_9cat = pendingId;
  }

  // Type — must be LP/CSG/TBG to count as a data row.
  if (!/^(LP|CSG|TBG)$/.test(tokens[i])) return null;
  const type = tokens[i++];

  const size_label = tokens[i++];
  const size_in = parseSize(size_label);
  const weight_lbft = num(tokens[i++]);

  // Anchor 1: joint-length class (R-1/R-2/R-3, or fallback "30-35"-style)
  // — splits connection name from the numeric tail.  This is the most
  // reliable column anchor in the row because R-X is always a single token
  // with no overlap against any supplier/connection name.
  let jlIdx = -1;
  for (let j = i; j < tokens.length; j++) {
    if (/^R-\d$/.test(tokens[j]) || /^\d+-\d+$/.test(tokens[j])) { jlIdx = j; break; }
  }
  if (jlIdx === -1) return null;

  // Two columns immediately left of R-X are Connection OD (numeric) and
  // Connection Length (numeric or "-").
  const conn_od_idx  = jlIdx - 2;
  const conn_len_idx = jlIdx - 1;
  if (conn_od_idx <= i) return null;

  // Anchor 2: rightmost grade-shape token between weight and Connection OD.
  // Two-pass: prefer strict single-word grade (covers ~99% of rows), then
  // fall back to allowing internal-space grade tokens like "AM-110 HC".
  // Right-to-left so a downstream grade beats an upstream supplier token
  // that also happens to contain digits (e.g. "API-5L" + bare grade "B").
  let gradeIdx = -1;
  for (let j = conn_od_idx - 1; j >= i; j--) {
    if (isGradeShape(tokens[j])) { gradeIdx = j; break; }
  }
  if (gradeIdx === -1) {
    for (let j = conn_od_idx - 1; j >= i; j--) {
      const t = tokens[j];
      if (t.length <= 20 && /[A-Za-z]/.test(t) && /\d/.test(t)) { gradeIdx = j; break; }
    }
  }
  if (gradeIdx === -1) return null;

  const supplier = tokens.slice(i, gradeIdx).join(' ').trim() || null;
  const grade = tokens[gradeIdx];
  const connection = tokens.slice(gradeIdx + 1, conn_od_idx).join(' ').trim() || null;
  const connection_od_in = num(tokens[conn_od_idx]);
  const connection_length_in = num(tokens[conn_len_idx]);
  const joint_length_class = tokens[jlIdx];
  i = jlIdx + 1;

  // Remaining tail: wall, pipe ID, conn ID, drift, drift len, thread/in,
  // makeup loss, burst, collapse, pipe yield, joint yield, MUT min/opti/max,
  // color1/2/3.  17 columns expected; pad with nulls if short.
  const tail = tokens.slice(i);
  const t = (k: number) => tail[k];

  return {
    id_9cat,
    type,
    size_label,
    size_in,
    weight_lbft,
    supplier,
    grade,
    connection,
    connection_od_in,
    connection_length_in,
    joint_length_class,
    wall_in: num(t(0)),
    pipe_id_in: num(t(1)),
    connection_id_in: num(t(2)),
    drift_in: num(t(3)),
    drift_length_in: num(t(4)),
    thread_per_in: num(t(5)),
    thread_makeup_loss: num(t(6)),
    burst_psi: num(t(7)),
    collapse_psi: num(t(8)),
    pipe_yield_klbf: num(t(9)),
    joint_yield_klbf: num(t(10)),
    mut_min_ftlb: num(t(11)),
    mut_opti_ftlb: num(t(12)),
    mut_max_ftlb: num(t(13)),
    color_band_1: str(t(14)),
    color_band_2: str(t(15)),
    color_band_3: str(t(16)),
  };
}

function main() {
  // 1. shell out to pdftotext -layout. Always available on macOS via poppler.
  const r = spawnSync('pdftotext', ['-layout', INPUT_PDF, '-'], { encoding: 'utf-8' });
  if (r.status !== 0) {
    console.error('pdftotext failed:', r.stderr);
    process.exit(1);
  }
  const text = r.stdout;
  const lines = text.split('\n');

  const rows: Row[] = [];
  const skipped: { line_no: number; line: string }[] = [];
  let pendingId: string | null = null;

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    // Detect orphan 9CAT line (just an ID, no other data) — that ID belongs
    // to the NEXT data row (the row is wrapped to two lines).
    const orphan = raw.trim().match(/^(\d{10})$/);
    if (orphan) { pendingId = orphan[1]; continue; }

    // Skip blank / header / footer lines.
    if (!raw.trim()) { pendingId = null; continue; }
    if (!/\b(LP|CSG|TBG)\b/.test(raw)) continue;

    const row = parseRow(raw, pendingId);
    if (row) {
      rows.push(row);
      pendingId = null;
    } else {
      skipped.push({ line_no: n + 1, line: raw });
    }
  }

  const sourceBytes = readFileSync(INPUT_PDF);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');

  const kb = {
    schema_version: 1,
    description:
      'Casing/Tubing/Line-Pipe operational inventory — per-pipe specs (size, ' +
      'weight, supplier, grade, connection, OD, wall, ID, drift, burst, ' +
      'collapse, yield, make-up torque, color bands). Sourced from an ' +
      'Excel-exported PDF; the source PDF lives in kb-sources/ (gitignored).',
    source_file: 'kb-sources/' + INPUT_PDF.split('/').pop(),
    source_hash: 'sha256:' + sourceHash,
    source_size_bytes: statSync(INPUT_PDF).size,
    extracted_at: new Date().toISOString().slice(0, 10),
    extractor: 'scripts/kb/build_casing_tubing_data.ts',
    row_count: rows.length,
    skipped_count: skipped.length,
    rows,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(kb, null, 2) + '\n');

  console.log(`parsed ${rows.length} rows · skipped ${skipped.length} · ${OUTPUT_JSON}`);
  if (skipped.length > 0) {
    console.log('\nskipped lines (first 20):');
    for (const s of skipped.slice(0, 20)) console.log(`  ${s.line_no}: ${s.line.slice(0, 140)}`);
  }
}

main();
