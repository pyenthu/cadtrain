#!/usr/bin/env node
/**
 * Visual walk-through of /tests/components — captures hero screenshot
 * (initial view), then steps through every case in the navigator and
 * screenshots each. Records a WEBM of the whole run.
 *
 * Mirrors the SVTC pattern (start-maximized + viewport:null in headed
 * mode, fixed 1920×1080 headless) so the bottom-right of the page
 * doesn't get cut off on a 4K display.
 *
 * Run:
 *   node tests/visual_components_eval.mjs              # headed (browser pops up)
 *   HEADLESS=1 node tests/visual_components_eval.mjs   # headless / CI
 *
 * Output:
 *   tests/results/components_eval/00-hero.png
 *   tests/results/components_eval/<NN>-<dirname>.png
 *   tests/results/components_eval/_video/*.webm
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.CADTRAIN_URL ?? 'http://localhost:5174';
const OUT  = resolve('tests/results/components_eval');
const VID  = resolve(OUT, '_video');

// Clean prior run so the gallery isn't a mix of old + new shots.
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(VID, { recursive: true });

console.log('🎬 Components eval visual walk-through');
console.log(`   target: ${BASE}/tests/components`);
console.log('');

const isHeaded = process.env.HEADLESS !== '1';
const browser = await chromium.launch({
  headless: !isHeaded,
  slowMo: isHeaded ? 250 : 0,
  args: isHeaded ? ['--start-maximized'] : ['--window-size=1920,1080'],
});
const ctx = await browser.newContext({
  viewport: isHeaded ? null : { width: 1920, height: 1080 },
  recordVideo: { dir: VID, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`   ⚠️  ${e.message}`));

async function step(label, ms = 600) {
  console.log(`▸ ${label}`);
  await page.waitForTimeout(ms);
}

await step('1/3 Loading /tests/components', 500);
await page.goto(`${BASE}/tests/components`);
await page.waitForSelector('aside.navigator .nav-item', { timeout: 15000 });

await step('   Hero screenshot — accuracy + first case', 800);
await page.screenshot({ path: resolve(OUT, '00-hero.png'), fullPage: false });
console.log(`   📸 00-hero.png`);

// Pull case list from the navigator (the live DOM is the source of truth).
const cases = await page.$$eval('aside.navigator .nav-item', (els) =>
  els.map((el) => ({
    expected: el.querySelector('.nav-title')?.textContent?.trim() ?? '?',
    sub: el.querySelector('.nav-sub')?.textContent?.trim() ?? '?',
    isCorrect: !!el.querySelector('.status-dot.pass'),
  })),
);
console.log(`   found ${cases.length} cases in navigator`);

await step(`2/3 Clicking through ${cases.length} cases`, 0);
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  // Click the nth nav item by index
  const items = await page.$$('aside.navigator .nav-item');
  await items[i].click();
  await page.waitForTimeout(700); // let the diff pane render
  // Wait for the source image to load (each case swaps the <img>)
  await page
    .waitForFunction(
      () => {
        const img = document.querySelector('.src-frame img');
        return img && img.complete && img.naturalWidth > 0;
      },
      { timeout: 5000 },
    )
    .catch(() => {});
  const idx = String(i + 1).padStart(2, '0');
  const marker = c.isCorrect ? '✓' : '✗';
  const safe = c.expected.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fname = `${idx}-${marker === '✓' ? 'OK' : 'MISS'}-${safe}.png`;
  await page.screenshot({ path: resolve(OUT, fname), fullPage: false });
  console.log(`   ${marker} ${fname}  (expected: ${c.expected})`);
}

await step('3/3 Final hero — back at first case', 600);
const items = await page.$$('aside.navigator .nav-item');
await items[0].click();
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(OUT, '99-final.png'), fullPage: false });

console.log('');
console.log('✅ Done.');
console.log(`   Screenshots: ${OUT}`);
console.log(`   Video: ${VID}/*.webm`);

await ctx.close();
await browser.close();
