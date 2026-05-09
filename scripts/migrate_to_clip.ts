/**
 * scripts/migrate_to_clip.ts
 * ─────────────────────────────────────────────────────────────────
 * Adds CLIP embeddings to existing cache.jsonl records.
 *
 * Reads training_data/cache.jsonl line-by-line, computes a 512-dim
 * embedding from each record's image_b64 thumbnail, and writes the
 * augmented records back. Idempotent — records that already have an
 * `embedding` field are skipped unless --force is passed.
 *
 * Atomic: writes to cache.jsonl.tmp then renames (CLAUDE.md rule 4).
 * Backs up to cache.jsonl.bak.<timestamp> before mutating.
 *
 * Run:
 *   bun run scripts/migrate_to_clip.ts
 *   bun run scripts/migrate_to_clip.ts --file training_data/synthetic_cache.jsonl
 *   bun run scripts/migrate_to_clip.ts --force          # re-embed all
 *   bun run scripts/migrate_to_clip.ts --dry-run        # report counts only
 */

import { readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { computeEmbedding, warmup } from '../src/lib/training/embed';

interface CacheRecord {
  id: string;
  hash: string;
  embedding?: number[];
  component_id: string;
  params: Record<string, number | string>;
  image_b64: string;
  source: string;
  uses?: number;
  accepted?: number;
  [k: string]: unknown;
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: 'training_data/cache.jsonl' },
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
  });

  const path = values.file!;
  const dryRun = !!values['dry-run'];
  const force = !!values.force;

  if (!existsSync(path)) {
    console.error(`not found: ${path}`);
    process.exit(1);
  }

  console.log('\n🔄  CLIP migration');
  console.log(`    File   : ${path}`);
  console.log(`    Mode   : ${dryRun ? 'dry-run' : force ? 'force re-embed' : 'incremental'}\n`);

  const text = await readFile(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const records: CacheRecord[] = lines.map((l) => JSON.parse(l));

  const need = records.filter(
    (r) => force || !r.embedding || !Array.isArray(r.embedding) || r.embedding.length === 0,
  );
  console.log(`    Total   : ${records.length}`);
  console.log(`    To embed: ${need.length}`);
  console.log(`    Skipping: ${records.length - need.length} (already have embeddings)\n`);

  if (dryRun) {
    console.log('dry-run — no changes written');
    return;
  }
  if (need.length === 0) {
    console.log('nothing to do');
    return;
  }

  const backup = `${path}.bak.${Date.now()}`;
  await copyFile(path, backup);
  console.log(`    Backup  : ${backup}\n`);

  console.log('Loading CLIP model (first call only)...');
  await warmup();

  let done = 0;
  const t0 = Date.now();
  for (const r of records) {
    if (!force && r.embedding && Array.isArray(r.embedding) && r.embedding.length > 0) continue;
    try {
      const buf = Buffer.from(r.image_b64, 'base64');
      r.embedding = await computeEmbedding(buf);
      done++;
      if (done % 5 === 0 || done === need.length) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = (need.length - done) / rate;
        process.stdout.write(
          `  embedded ${done}/${need.length}   ${rate.toFixed(1)}/s   ETA ${eta.toFixed(0)}s\r`,
        );
      }
    } catch (e) {
      console.warn(`\n  ⚠  failed on ${r.id}: ${(e as Error).message}`);
    }
  }
  console.log();

  const tmp = `${path}.tmp`;
  const out = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(tmp, out);
  await rename(tmp, path);

  const sizeMB = Buffer.byteLength(out) / 1e6;
  console.log(`\n✅  Wrote ${records.length} records → ${path} (${sizeMB.toFixed(1)} MB)`);
  console.log(`    Restore: cp ${backup} ${path}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
