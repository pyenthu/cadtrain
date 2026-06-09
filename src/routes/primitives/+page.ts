// /primitives → /graph-editor
//
// The graph-based editor at /graph-editor is now the SINGLE primitive
// editor (2026-06-09 — Rule 2 + the "two-product" structure). The old
// PrimitiveView-based /primitives page is gone; /primitives now redirects
// straight to /graph-editor and preserves the query string so bookmarks
// like `/primitives?id=mule_assembly` keep working.
//
// `?open=<id>` (a legacy /primitives query the K.69 vocab editor used to
// pop a part open) is folded into `?id=<id>` so the graph editor loads
// the same primitive on landing.
import { redirect } from '@sveltejs/kit';

export const prerender = false;
export const ssr = false;

export const load = ({ url }: { url: URL }) => {
  const next = new URL('/graph-editor', url.origin);
  // Forward every search param. Map `open` → `id` (legacy vocab link
  // format) so K.69 cross-page handoffs land on the right part.
  for (const [k, v] of url.searchParams) {
    if (k === 'open') next.searchParams.set('id', v);
    else next.searchParams.set(k, v);
  }
  throw redirect(307, next.pathname + (next.search || ''));
};
