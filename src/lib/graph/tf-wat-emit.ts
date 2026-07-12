/**
 * tf-wat-emit.ts — compile a TrueForm (TF) instruction RECIPE → an OPAQUE WASM
 * module (TODO #49, "thin concealment").
 *
 * WHAT THIS CONCEALS (be honest): the recipe DATA, not TF logic. Instead of
 * shipping the readable `TfRecipe` JSON (or the pretty `tfRecipeText`) down to
 * the browser, we emit a WebAssembly binary that CARRIES the recipe as a data
 * segment and hands it back at runtime. A casual "View Source" / network-tab
 * reader sees `application/wasm` bytes, not a legible instruction tree. It is
 * NOT encryption and NOT a logic rewrite — anyone who instantiates the module
 * (exactly as our own client decoder will) recovers the recipe verbatim. Thin,
 * by design and by the ticket's scope.
 *
 * ── WIRE FORMAT (v1) ─────────────────────────────────────────────────────────
 * The emitted module is a minimal, standalone WASM module (no imports) with:
 *   • an exported linear `memory`
 *   • a data segment at byte offset RECIPE_OFFSET holding `JSON.stringify(recipe)`
 *     encoded as UTF-8
 *   • three exported nullary i32 accessors:
 *       recipe_fmt() → format version (RECIPE_FMT = 1)
 *       recipe_ptr() → RECIPE_OFFSET (where the bytes start in `memory`)
 *       recipe_len() → the UTF-8 byte length of the encoded recipe
 *
 * DECODE (what the later client step does — kept trivial + reversible):
 *   const { instance } = await WebAssembly.instantiate(bytes, {});
 *   const e = instance.exports;
 *   const ptr = e.recipe_ptr(), len = e.recipe_len();
 *   const raw = new Uint8Array(e.memory.buffer, ptr, len);
 *   const recipe = JSON.parse(new TextDecoder().decode(raw));  // === original TfRecipe
 * `decodeRecipeWasm` below performs exactly this (also used by the round-trip test).
 *
 * TOOLCHAIN: pure-JS `wabt` (`wat2wasm`) — no Python, no native binaries (Rule 1).
 */

import type { TfRecipe, TfInstr } from '$lib/engines/trueform/graph-to-tf';

/** Recipe wire-format version carried in the module (recipe_fmt export). */
export const RECIPE_FMT = 1;
/** Byte offset of the recipe bytes inside the module's linear memory. We keep
 *  the first few bytes free so a future header could live below the payload. */
export const RECIPE_OFFSET = 16;
/** WASM linear-memory page size (64 KiB). */
const PAGE = 65536;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Encode arbitrary bytes as a WAT string-literal body using `\XX` hex escapes
 *  for every byte — the only encoding that is safe for quotes, backslashes and
 *  non-ASCII without any conditional escaping. */
function bytesToWatString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += '\\' + bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

/** Serialize a recipe to the UTF-8 bytes that get baked into the data segment.
 *  This is the exact byte-for-byte payload the decoder recovers. */
export function recipeToBytes(recipe: TfRecipe): Uint8Array {
  return enc.encode(JSON.stringify(recipe));
}

/**
 * Emit the WAT (text) module for a recipe. The recipe JSON is baked into a data
 * segment at RECIPE_OFFSET; memory is sized to hold it (≥1 page).
 */
export function recipeToWat(recipe: TfRecipe): string {
  const bytes = recipeToBytes(recipe);
  const pages = Math.max(1, Math.ceil((RECIPE_OFFSET + bytes.length) / PAGE));
  const dataLit = bytesToWatString(bytes);
  // A hand-written, deliberately tiny module. Nullary funcs return i32 consts.
  return `(module
  (memory (export "memory") ${pages})
  (data (i32.const ${RECIPE_OFFSET}) "${dataLit}")
  (func (export "recipe_fmt") (result i32) (i32.const ${RECIPE_FMT}))
  (func (export "recipe_ptr") (result i32) (i32.const ${RECIPE_OFFSET}))
  (func (export "recipe_len") (result i32) (i32.const ${bytes.length}))
)
`;
}

// ── WAT → WASM via wabt (lazy, cached) ───────────────────────────────────────

// wabt initialises a WASM module itself; do it once and reuse.
let _wabtPromise: Promise<any> | null = null;
async function getWabt(): Promise<any> {
  if (!_wabtPromise) {
    // wabt is CJS (`export = wabt`), default-imported under our ESM/bundler.
    const mod: any = await import('wabt');
    const factory = mod.default ?? mod;
    _wabtPromise = factory();
  }
  return _wabtPromise;
}

/** Assemble WAT text → WASM binary bytes (via wabt's wat2wasm). Async because
 *  wabt itself is a WASM module that must initialise first. */
export async function watToWasm(wat: string): Promise<Uint8Array> {
  const wabt = await getWabt();
  const parsed = wabt.parseWat('tf-recipe.wat', wat, {});
  try {
    const { buffer } = parsed.toBinary({ log: false, canonicalize_lebs: true });
    // Copy out of wabt's internal buffer into a plain, detached Uint8Array.
    return Uint8Array.from(buffer);
  } finally {
    parsed.destroy();
  }
}

/** Convenience: recipe → opaque WASM bytes in one call. */
export async function recipeToWasm(recipe: TfRecipe): Promise<Uint8Array> {
  return watToWasm(recipeToWat(recipe));
}

// ── decode (the inverse — for the round-trip test + the later client step) ────

/** Instantiate a recipe-WASM module and recover the original recipe. This is
 *  the reference decoder the browser client will mirror. */
export async function decodeRecipeWasm(bytes: BufferSource): Promise<TfRecipe> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const e = instance.exports as {
    memory: WebAssembly.Memory;
    recipe_fmt: () => number;
    recipe_ptr: () => number;
    recipe_len: () => number;
  };
  const fmt = e.recipe_fmt();
  if (fmt !== RECIPE_FMT) {
    throw new Error(`tf-wat-emit: unknown recipe format ${fmt} (expected ${RECIPE_FMT})`);
  }
  const ptr = e.recipe_ptr();
  const len = e.recipe_len();
  const raw = new Uint8Array(e.memory.buffer, ptr, len);
  return JSON.parse(dec.decode(raw)) as TfRecipe;
}

/** Count the ops in a recipe tree (for the endpoint header — coverage metric). */
export function recipeOpCount(recipe: TfRecipe): number {
  let n = 0;
  const walk = (inst: TfInstr) => {
    n++;
    switch (inst.op) {
      case 'booleanDifference':
      case 'booleanUnion':
      case 'booleanIntersection':
        walk(inst.obj);
        walk(inst.arg);
        break;
      case 'union':
        inst.children.forEach(walk);
        break;
      case 'translate':
      case 'rotate':
      case 'repeat':
        walk(inst.child);
        break;
      default:
        break;
    }
  };
  recipe.instrs.forEach(walk);
  return n;
}
