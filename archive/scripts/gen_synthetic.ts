/**
 * scripts/gen_synthetic.ts
 * ─────────────────────────────────────────────────────────────────
 * Synthetic training data generator for cadtrain.
 *
 * Drives /components via Playwright, rendering each primitive across a
 * sweep of parameter combinations × camera angles × scan styles. Outputs
 * labelled samples ready to seed cache.jsonl alongside the existing
 * prim_<id> records.
 *
 * Why Playwright: ManifoldCAD is WASM and ssr=false, so geometry must
 * render in a browser. We reuse the existing /components viewer instead
 * of duplicating the render pipeline.
 *
 * Run (dev server must be running on $GEN_APP_URL, default :3333):
 *   bun run dev                                       # terminal A
 *   bun run scripts/gen_synthetic.ts --priority --max 5   # terminal B
 *   bun run scripts/gen_synthetic.ts --primitive packer_element
 *   bun run scripts/gen_synthetic.ts --all
 *
 * Output:
 *   training_data/synthetic/<primitive>/samples/<id>.png
 *   training_data/synthetic/<primitive>/samples/<id>.json
 *   training_data/synthetic/<primitive>/manifest.json
 *   training_data/synthetic_cache.jsonl   (separate from cache.jsonl;
 *                                          merge later via a seed flag)
 */

import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { computePHash } from '../src/lib/training/phash';

// ─── Config ──────────────────────────────────────────────────────────

const APP_URL = process.env.GEN_APP_URL ?? 'http://localhost:3333';
const OUTPUT_ROOT = 'training_data/synthetic';
const SYNTH_CACHE = 'training_data/synthetic_cache.jsonl';
const VIEWER_PATH = '/components';
const RENDER_WAIT_MS = 1200;
const CANVAS_SELECTOR = 'canvas';

// The four primitives flagged in CLAUDE.md (2026-04-13) for pHash collision.
const PRIORITY_PRIMITIVES = [
  'seal_bore_polished',
  'packer_element',
  'nc_numbered_connection',
  'grooved_cylinder',
];

// ─── Types ───────────────────────────────────────────────────────────

interface ParamRange {
  min?: number;
  max?: number;
  steps?: number;
  values?: (string | number)[];
}

interface PrimitiveSweepConfig {
  id: string;
  paramRanges: Record<string, ParamRange>;
  cameraAngles?: CameraAngle[];
}

interface CameraAngle {
  name: string;
  position: [number, number, number];
  up?: [number, number, number];
}

interface RenderStyle {
  name: string;
  apply: (img: sharp.Sharp) => Promise<sharp.Sharp> | sharp.Sharp;
}

interface SyntheticRecord {
  id: string;
  hash: string;
  component_id: string;
  params: Record<string, number | string>;
  image_b64: string;
  source: 'synthetic';
  generation: { style: string; angle: string; sample_index: number };
  uses: 0;
  accepted: 0;
  wrong_match: 0;
  version: 2;
  created: string;
}

// ─── Camera angles ────────────────────────────────────────────────────
// Goal: distinct silhouettes for the four collision primitives.

const DEFAULT_ANGLES: CameraAngle[] = [
  { name: 'front', position: [6, 0, 0], up: [0, 0, -1] },
  { name: 'iso_top_right', position: [4, 4, -2], up: [0, 0, -1] },
  { name: 'iso_top_left', position: [-4, 4, -2], up: [0, 0, -1] },
  { name: 'three_quarter', position: [5, 2, -1], up: [0, 0, -1] },
  { name: 'side_offset', position: [6, 1.5, 0], up: [0, 0, -1] },
];

// ─── Render style library ────────────────────────────────────────────

const RENDER_STYLES: RenderStyle[] = [
  {
    name: 'clean_cad',
    apply: (img) => img,
  },
  {
    name: 'printed_scan',
    apply: (img) => img.gamma(1.1).modulate({ brightness: 0.95 }).sharpen(),
  },
  {
    name: 'faded_scan',
    apply: (img) => img.modulate({ brightness: 1.08, saturation: 0.5 }).linear(0.7, 30).blur(0.5),
  },
  {
    name: 'photocopy_3rd_gen',
    apply: (img) =>
      img.grayscale().linear(0.45, 50).blur(1.0).threshold(150, { greyscale: false }),
  },
  {
    name: 'noisy_scan',
    apply: async (img) => {
      const buf = await img.png().toBuffer();
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 512;
      const h = meta.height ?? 512;
      const noise = randomBytes(w * h * 4);
      const noiseSharp = sharp(noise, { raw: { width: w, height: h, channels: 4 } })
        .resize(w, h)
        .modulate({ brightness: 1, saturation: 0 });
      return sharp(buf)
        .composite([{ input: await noiseSharp.png().toBuffer(), blend: 'overlay', opacity: 0.08 }])
        .blur(0.4);
    },
  },
  {
    name: 'rotated_slight',
    apply: (img) => img.rotate(rand(-3, 3), { background: '#ffffff' }),
  },
  {
    name: 'blueprint',
    apply: (img) => img.grayscale().negate().tint({ r: 30, g: 100, b: 200 }),
  },
];

