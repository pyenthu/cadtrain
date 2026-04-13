import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computePHash, hammingDistance, makeThumbnail } from './phash';

const FIXTURES = join(import.meta.dirname, '__fixtures__');

let blackBuf: Buffer;
let whiteBuf: Buffer;
let checkerBuf: Buffer;

beforeAll(() => {
  blackBuf = readFileSync(join(FIXTURES, 'black.png'));
  whiteBuf = readFileSync(join(FIXTURES, 'white.png'));
  checkerBuf = readFileSync(join(FIXTURES, 'checker.png'));
});

describe('computePHash', () => {
  it('produces a 16-char hex string', async () => {
    const hash = await computePHash(blackBuf);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic — same image → same hash', async () => {
    const h1 = await computePHash(blackBuf);
    const h2 = await computePHash(blackBuf);
    expect(h1).toBe(h2);
  });

  it('distinguishes flat images from textured ones', async () => {
    const flatHash = await computePHash(blackBuf);
    const checkerHash = await computePHash(checkerBuf);
    expect(flatHash).not.toBe(checkerHash);
    expect(hammingDistance(flatHash, checkerHash)).toBeGreaterThan(5);
  });
});

describe('hammingDistance', () => {
  it('is 0 for identical hashes', () => {
    expect(hammingDistance('abcdef0123456789', 'abcdef0123456789')).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'ffff000000000000';
    const b = '0000ffff00000000';
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it('counts set bits correctly', () => {
    // 0xff (11111111) vs 0x00 (00000000) = 8 bits diff
    expect(hammingDistance('ff00000000000000', '0000000000000000')).toBe(8);
  });

  it('returns 64 for mismatched-length hashes', () => {
    expect(hammingDistance('ff', 'ff00')).toBe(64);
  });
});

describe('makeThumbnail', () => {
  it('returns a base64 PNG string', async () => {
    const thumb = await makeThumbnail(whiteBuf, 32);
    expect(typeof thumb).toBe('string');
    expect(thumb.length).toBeGreaterThan(0);
    // base64 decodes to a valid PNG header
    const decoded = Buffer.from(thumb, 'base64');
    expect(decoded.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
