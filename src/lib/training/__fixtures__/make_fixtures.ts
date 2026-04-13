/**
 * Generate test fixture images for the unit tests.
 * Run once with `bun run src/lib/training/__fixtures__/make_fixtures.ts`
 */

import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dir;

async function makeSolid(name: string, r: number, g: number, b: number) {
  const buf = await sharp({
    create: { width: 50, height: 50, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  writeFileSync(join(DIR, name), buf);
}

async function makeCheckerboard(name: string) {
  // 50x50 checkerboard, 5x5 cells
  const raw = Buffer.alloc(50 * 50 * 3);
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      const cell = (Math.floor(x / 5) + Math.floor(y / 5)) % 2;
      const v = cell === 0 ? 0 : 255;
      const idx = (y * 50 + x) * 3;
      raw[idx] = v;
      raw[idx + 1] = v;
      raw[idx + 2] = v;
    }
  }
  const buf = await sharp(raw, { raw: { width: 50, height: 50, channels: 3 } })
    .png()
    .toBuffer();
  writeFileSync(join(DIR, name), buf);
}

await makeSolid('black.png', 0, 0, 0);
await makeSolid('white.png', 255, 255, 255);
await makeCheckerboard('checker.png');

console.log('Fixtures written to', DIR);
