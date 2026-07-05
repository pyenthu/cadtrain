import { describe, it, expect } from 'vitest';
import type { TfRecipe } from '$lib/cad/graph-to-tf';
import { recipeHasUnsupported, tfServerKey, tfRecipePending } from './tf-recipe-timing';

// A DIRECT-engine recipe (revolve/box/cyl → all supported). Real graphToTf output
// has more fields; the timing logic only walks `instrs`.
const supported = { instrs: [{ op: 'revolve' }] } as unknown as TfRecipe;
// A COMPOSITE recipe — a Call to another volume part comes back UNSUPPORTED and
// needs the server to inline the dep.
const unsupported = { instrs: [{ op: 'UNSUPPORTED' }] } as unknown as TfRecipe;
const nestedUnsupported = {
  instrs: [{ op: 'booleanDifference', children: [{ op: 'box' }, { op: 'UNSUPPORTED' }] }],
} as unknown as TfRecipe;

describe('recipeHasUnsupported', () => {
  it('false for supported / empty / undefined', () => {
    expect(recipeHasUnsupported(supported)).toBe(false);
    expect(recipeHasUnsupported({ instrs: [] } as unknown as TfRecipe)).toBe(false);
    expect(recipeHasUnsupported(undefined)).toBe(false);
  });
  it('true for a top-level UNSUPPORTED op', () => {
    expect(recipeHasUnsupported(unsupported)).toBe(true);
  });
  it('true for a NESTED UNSUPPORTED child', () => {
    expect(recipeHasUnsupported(nestedUnsupported)).toBe(true);
  });
});

describe('tfServerKey', () => {
  it('is stable for equal graph/params/bust and distinct otherwise', () => {
    const g = { nodes: [1, 2] }, p = { r: 3 };
    expect(tfServerKey(g, p, 0)).toBe(tfServerKey({ nodes: [1, 2] }, { r: 3 }, 0));
    expect(tfServerKey(g, p, 0)).not.toBe(tfServerKey(g, { r: 4 }, 0)); // param edit
    expect(tfServerKey(g, p, 0)).not.toBe(tfServerKey({ nodes: [1] }, p, 0)); // graph edit
    expect(tfServerKey(g, p, 0)).not.toBe(tfServerKey(g, p, 1)); // 🔄 bust
  });
});

describe('tfRecipePending — the anti-double-build gate', () => {
  const currentKey = tfServerKey({ n: 1 }, { r: 2 }, 0);

  it('DIRECT-engine part never pends (supported local → build instantly, no server hop)', () => {
    // Even if no server resolve has happened (serverResolvedKey === '').
    expect(tfRecipePending({ actualOn: true, local: supported, serverResolvedKey: '', currentKey })).toBe(false);
  });

  it('composite part PENDS right after an edit (server recipe not yet resolved for this key)', () => {
    // The failing scenario: local recomputed to UNSUPPORTED, server still holds a
    // PREVIOUS resolve (or none) → hold the mesh, do NOT bake on the stale recipe.
    expect(tfRecipePending({ actualOn: true, local: unsupported, serverResolvedKey: 'STALE-prev-key', currentKey })).toBe(true);
    expect(tfRecipePending({ actualOn: true, local: unsupported, serverResolvedKey: '', currentKey })).toBe(true);
  });

  it('composite part CLEARS pending once the server resolve lands for THIS key → one bake', () => {
    expect(tfRecipePending({ actualOn: true, local: unsupported, serverResolvedKey: currentKey, currentKey })).toBe(false);
  });

  it('genuinely-unsupported part (server resolved this key, still unsupported) is NOT pending → canvas blanks+errors', () => {
    // Pending is purely a timing gate; native-only "can’t build" is decided in
    // rebuildTf. Once the resolve for currentKey lands, pending is false so the
    // canvas gets the recipe and enforces the native-only rule.
    expect(tfRecipePending({ actualOn: true, local: nestedUnsupported, serverResolvedKey: currentKey, currentKey })).toBe(false);
  });

  it('never pends when TF actual mode is off, or no local recipe compiled', () => {
    expect(tfRecipePending({ actualOn: false, local: unsupported, serverResolvedKey: '', currentKey })).toBe(false);
    expect(tfRecipePending({ actualOn: true, local: undefined, serverResolvedKey: '', currentKey })).toBe(false);
  });
});
