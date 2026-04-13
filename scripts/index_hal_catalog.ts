/**
 * HAL catalog indexer.
 *
 * Walks the extracted images under HAL_PACKERS/tools/** and HAL_WPS/tools/**,
 * computes a pHash + 256px thumbnail for each, and appends them to the
 * persistent training cache with source='catalog'. Catalog records have
 * component_id='unknown' (they're not parameterized) — they exist so that
 * /reverse can retrieve real-world catalog images as visual context.
 *
 * Usage:
 *   bun run scripts/index_hal_catalog.ts            # actually index
 *   bun run scripts/index_hal_catalog.ts --dry-run  # count + preview only
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, basename, relative, dirname } from 'path';
import { randomBytes } from 'crypto';
import { computePHash, makeThumbnail } from '../src/lib/training/phash';
import { getCache, type CacheRecord, type CatalogMeta } from '../src/lib/training/cache';

const ROOT = process.cwd();
const CACHE_PATH = join(ROOT, 'training_data', 'cache.jsonl');
const BATCH_SIZE = 50;
const DRY_RUN = process.argv.includes('--dry-run');

interface CatalogSource {
  catalog: 'HAL_PACKERS' | 'HAL_WPS';
  toolsDir: string;
  indexPath: string;
}

const SOURCES: CatalogSource[] = [
  {
    catalog: 'HAL_PACKERS',
    toolsDir: join(ROOT, 'HAL_PACKERS', 'tools'),
    indexPath: join(ROOT, 'HAL_PACKERS', 'tools', 'tool_index.json'),
  },
  {
    catalog: 'HAL_WPS',
    toolsDir: join(ROOT, 'HAL_WPS', 'tools'),
    indexPath: join(ROOT, 'HAL_WPS', 'tools', 'tool_index.json'),
  },
];

interface ToolIndexEntry {
  page: number;
  tool_name: string;
  has_images?: boolean;
  categories?: string[];
  section?: string;
}

/** Recursively walk a directory and yield image file paths. */
function* walkImages(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkImages(full);
    } else if (/_img_\d+\.(png|jpe?g)$/i.test(entry)) {
      yield full;
    }
  }
}

/** Extract page number from filenames like p0042_Wireline-Set_Packers_img_3.jpeg */
function parsePageFromFilename(filename: string): number | null {
  const m = basename(filename).match(/^p(\d{4})_/);
  return m ? parseInt(m[1], 10) : null;
}

/** Build a page → tool_name lookup from a tool_index.json file. */
function loadToolIndex(path: string): Map<number, ToolIndexEntry> {
  if (!existsSync(path)) return new Map();
  const entries = JSON.parse(readFileSync(path, 'utf-8')) as ToolIndexEntry[];
  const map = new Map<number, ToolIndexEntry>();
  for (const e of entries) map.set(e.page, e);
  return map;
}

async function processFile(
  filePath: string,
  source: CatalogSource,
  toolIndex: Map<number, ToolIndexEntry>,
): Promise<CacheRecord | null> {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 200) return null; // skip tiny / empty stubs

    const hash = await computePHash(buffer);
    const thumb = await makeThumbnail(buffer, 256);
    const page = parsePageFromFilename(filePath);
    const indexEntry = page !== null ? toolIndex.get(page) : undefined;

    const meta: CatalogMeta = {
      catalog: source.catalog,
      page: page ?? undefined,
      tool_name: indexEntry?.tool_name,
      original_path: relative(ROOT, filePath),
    };

    return {
      id: randomBytes(6).toString('hex'),
      hash,
      component_id: 'unknown',
      params: {},
      image_b64: thumb,
      source: 'catalog',
      created: new Date().toISOString(),
      uses: 0,
      accepted: 0,
      wrong_match: 0,
      version: 2,
      catalog_meta: meta,
    };
  } catch (e: any) {
    console.warn(`  ! skip ${basename(filePath)}: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`HAL catalog indexer ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`Cache: ${CACHE_PATH}`);

  // Collect all candidate files first so we can show an accurate progress total.
  const allFiles: { path: string; source: CatalogSource }[] = [];
  for (const source of SOURCES) {
    let count = 0;
    for (const f of walkImages(source.toolsDir)) {
      allFiles.push({ path: f, source });
      count++;
    }
    console.log(`  found ${count} images in ${source.catalog}`);
  }
  console.log(`Total: ${allFiles.length} images to process`);

  if (DRY_RUN) {
    console.log('\nSample paths:');
    for (const f of allFiles.slice(0, 5)) {
      console.log(`  ${relative(ROOT, f.path)}`);
    }
    console.log('\n(dry run — no records written)');
    return;
  }

  // Load tool index lookups once per catalog
  const toolIndexByCatalog = new Map<string, Map<number, ToolIndexEntry>>();
  for (const s of SOURCES) toolIndexByCatalog.set(s.catalog, loadToolIndex(s.indexPath));

  const cache = await getCache(CACHE_PATH);
  const sizeBefore = cache.stats().total;
  console.log(`Cache size before: ${sizeBefore} records\n`);

  const buffer: CacheRecord[] = [];
  let processed = 0;
  let skipped = 0;
  const start = Date.now();

  for (const { path, source } of allFiles) {
    const rec = await processFile(path, source, toolIndexByCatalog.get(source.catalog)!);
    if (rec) {
      buffer.push(rec);
    } else {
      skipped++;
    }
    processed++;

    // Flush batch
    if (buffer.length >= BATCH_SIZE) {
      await cache.appendBatch(buffer.splice(0));
      const pct = ((processed / allFiles.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  ${processed}/${allFiles.length} (${pct}%) — ${elapsed}s elapsed, ${skipped} skipped`);
    }
  }

  // Final flush
  if (buffer.length > 0) {
    await cache.appendBatch(buffer.splice(0));
  }

  const sizeAfter = cache.stats().total;
  const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone. Cache size: ${sizeBefore} → ${sizeAfter} (+${sizeAfter - sizeBefore})`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Elapsed: ${totalElapsed}s`);
  console.log(`\nbySource:`, cache.stats().bySource);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
