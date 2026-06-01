/**
 * Side-effect-only module: must be imported BEFORE @xenova/transformers.
 *
 * Bun exposes `globalThis.self` (Web standards compatibility) but does NOT
 * implement the browser image APIs (createImageBitmap, OffscreenCanvas).
 * @xenova/transformers detects "browser environment" via
 *   const BROWSER_ENV = typeof self !== 'undefined'
 * and then crashes in image.js because the canvas helpers it expects are
 * undefined.
 *
 * We delete the `self` global iff:
 *   - it's defined (so we are in a runtime that exposes it: Bun, browser)
 *   - and `createImageBitmap` is missing (so we're NOT in a real browser)
 *
 * That makes transformers take its Node path, which uses sharp.
 *
 * Real browsers keep `self` and `createImageBitmap`, so they're untouched.
 * Plain Node never had `self`, so the condition is also a no-op.
 */
if (
  typeof (globalThis as { self?: unknown }).self !== 'undefined' &&
  typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap === 'undefined'
) {
  delete (globalThis as { self?: unknown }).self;
}