// ─── Sweep generation ────────────────────────────────────────────────

function expandSweep(
  ranges: Record<string, ParamRange>,
  maxSamples: number,
): Record<string, number | string>[] {
  const lists: Record<string, (number | string)[]> = {};
  for (const [key, r] of Object.entries(ranges)) {
    if (r.values) {
      lists[key] = r.values;
    } else if (r.min !== undefined && r.max !== undefined) {
      const steps = r.steps ?? 4;
      const span = r.max - r.min;
      lists[key] = Array.from(
        { length: steps },
        (_, i) => r.min! + (span * i) / Math.max(1, steps - 1),
      );
    } else {
      lists[key] = [];
    }
  }

  const keys = Object.keys(lists);
  const all: Record<string, number | string>[] = [];
  function recurse(idx: number, acc: Record<string, number | string>) {
    if (idx === keys.length) {
      all.push({ ...acc });
      return;
    }
    for (const v of lists[keys[idx]]) {
      acc[keys[idx]] = v;
      recurse(idx + 1, acc);
    }
  }
  recurse(0, {});

  if (all.length <= maxSamples) return all;
  const sampled: Record<string, number | string>[] = [];
  const used = new Set<number>();
  while (sampled.length < maxSamples) {
    const i = Math.floor(Math.random() * all.length);
    if (!used.has(i)) {
      used.add(i);
      sampled.push(all[i]);
    }
  }
  return sampled;
}

// ─── Sweep config (drop scripts/sweep_config.json to override) ───────

const FALLBACK_CONFIG: Record<string, PrimitiveSweepConfig> = {
  packer_element: {
    id: 'packer_element',
    paramRanges: {
      length: { min: 0.8, max: 2.5, steps: 5 },
      od: { min: 3.5, max: 7.0, steps: 4 },
      element_count: { values: [1, 2, 3] },
      profile: { values: ['barrel', 'stepped', 'tapered'] },
    },
  },
  seal_bore_polished: {
    id: 'seal_bore_polished',
    paramRanges: {
      length: { min: 0.5, max: 2.0, steps: 4 },
      bore_id: { min: 2.0, max: 5.5, steps: 4 },
      od: { min: 3.5, max: 7.0, steps: 3 },
    },
  },
  nc_numbered_connection: {
    id: 'nc_numbered_connection',
    paramRanges: {
      thread_size: { values: ['NC26', 'NC31', 'NC38', 'NC46', 'NC50'] },
      length: { min: 0.5, max: 1.5, steps: 3 },
      pin_or_box: { values: ['pin', 'box'] },
    },
  },
  grooved_cylinder: {
    id: 'grooved_cylinder',
    paramRanges: {
      length: { min: 1.0, max: 3.0, steps: 4 },
      od: { min: 3.5, max: 6.0, steps: 3 },
      groove_count: { values: [2, 3, 4, 6, 8] },
      groove_depth: { min: 0.05, max: 0.2, steps: 3 },
    },
  },
};

async function loadSweepConfig(): Promise<Record<string, PrimitiveSweepConfig>> {
  const path = 'scripts/sweep_config.json';
  if (existsSync(path)) {
    const text = await readFile(path, 'utf-8');
    return JSON.parse(text);
  }
  return FALLBACK_CONFIG;
}

// ─── Browser driver ──────────────────────────────────────────────────

