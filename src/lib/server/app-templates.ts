// src/lib/server/app-templates.ts — the ".app → component" store: a saved composition (a
// subtree of nodes) promoted into a reusable COMPONENT/template, kept on the VOLUME (shared,
// prod) at <volume>/app-templates/<name>.json — like the design-RAG. Insert one from the studio
// palette and it clones into the tree (re-id'd). See docs/plans/app-server-render.md (.app→component).
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from './volume';

export interface AppTemplate {
  name: string;
  tree: unknown[];
  doc?: string;
}

const dir = () => volumePath('app-templates');
const safeId = (s: string) => String(s).replace(/[^a-z0-9_-]+/gi, '_') || 'component';

export async function saveTemplate(name: string, tree: unknown[], doc?: string): Promise<string> {
  const id = safeId(name);
  await mkdir(dir(), { recursive: true });
  await writeFile(join(dir(), `${id}.json`), `${JSON.stringify({ name, tree, doc }, null, 2)}\n`, 'utf8');
  return id;
}

export async function listTemplates(): Promise<Array<{ id: string; name: string; count: number }>> {
  let files: string[];
  try {
    files = (await readdir(dir())).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Array<{ id: string; name: string; count: number }> = [];
  for (const f of files) {
    try {
      const t = JSON.parse(await readFile(join(dir(), f), 'utf8'));
      out.push({ id: f.slice(0, -5), name: t.name ?? f.slice(0, -5), count: Array.isArray(t.tree) ? t.tree.length : 0 });
    } catch {
      /* skip a broken file */
    }
  }
  return out;
}

export async function loadTemplate(id: string): Promise<AppTemplate | undefined> {
  try {
    return JSON.parse(await readFile(join(dir(), `${safeId(id)}.json`), 'utf8')) as AppTemplate;
  } catch {
    return undefined;
  }
}
