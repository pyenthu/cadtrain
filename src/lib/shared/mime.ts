/**
 * MIME-type utilities shared across backends.
 */

export function guessImageExt(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  return '.bin';
}
