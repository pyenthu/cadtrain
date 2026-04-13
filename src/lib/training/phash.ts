/**
 * Perceptual hash (pHash) for image similarity search.
 *
 * Implementation:
 * 1. Resize to 32x32 grayscale
 * 2. Apply 2D Discrete Cosine Transform
 * 3. Take top-left 8x8 low frequencies
 * 4. Threshold against median → 64 bits → hex string
 *
 * Hamming distance between two pHashes gives perceptual similarity.
 */

import sharp from 'sharp';

const HASH_SIZE = 8;
const DCT_SIZE = 32;

/**
 * Compute perceptual hash from an image buffer.
 * Returns a 16-character hex string (64 bits).
 */
export async function computePHash(imageBuffer: Buffer): Promise<string> {
  // Decode, convert to grayscale, resize to DCT_SIZE x DCT_SIZE
  const { data } = await sharp(imageBuffer)
    .grayscale()
    .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert to float matrix
  const pixels: number[][] = [];
  for (let y = 0; y < DCT_SIZE; y++) {
    const row: number[] = [];
    for (let x = 0; x < DCT_SIZE; x++) {
      row.push(data[y * DCT_SIZE + x]);
    }
    pixels.push(row);
  }

  // 2D DCT (simple O(N^4) — fine for 32x32)
  const dct = computeDCT2D(pixels);

  // Extract top-left 8x8 (excluding DC term at [0][0])
  const freqs: number[] = [];
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      freqs.push(dct[y][x]);
    }
  }
  // Drop the DC term (brightness)
  const freqsAC = freqs.slice(1);

  // Median of AC coefficients
  const sorted = [...freqsAC].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Threshold — include DC as first bit
  let bits = '';
  bits += freqs[0] > median ? '1' : '0';
  for (const v of freqsAC) {
    bits += v > median ? '1' : '0';
  }

  // Convert to hex
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * 2D Discrete Cosine Transform (type II).
 */
function computeDCT2D(matrix: number[][]): number[][] {
  const N = matrix.length;
  const result: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

  // Precompute cosine tables
  const cos: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      cos[k][n] = Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N));
    }
  }

  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          sum += matrix[y][x] * cos[u][y] * cos[v][x];
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      result[u][v] = (cu * cv * sum * 2) / N;
    }
  }
  return result;
}

/**
 * Hamming distance between two hex-encoded pHashes.
 * Lower = more similar. Range: 0-64.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return 64;
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    const xor = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    // Count bits in xor
    let v = xor;
    while (v) {
      distance += v & 1;
      v >>= 1;
    }
  }
  return distance;
}

/**
 * Resize an image to a thumbnail and return as base64.
 */
export async function makeThumbnail(imageBuffer: Buffer, size: number = 256): Promise<string> {
  const resized = await sharp(imageBuffer)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return resized.toString('base64');
}
