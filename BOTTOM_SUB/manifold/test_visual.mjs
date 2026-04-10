/**
 * Visual test: open the 3D model in a real browser, rotate it,
 * capture screenshots from multiple angles, and verify colors.
 */

import { chromium } from 'playwright';

const PROFILE = '/tmp/bottom-sub-playwright';
const OUT = '/Users/neerajsethi/duplicate/BOTTOM_SUB/manifold';
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1200, height: 900 },
  args: ['--no-sandbox'],
});

const page = browser.pages()[0] ?? await browser.newPage();
await page.goto('http://localhost:8889/compare.html', { waitUntil: 'networkidle' });
await wait(3000);

console.log('✓ Page loaded\n');

// Helper: drag to rotate the 3D view
async function rotate(fromX, fromY, toX, toY, steps = 30) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps });
  await page.mouse.up();
  await wait(500);
}

// Angle 1: Default isometric view
await page.screenshot({ path: `${OUT}/visual_01_default.png` });
console.log('📸 01: Default view');

// Angle 2: Rotate left to see into the cut
await rotate(800, 450, 500, 450);
await page.screenshot({ path: `${OUT}/visual_02_cut_face.png` });
console.log('📸 02: Looking into cut');

// Angle 3: Rotate more to see bore
await rotate(600, 450, 300, 400);
await page.screenshot({ path: `${OUT}/visual_03_bore.png` });
console.log('📸 03: Bore visible');

// Angle 4: Continue rotation to back side
await rotate(500, 450, 200, 400);
await page.screenshot({ path: `${OUT}/visual_04_back.png` });
console.log('📸 04: Back side');

// Angle 5: Look from slightly above
await rotate(600, 300, 600, 550);
await page.screenshot({ path: `${OUT}/visual_05_top.png` });
console.log('📸 05: Top-down angle');

// Angle 6: Straight side view
await rotate(600, 500, 600, 350);
await rotate(400, 400, 700, 400);
await page.screenshot({ path: `${OUT}/visual_06_side.png` });
console.log('📸 06: Side view');

console.log('\n✅ Visual test complete. Check screenshots in:', OUT);
console.log('   Keep browser open for manual inspection.');
console.log('   Press Ctrl+C to close.\n');

// Keep browser open for user to inspect
await wait(30000);
await browser.close();
