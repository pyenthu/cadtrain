/**
 * seed-well-samples.ts — populate the on-volume WSON sample store from the
 * git-tracked seed set (`src/lib/wells/samples/*.wson`).
 *
 * The `/api/wells/samples` endpoint ALSO seeds itself on first read
 * (`seedIfEmpty`), so this script is only needed to (a) force a re-push after
 * editing the bundled `.wson` seeds, or (b) explicitly initialise a fresh
 * volume without hitting the UI. It POSTs each bundled file to the single live
 * store (Rule 13), mirroring `scripts/build_g_parts.ts`.
 *
 * Usage:
 *   bun scripts/seed-well-samples.ts                 # → prod (default)
 *   CADTRAIN_VOLUME_REMOTE_URL=http://localhost:3333 \
 *   bun scripts/seed-well-samples.ts                 # → a local dev server
 *
 * Env:
 *   CADTRAIN_VOLUME_REMOTE_URL  target base URL (default prod)
 *   CADTRAIN_VOLUME_TOKEN       X-Volume-Token for cross-origin auth
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = process.env.CADTRAIN_VOLUME_REMOTE_URL || 'https://cadtrain.up.railway.app';
const TOKEN = process.env.CADTRAIN_VOLUME_TOKEN || '';
const SEED_DIR = resolve(process.cwd(), 'src/lib/wells/samples');

async function main() {
  const names = (await readdir(SEED_DIR)).filter((n) => /\.wson$/i.test(n)).sort();
  if (names.length === 0) {
    console.error(`No .wson seed files in ${SEED_DIR}`);
    process.exit(1);
  }
  console.log(`Seeding ${names.length} well sample(s) → ${BASE}/api/wells/samples`);

  let ok = 0;
  let fail = 0;
  for (const name of names) {
    const text = await readFile(join(SEED_DIR, name), 'utf8');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['X-Volume-Token'] = TOKEN;
    try {
      const res = await fetch(`${BASE}/api/wells/samples`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, text }),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { size?: number };
        console.log(`  ✓ ${name} (${body?.size ?? text.length} bytes)`);
        ok++;
      } else {
        console.error(`  ✗ ${name} → HTTP ${res.status} ${await res.text().catch(() => '')}`);
        fail++;
      }
    } catch (e) {
      console.error(`  ✗ ${name} → ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`Done: ${ok} ok, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
