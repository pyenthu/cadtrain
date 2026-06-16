#!/usr/bin/env bun
/**
 * sync-svtc-compjson — copy SVTC's compjson reference drawings into cadtrain.
 *
 * These are the 72 DrawingML-extracted polyline JSON files produced by
 * SVTC's `src/lib/training/drawingml.js` (which reads vector shapes
 * embedded in completion XLSX files). They drive the SVTC schematic
 * assembly view (TdgApp's compJsonToSvg renderer).
 *
 * For cadtrain we use them as 2D visual REFERENCES alongside each
 * vocabulary term's 3D bake in /vocab. They're never regenerated here
 * — re-run this script after SVTC re-extracts.
 *
 * Source: ~/code/SVTC/static/compjson/*.json (72 files, ~3 MB)
 * Dest:   ./static/svtc-compjson/*.json
 *
 *   bun scripts/sync-svtc-compjson.ts          # copy
 *   bun scripts/sync-svtc-compjson.ts --check  # report diff only
 */
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const SRC = resolve(homedir(), 'code/SVTC/static/compjson');
const DST = resolve(process.cwd(), 'static/svtc-compjson');
const CHECK = process.argv.includes('--check');

if (!existsSync(SRC)) {
  console.error(`source missing: ${SRC} — is the SVTC repo at ~/code/SVTC?`);
  process.exit(1);
}

const srcFiles = readdirSync(SRC).filter((f) => f.endsWith('.json')).sort();
const dstFiles = existsSync(DST) ? new Set(readdirSync(DST).filter((f) => f.endsWith('.json'))) : new Set();

const toCopy: string[] = [];
const toDelete: string[] = [];
let bytes = 0;

for (const f of srcFiles) {
  const ssize = statSync(join(SRC, f)).size;
  if (!dstFiles.has(f)) { toCopy.push(f); bytes += ssize; continue; }
  const dsize = statSync(join(DST, f)).size;
  if (dsize !== ssize) { toCopy.push(f); bytes += ssize; }
  dstFiles.delete(f);
}
toDelete.push(...dstFiles);

console.log(`source: ${srcFiles.length} files in ${SRC}`);
console.log(`dest:   ${DST}`);
console.log(`copy:   ${toCopy.length} files (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`delete: ${toDelete.length} stale files`);

if (CHECK) {
  if (toCopy.length) console.log('\nwould copy:'); for (const f of toCopy.slice(0, 10)) console.log(`  ${f}`);
  if (toCopy.length > 10) console.log(`  …and ${toCopy.length - 10} more`);
  if (toDelete.length) console.log('\nwould delete:'); for (const f of toDelete) console.log(`  ${f}`);
  process.exit(0);
}

if (!existsSync(DST)) mkdirSync(DST, { recursive: true });
for (const f of toCopy) copyFileSync(join(SRC, f), join(DST, f));
for (const f of toDelete) rmSync(join(DST, f));

console.log('\ndone.');
