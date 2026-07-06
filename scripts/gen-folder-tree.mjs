import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = 'src';
const EXT = new Set(['.ts', '.svelte', '.js', '.css', '.json']);
const SKIP = new Set(['node_modules', '.svelte-kit']);

function loc(file) {
  try { return readFileSync(file, 'utf8').split('\n').length; } catch { return 0; }
}
function walk(dir, rel) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(e => !SKIP.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const children = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      const sub = walk(full, r);
      if (sub.children && sub.children.length) children.push(sub);
    } else {
      const dot = e.name.lastIndexOf('.');
      const ext = dot >= 0 ? e.name.slice(dot) : '';
      if (!EXT.has(ext)) continue;
      children.push({ name: e.name, path: r, loc: loc(full) });
    }
  }
  return { name: dir === ROOT ? 'src' : dir.split('/').pop(), path: rel || 'src', children };
}

const tree = walk(ROOT, '');
// stats
let files = 0, total = 0;
(function count(n){ if(n.children) n.children.forEach(count); else { files++; total += n.loc||0; } })(tree);

const header = `/**
 * folder-tree.ts — snapshot of the src/ directory (files + LOC) for the /design
 * "Folder tree" treemap tab (FolderTreemap.svelte). Rectangle area ∝ LOC.
 * Generated ${new Date().toISOString().slice(0,10)} by scripts/gen-folder-tree.mjs
 * (\`bun scripts/gen-folder-tree.mjs\`) — a curated snapshot, refresh on demand.
 * ${files} files · ${total.toLocaleString()} LOC across src/.
 */

export interface FolderNode {
  name: string;
  path: string;
  loc?: number;              // leaf files only
  children?: FolderNode[];   // directories only
}

export const FOLDER_TREE: FolderNode = ${JSON.stringify(tree, null, 2)};
`;
writeFileSync('src/routes/design/folder-tree.ts', header);
console.log(`wrote folder-tree.ts — ${files} files, ${total} LOC`);
