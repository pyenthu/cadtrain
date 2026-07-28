import { describe, it, expect } from 'vitest';
import {
  recipeToWat,
  recipeToWasm,
  recipeToBytes,
  decodeRecipeWasm,
  recipeOpCount,
  RECIPE_FMT,
  RECIPE_OFFSET,
} from '$lib/graph/expr/tf-wat-emit';
import { graphToTf, type TfRecipe } from '$lib/engines/trueform/graph-to-tf';

/**
 * tf-wat-emit (TODO #49) — proves a TF recipe survives a round-trip through the
 * OPAQUE WASM module: recipe → recipeToWasm → WebAssembly.instantiate (in Node,
 * as the browser will) → decode → deep-equals the original. Also asserts the
 * emitted binary VALIDATES, and reports the byte-size vs JSON tradeoff (the
 * concealment cost).
 */

// A small hand-built recipe: a revolve MINUS a cylinder (a subtract) — exactly
// the "revolve + a subtract" shape the ticket asks the test to exercise. Also
// nests a translate so the recursive op-count + tree encoding are covered.
const sampleRecipe: TfRecipe = {
  id: 'test_bored_flange',
  instrs: [
    {
      op: 'booleanDifference',
      obj: {
        op: 'revolve',
        segments: 64,
        profile: [
          [0, 0],
          [2.5, 0],
          [2.5, 1.25],
          [0, 1.25],
        ],
      },
      arg: {
        op: 'translate',
        offset: [0, 0, -0.5],
        child: { op: 'cylinder', radius: 1, height: 2.25, segments: 64 },
      },
    },
  ],
  notes: ['sample: fillet approximated as a sharp corner (v0)'],
};

describe('tf-wat-emit — recipe → opaque WASM round-trip', () => {
  it('emits WAT that carries the recipe bytes at RECIPE_OFFSET', () => {
    const wat = recipeToWat(sampleRecipe);
    expect(wat).toContain('(memory (export "memory")');
    expect(wat).toContain(`(data (i32.const ${RECIPE_OFFSET})`);
    expect(wat).toContain('(func (export "recipe_ptr")');
    expect(wat).toContain('(func (export "recipe_len")');
    expect(wat).toContain('(func (export "recipe_fmt")');
  });

  it('assembles to a VALID WebAssembly module', async () => {
    const wasm = await recipeToWasm(sampleRecipe);
    expect(wasm.length).toBeGreaterThan(8);
    // Magic number \0asm.
    expect(Array.from(wasm.slice(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d]);
    expect(WebAssembly.validate(wasm)).toBe(true);
  });

  it('round-trips: instantiate + decode deep-equals the original recipe', async () => {
    const wasm = await recipeToWasm(sampleRecipe);

    // Instantiate exactly as the browser client will.
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const e = instance.exports as any;
    expect(typeof e.memory).toBe('object');
    expect(e.recipe_fmt()).toBe(RECIPE_FMT);
    expect(e.recipe_ptr()).toBe(RECIPE_OFFSET);
    expect(e.recipe_len()).toBe(recipeToBytes(sampleRecipe).length);

    const recovered = await decodeRecipeWasm(wasm);
    expect(recovered).toEqual(sampleRecipe);
  });

  it('op-count matches the recipe tree (revolve + subtract + translate + cylinder)', () => {
    // booleanDifference(1) + revolve(1) + translate(1) + cylinder(1) = 4
    expect(recipeOpCount(sampleRecipe)).toBe(4);
  });

  it('reports the size tradeoff (WASM bytes vs JSON bytes)', async () => {
    const wasm = await recipeToWasm(sampleRecipe);
    const jsonBytes = recipeToBytes(sampleRecipe).length;
    // The WASM wrapper adds a small fixed overhead (module header + memory +
    // 3 accessor funcs) around the same recipe payload — so it is LARGER, not
    // smaller. Concealment, not compression. Assert it is in a sane ballpark.
    expect(wasm.length).toBeGreaterThan(jsonBytes);
    expect(wasm.length).toBeLessThan(jsonBytes + 4096);
    // Surface the numbers in the test log for the report.
    // eslint-disable-next-line no-console
    console.log(
      `[tf-wat-emit] recipe JSON = ${jsonBytes} B, opaque WASM = ${wasm.length} B ` +
        `(+${wasm.length - jsonBytes} B / ×${(wasm.length / jsonBytes).toFixed(2)} wrapper overhead)`,
    );
  });

  it('round-trips a recipe produced by graphToTf from a real graph', async () => {
    // Minimal composition graph: a root list holding one r_cuboid Call. Exercises
    // the actual graph → recipe → WASM → recipe path end-to-end.
    const graph: any = {
      root: 'n_root',
      params: { w: { default: 3 }, h: { default: 1.5 }, d: { default: 2 } },
      nodes: {
        n_root: { id: 'n_root', type: 'list', children: ['n_box'] },
        n_box: {
          id: 'n_box',
          type: 'call',
          src: 'r_cuboid',
          args: {
            w: { kind: 'param', param: 'w' },
            h: { kind: 'param', param: 'h' },
            d: { kind: 'param', param: 'd' },
          },
        },
      },
    };
    const recipe = graphToTf(graph, {});
    expect(recipe.instrs).toEqual([{ op: 'box', w: 3, h: 1.5, d: 2 }]);

    const wasm = await recipeToWasm(recipe);
    expect(WebAssembly.validate(wasm)).toBe(true);
    const recovered = await decodeRecipeWasm(wasm);
    expect(recovered).toEqual(recipe);
  });
});
