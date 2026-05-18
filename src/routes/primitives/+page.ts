import { redirect } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

// Stage B of the components/primitives split — see
// ~/.claude/plans/components-primitives-split.md. The user-facing
// route moved to /components; this redirect catches inbound bookmarks
// + any stale internal links that haven't been updated yet. 308 (vs
// 301) preserves the request method, which matters because some pages
// POST here with state in the URL.
export const load = () => {
  throw redirect(308, '/components');
};
