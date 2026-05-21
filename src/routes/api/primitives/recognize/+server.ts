import { json, error } from '@sveltejs/kit';
import { recognizeComposite } from '$lib/server/recognize-composite';

// POST /api/primitives/recognize { source } → { instances, composition, unrecognized }
// AST-parses a composite primitive's source.ts to recognize its parts
// (instances) for the GUI's read-only Parts panel. Pure local compute
// (parse only) — NOT proxied, no sandbox, no WASM.

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { source } = body ?? {};
  if (typeof source !== 'string') throw error(400, 'source required');
  try {
    return json({ ok: true, ...recognizeComposite(source) });
  } catch (e: any) {
    throw error(400, `recognize failed: ${e?.message ?? e}`);
  }
};
