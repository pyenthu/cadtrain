/**
 * Seed the persistent training cache from existing prim_* training data.
 *
 * Usage: bun tsx scripts/seed_cache.ts
 */

import { readdirSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { computePHash, makeThumbnail } from '../src/lib/training/phash.ts';
import { TrainingCache } from '../src/lib/training/cache.ts';
import { randomBytes } from 'crypto';

const ROOT = process.cwd();
const TRAINING_DIR = join(ROOT, 'training_data');
const CACHE_PATH = join(TRAINING_DIR, 'cache.jsonl');

async function main() {
  // Remove existing cache to start fresh
  if (existsSync(CACHE_PATH)) {
    unlinkSync(CACHE_PATH);
    console.log(`Removed existing cache: ${CACHE_PATH}`);
  }

  const cache = new TrainingCache(CACHE_PATH);
  await cache.load();

  // Walk prim_* directories
  const dirs = readdirSync(TRAINING_DIR).filter((d) => d.startsWith('prim_'));
  console.log(`Found ${dirs.length} prim_* directories`);

  let total = 0;
  let errors = 0;

  for (const dir of dirs) {
    const trainingJsonPath = join(TRAINING_DIR, dir, 'training.json');
    if (!existsSync(trainingJsonPath)) {
      console.log(`  SKIP ${dir}: no training.json`);
      continue;
    }

    const records = JSON.parse(readFileSync(trainingJsonPath, 'utf-8'));
    console.log(`\n${dir}: ${records.length} records`);

    for (const rec of records) {
      const imageRel = rec.image_3d || rec.image;
      if (!imageRel) {
        console.log(`  SKIP: no image field`);
        continue;
      }

      const imagePath = join(TRAINING_DIR, dir, imageRel);
      if (!existsSync(imagePath)) {
        console.log(`  SKIP: image not found: ${imagePath}`);
        continue;
      }

      try {
        const buffer = readFileSync(imagePath);
        const hash = await computePHash(buffer);
        const thumb = await makeThumbnail(buffer, 256);

        // Normalize params keys to lowercase
        const normalizedParams: Record<string, number> = {};
        for (const [k, v] of Object.entries(rec.params || {})) {
          if (typeof v === 'number') {
            // Lowercase first letter, keep camelCase
            const key = k.charAt(0).toLowerCase() + k.slice(1);
            normalizedParams[key] = v;
          }
        }

        await cache.append({
          id: randomBytes(6).toString('hex'),
          hash,
          component_id: rec.component_id,
          params: normalizedParams,
          image_b64: thumb,
          source: 'seed',
          created: new Date().toISOString(),
          uses: 0,
          accepted: 0,
        });
        total++;
        process.stdout.write('.');
      } catch (e: any) {
        errors++;
        console.log(`\n  ERROR on ${imagePath}: ${e.message}`);
      }
    }
  }

  console.log(`\n\nSeed complete: ${total} records added, ${errors} errors`);
  console.log(`Cache file: ${CACHE_PATH}`);
  const stats = cache.stats();
  console.log(`Stats:`, stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
