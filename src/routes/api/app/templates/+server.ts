// /api/app/templates — the ".app → component" store (volume).
//   GET            → list saved components [{id, name, count}]
//   GET  ?id=<id>  → load one { name, tree, doc? }
//   POST { name, tree, doc? } → save a composition as a reusable component
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveTemplate, listTemplates, loadTemplate } from '$lib/server/app-templates';

export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (id) {
    const t = await loadTemplate(id);
    if (!t) throw error(404, `no component "${id}"`);
    return json(t);
  }
  return json({ templates: await listTemplates() });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { name?: string; tree?: unknown[]; doc?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'expected JSON { name, tree, doc? }');
  }
  if (!Array.isArray(body?.tree) || !body.tree.length) throw error(400, 'missing tree (non-empty array)');
  const id = await saveTemplate(body.name || 'component', body.tree, body.doc);
  return json({ ok: true, id });
};