async function captureRender(
  page: Page,
  primitive: string,
  params: Record<string, number | string>,
  angle: CameraAngle,
): Promise<Buffer> {
  const search = new URLSearchParams({
    id: primitive,
    p: JSON.stringify(params),
    cam: JSON.stringify({ position: angle.position, up: angle.up ?? [0, 0, -1] }),
  });
  await page.goto(`${APP_URL}${VIEWER_PATH}?${search.toString()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(CANVAS_SELECTOR, { timeout: 10_000 });
  await page.waitForTimeout(RENDER_WAIT_MS);
  return await page.locator(CANVAS_SELECTOR).first().screenshot({ type: 'png' });
}

// ─── Atomic JSONL append (matches CLAUDE.md rule 4) ──────────────────

async function atomicAppend(path: string, line: string) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  let existing = '';
  if (existsSync(path)) existing = await readFile(path, 'utf-8');
  await writeFile(tmp, existing + line + '\n');
  await rename(tmp, path);
}

// ─── Generation loop ──────────────────────────────────────────────────

async function generateForPrimitive(page: Page, cfg: PrimitiveSweepConfig, maxSamples: number) {
  const angles = cfg.cameraAngles ?? DEFAULT_ANGLES;
  const sweep = expandSweep(cfg.paramRanges, maxSamples);
  const outDir = join(OUTPUT_ROOT, cfg.id, 'samples');
  await mkdir(outDir, { recursive: true });

  const manifest: any[] = [];
  let sampleIndex = 0;

  for (const params of sweep) {
    for (const angle of angles) {
      let baseBuf: Buffer;
      try {
        baseBuf = await captureRender(page, cfg.id, params, angle);
      } catch (e) {
        console.warn(`  ⚠  capture failed for ${cfg.id}/${angle.name}: ${(e as Error).message}`);
        continue;
      }

      for (const style of RENDER_STYLES) {
        sampleIndex++;
        const styled = await Promise.resolve(style.apply(sharp(baseBuf)));
        const finalBuf = await (styled instanceof Promise ? styled : Promise.resolve(styled)).then(
          (s) => (s as sharp.Sharp).png().toBuffer(),
        );

        const id = sampleId(cfg.id, params, angle.name, style.name);

        await writeFile(join(outDir, `${id}.png`), finalBuf);

        const thumb = await sharp(finalBuf)
          .resize(256, 256, { fit: 'contain', background: '#ffffff' })
          .png()
          .toBuffer();
        const thumb_b64 = thumb.toString('base64');

        const phash = await computePHash(finalBuf);

        const labels = {
          id,
          component_id: cfg.id,
          params,
          camera_angle: angle.name,
          render_style: style.name,
          phash,
        };
        await writeFile(join(outDir, `${id}.json`), JSON.stringify(labels, null, 2));
        manifest.push(labels);

        const record: SyntheticRecord = {
          id,
          hash: phash,
          component_id: cfg.id,
          params,
          image_b64: thumb_b64,
          source: 'synthetic',
          generation: { style: style.name, angle: angle.name, sample_index: sampleIndex },
          uses: 0,
          accepted: 0,
          wrong_match: 0,
          version: 2,
          created: new Date().toISOString(),
        };
        await atomicAppend(SYNTH_CACHE, JSON.stringify(record));

        process.stdout.write(`  [${sampleIndex}] ${cfg.id} · ${angle.name} · ${style.name}\r`);
      }
    }
  }

  await writeFile(
    join(OUTPUT_ROOT, cfg.id, 'manifest.json'),
    JSON.stringify({ primitive: cfg.id, count: manifest.length, samples: manifest }, null, 2),
  );

  console.log(`\n  ✔  ${cfg.id}: ${sampleIndex} samples written`);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function sampleId(
  primitive: string,
  params: Record<string, number | string>,
  angle: string,
  style: string,
): string {
  const payload = JSON.stringify({ primitive, params, angle, style });
  const hash = createHash('sha1').update(payload).digest('hex').slice(0, 12);
  return `${primitive}_${angle}_${style}_${hash}`;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

// ─── CLI ──────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      primitive: { type: 'string' },
      all: { type: 'boolean' },
      priority: { type: 'boolean' },
      max: { type: 'string', default: '120' },
      headed: { type: 'boolean' },
    },
  });

  const cfg = await loadSweepConfig();
  const maxSamples = parseInt(values.max ?? '120', 10);

  let targets: string[];
  if (values.all) targets = Object.keys(cfg);
  else if (values.priority) targets = PRIORITY_PRIMITIVES.filter((p) => cfg[p]);
  else if (values.primitive) targets = [values.primitive];
  else {
    console.error('pass --primitive <id> | --priority | --all');
    process.exit(1);
  }

  console.log(`\n📦  Synthetic generator`);
  console.log(`    App URL : ${APP_URL}`);
  console.log(`    Targets : ${targets.join(', ')}`);
  console.log(`    Max     : ${maxSamples} param combos per primitive`);
  console.log(`    Angles  : ${DEFAULT_ANGLES.length}`);
  console.log(`    Styles  : ${RENDER_STYLES.length}\n`);

  const browser: Browser = await chromium.launch({ headless: !values.headed });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  try {
    for (const id of targets) {
      if (!cfg[id]) {
        console.warn(`  ⚠   no sweep config for ${id} — skipping`);
        continue;
      }
      console.log(`▶  ${id}`);
      await generateForPrimitive(page, cfg[id], maxSamples);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n✅  Done. Output:`);
  console.log(`    ${OUTPUT_ROOT}/<primitive>/samples/`);
  console.log(`    ${SYNTH_CACHE}\n`);
  console.log(`Next: bun run scripts/migrate_to_clip.ts --file ${SYNTH_CACHE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
