// Pure TF-tab recipe TIMING helpers — extracted from RightPane so the
// double-build fix is unit-testable without mounting Svelte.
//
// The TF "actual" canvas builds from a `TfRecipe`. Direct-engine parts
// (revolve/box/cyl) compile CLIENT-side instantly (graphToTf) → one build.
// COMPOSITE parts (a part that Calls another volume part) come back with
// UNSUPPORTED ops and need the SERVER (/api/tf/compile) to inline the deps.
//
// The bug these helpers fix: on an edit, the client recipe recomputes to a fresh
// UNSUPPORTED recipe, but the server recipe still holds the PREVIOUS resolve, so
// the canvas would bake ONCE on the stale-but-supported recipe (stale topology +
// the new args) BEFORE the fresh recipe lands → a throwaway build. We stamp each
// server resolve with the graph/params/bust key it was FOR; the recipe is
// "pending" until that stamp matches the live graph, and the canvas holds its
// mesh until then → one build, not two.
import type { TfRecipe } from '$lib/engines/trueform/graph-to-tf';

/** Does any instr (or a nested boolean/transform/union child) stay UNSUPPORTED?
 *  Mirrors execute.ts's recipeHasUnsupported WITHOUT importing it (that would
 *  pull the TF/WASM bundle into the graph-editor chunk eagerly). */
export function recipeHasUnsupported(r: TfRecipe | undefined): boolean {
  if (!r?.instrs) return false;
  const walk = (i: any): boolean =>
    !!i && (i.op === 'UNSUPPORTED' ||
      walk(i.obj) || walk(i.arg) || walk(i.child) ||
      (Array.isArray(i.children) && i.children.some(walk)));
  return r.instrs.some(walk);
}

/** Stable signature of the graph/params/bust that a server recipe resolve is
 *  FOR. Equal signatures ⇒ the live server recipe is up-to-date. */
export function tfServerKey(g: unknown, p: unknown, bust: number): string {
  return JSON.stringify({ g, p, bust });
}

/** True while a composite part NEEDS a server recipe but the live server recipe
 *  hasn't caught up to the current graph yet → the canvas should HOLD its mesh
 *  (skip the throwaway stale bake). Returns false for:
 *   - direct-engine parts (local recipe fully supported → build instantly), and
 *   - once a server resolve for the CURRENT key has landed — EVEN an unsupported
 *     one — so a genuinely-unsupported part reaches the canvas and blanks+errors
 *     (native-only rule; that contract lives in rebuildTf, not here). */
export function tfRecipePending(args: {
  actualOn: boolean;
  local: TfRecipe | undefined;
  serverResolvedKey: string;
  currentKey: string;
}): boolean {
  const { actualOn, local, serverResolvedKey, currentKey } = args;
  if (!actualOn || !local || !recipeHasUnsupported(local)) return false;
  return serverResolvedKey !== currentKey;
}
