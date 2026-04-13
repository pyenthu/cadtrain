import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { compareImages } from './image_diff';

const FIXTURES = join(import.meta.dirname, '__fixtures__');

let blackBuf: Buffer;
let whiteBuf: Buffer;
let checkerBuf: Buffer;

beforeAll(() => {
  blackBuf = readFileSync(join(FIXTURES, 'black.png'));
  whiteBuf = readFileSync(join(FIXTURES, 'white.png'));
  checkerBuf = readFileSync(join(FIXTURES, 'checker.png'));
});

describe('compareImages', () => {
  it('returns SSIM = 1 (or very close) for identical images', async () => {
    const scores = await compareImages(blackBuf, blackBuf);
    expect(scores.ssim).toBeGreaterThanOrEqual(0.99);
    expect(scores.pixel_diff_pct).toBe(0);
    expect(scores.edge_diff_pct).toBe(0);
  });

  it('returns low SSIM for black vs white (opposite extremes)', async () => {
    const scores = await compareImages(blackBuf, whiteBuf);
    expect(scores.ssim).toBeLessThan(0.1);
    expect(scores.pixel_diff_pct).toBeGreaterThan(90);
  });

  it('detects edges in checkerboard vs flat black', async () => {
    const scores = await compareImages(blackBuf, checkerBuf);
    // Checker has many edges, black has none → large edge diff
    expect(scores.edge_diff_pct).toBeGreaterThan(1);
    expect(scores.ssim).toBeLessThan(0.9);
  });

  it('returns all 4 score fields in valid ranges', async () => {
    const scores = await compareImages(whiteBuf, checkerBuf);
    expect(scores.ssim).toBeGreaterThanOrEqual(0);
    expect(scores.ssim).toBeLessThanOrEqual(1);
    expect(scores.pixel_diff_pct).toBeGreaterThanOrEqual(0);
    expect(scores.pixel_diff_pct).toBeLessThanOrEqual(100);
    expect(scores.edge_diff_pct).toBeGreaterThanOrEqual(0);
    expect(scores.edge_diff_pct).toBeLessThanOrEqual(100);
    expect(scores.shape_match).toBeGreaterThanOrEqual(0);
  });
});
