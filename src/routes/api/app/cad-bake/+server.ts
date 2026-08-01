import { json } from '@sveltejs/kit';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// POST /api/app/cad-bake
//   { partId, params?, cutaway?, engine? } → { ok, full, cutVC, parts?, cutParts?, cutawaySkipped }  |  { error }
//
// The SERVER-COMPUTE transport for the `cad3d` app-harness island (computeMode:'server').
// The browser sends ONLY { partId } (+ optional params/cutaway); this endpoint:
//   1. loads the part SOURCE server-side by id (stdlib → volume → bundle; proxy-aware in dev),
//   2. bakes it through the SAME builder + serialize path as /api/primitives/preview,
//   3. returns the serialized MESH JSON (deserializeComponentResult on the client).
// The engine AND the part's TypeScript source NEVER reach the client — only mesh + the Threlte
// viewer do. This is the IP-protection boundary (docs/plans/app-server-render.md §computeMode).
//
// Read-only bake. Never 500 on a bad part — a missing part / geometry failure returns
// { error } with a 400 so the island can show an error state instead of a crash.
//
// `engine` (manifold|trueform|brep) is accepted + reserved; v0 bakes Manifold only (the
// /api/primitives/preview path). trueform/brep are a follow-up.

interface Body {
  partId?: string;
  params?: Record<string, unknown>;
  cutaway?: boolean;
  engine?: string;
}

/** meta.params order is authoritative — map the caller's param record (name→value) onto the
 *  part's positional arg list (defaults for anything unset). Polygon params (default is an
 *  [[x,y],…] array) are JSON-encoded strings, exactly as the geom function expects them. */
function toPositional(
  metaParams: Record<string, any>,
  caller?: Record<string, unknown>,
): (number | string)[] {
  const keys = Object.keys(metaParams ?? {});
  if (keys.length) {
    return keys.map((k) => {
      const spec = metaParams[k];
      const v: unknown = caller && k in caller ? caller[k] : spec?.default;
      if (Array.isArray(v)) return JSON.stringify(v); // polygon → JSON string
      if (typeof v === 'string') return v; // pass-through (JSON polygon / expr)
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });
  }
  // Bundle helper (no meta) — best-effort: the caller's values in object order.
  if (caller && typeof caller === 'object') {
    return Object.values(caller).map((v) => (typeof v === 'string' ? v : Number(v ?? 0)));
  }
  return [];
}

export const POST = async ({ request, fetch }: { request: Request; fetch: typeof globalThis.fetch }) => {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const partId = typeof body?.partId === 'string' ? body.partId.trim() : '';
  if (!partId || !/^[a-z_][a-z0-9_]*$/i.test(partId)) {
    return json({ error: 'valid partId required' }, { status: 400 });
  }
  const cutaway = body?.cutaway === true;

  // 1) Load the part SOURCE server-side. /api/primitives/source resolves stdlib → volume →
  //    bundle and is proxy-aware in local dev (source stays on the server; the client never
  //    sees it). It also returns the meta.params (ordered) so we can build positional args.
  let source = '';
  let metaParams: Record<string, any> = {};
  try {
    const srcRes = await fetch(`/api/primitives/source?name=${encodeURIComponent(partId)}`);
    if (!srcRes.ok) return json({ error: `part "${partId}" not found` }, { status: 400 });
    const s = await srcRes.json().catch(() => null);
    source = s && typeof s.source === 'string' ? s.source : '';
    if (!source) return json({ error: `part "${partId}" has no source` }, { status: 400 });
    metaParams = s && s.params && typeof s.params === 'object' ? s.params : {};
  } catch (e: any) {
    return json({ error: `source load failed: ${e?.message ?? e}` }, { status: 400 });
  }
  // Fall back to parsing the source when the source endpoint didn't carry meta (bundle fallback).
  if (Object.keys(metaParams).length === 0) {
    try {
      metaParams = extractMetaFromSource(source).params ?? {};
    } catch {
      /* meta-less / bundle helper — positional args come from the caller only */
    }
  }
  const args = toPositional(metaParams, body?.params);

  // 2) Bake via the SAME path as /api/primitives/preview — which stays SERVER-LOCAL (it is
  //    excluded from the volume proxy). This reuses the whole builder → finalizeManifold →
  //    serializeComponentResult chain, plus the bake cache, the Manifold trap guard, dep
  //    resolution, colour-by-source, and cutaway. No engine/source is exposed to the client.
  try {
    const prev = await fetch('/api/primitives/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, name: partId, params: args, cutaway }),
    });
    const data = await prev.json().catch(() => null);
    if (!prev.ok || !data || data.ok !== true) {
      const msg = (data && (data.error || data.message)) || `bake failed (${prev.status})`;
      return json({ error: msg }, { status: 400 });
    }
    return json({
      ok: true,
      full: data.full,
      cutVC: data.cutVC,
      ...(data.parts ? { parts: data.parts } : {}),
      ...(data.cutParts ? { cutParts: data.cutParts } : {}),
      cutawaySkipped: data.cutawaySkipped === true,
    });
  } catch (e: any) {
    return json({ error: `bake failed: ${e?.message ?? e}` }, { status: 400 });
  }
};
