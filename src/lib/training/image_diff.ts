/**
 * Pure TypeScript image comparison — SSIM, pixel diff, edge diff.
 *
 * Replaces the Python cv2/skimage subprocess previously used by /api/refine.
 */

import sharp from 'sharp';

export interface DiffScores {
  ssim: number;           // structural similarity 0-1 (1 = identical)
  pixel_diff_pct: number; // % pixels differing by more than threshold
  edge_diff_pct: number;  // % edge pixels differing
  shape_match: number;    // placeholder (0 = not computed)
}

const W = 256;
const H = 256;
const PIXEL_DIFF_THRESHOLD = 30;
const EDGE_DIFF_THRESHOLD = 30;

/**
 * Compare two image buffers, return similarity scores.
 */
export async function compareImages(
  origBuffer: Buffer,
  rendBuffer: Buffer
): Promise<DiffScores> {
  // Resize to common size and convert to grayscale
  const orig = await sharp(origBuffer)
    .grayscale()
    .resize(W, H, { fit: 'fill' })
    .raw()
    .toBuffer();

  const rend = await sharp(rendBuffer)
    .grayscale()
    .resize(W, H, { fit: 'fill' })
    .raw()
    .toBuffer();

  // Pixel diff
  let pixelDiffCount = 0;
  for (let i = 0; i < orig.length; i++) {
    if (Math.abs(orig[i] - rend[i]) > PIXEL_DIFF_THRESHOLD) pixelDiffCount++;
  }
  const pixel_diff_pct = (pixelDiffCount / orig.length) * 100;

  // SSIM
  const ssim = computeSSIM(orig, rend, W, H);

  // Edge diff (Sobel)
  const origEdges = sobelEdges(orig, W, H);
  const rendEdges = sobelEdges(rend, W, H);
  let edgeDiffCount = 0;
  for (let i = 0; i < origEdges.length; i++) {
    if (Math.abs(origEdges[i] - rendEdges[i]) > EDGE_DIFF_THRESHOLD) edgeDiffCount++;
  }
  const edge_diff_pct = (edgeDiffCount / origEdges.length) * 100;

  return {
    ssim: Math.round(ssim * 10000) / 10000,
    pixel_diff_pct: Math.round(pixel_diff_pct * 100) / 100,
    edge_diff_pct: Math.round(edge_diff_pct * 100) / 100,
    shape_match: 0,
  };
}

/**
 * Structural Similarity Index (SSIM) with 8x8 non-overlapping windows.
 * Simplified version — mean over blocks rather than sliding window.
 * Fast enough for 256x256 and accurate for our refinement loop.
 */
function computeSSIM(a: Buffer, b: Buffer, w: number, h: number): number {
  const BLOCK = 8;
  const L = 255;
  const K1 = 0.01;
  const K2 = 0.03;
  const C1 = (K1 * L) ** 2;
  const C2 = (K2 * L) ** 2;

  let totalSSIM = 0;
  let blockCount = 0;

  for (let by = 0; by + BLOCK <= h; by += BLOCK) {
    for (let bx = 0; bx + BLOCK <= w; bx += BLOCK) {
      // Compute means
      let meanA = 0;
      let meanB = 0;
      for (let y = 0; y < BLOCK; y++) {
        for (let x = 0; x < BLOCK; x++) {
          const idx = (by + y) * w + (bx + x);
          meanA += a[idx];
          meanB += b[idx];
        }
      }
      const N = BLOCK * BLOCK;
      meanA /= N;
      meanB /= N;

      // Variance + covariance
      let varA = 0;
      let varB = 0;
      let cov = 0;
      for (let y = 0; y < BLOCK; y++) {
        for (let x = 0; x < BLOCK; x++) {
          const idx = (by + y) * w + (bx + x);
          const dA = a[idx] - meanA;
          const dB = b[idx] - meanB;
          varA += dA * dA;
          varB += dB * dB;
          cov += dA * dB;
        }
      }
      varA /= N;
      varB /= N;
      cov /= N;

      // SSIM for this block
      const num = (2 * meanA * meanB + C1) * (2 * cov + C2);
      const den = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);
      totalSSIM += num / den;
      blockCount++;
    }
  }

  return blockCount > 0 ? totalSSIM / blockCount : 0;
}

/**
 * Sobel edge detection — returns gradient magnitude per pixel.
 */
function sobelEdges(pixels: Buffer, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);

  // Sobel kernels
  //  Gx:        Gy:
  // -1 0 1    -1 -2 -1
  // -2 0 2     0  0  0
  // -1 0 1     1  2  1

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;

      const tl = pixels[i - w - 1];
      const tc = pixels[i - w];
      const tr = pixels[i - w + 1];
      const ml = pixels[i - 1];
      const mr = pixels[i + 1];
      const bl = pixels[i + w - 1];
      const bc = pixels[i + w];
      const br = pixels[i + w + 1];

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      const mag = Math.sqrt(gx * gx + gy * gy);
      out[i] = Math.min(255, Math.floor(mag));
    }
  }

  return out;
}
