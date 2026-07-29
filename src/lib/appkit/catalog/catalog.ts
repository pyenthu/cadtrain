// src/lib/appkit/catalog/catalog.ts — the studio SDK: ONE searchable catalog projecting
// BOTH registries — UI COMPONENTS (components.ts) + engine/data VERBS (verbs/registry.ts).
// The studio search bar (Increment 8) queries this to add components + wire verbs.
import { COMPONENT_CATALOG } from './components';
import { VERBS } from '../verbs/registry';

export interface CatalogEntry {
  /** 'component' → addable to the app; 'verb' → wireable into a binding. */
  type: 'component' | 'verb';
  /** The kind (component) or verb name. */
  key: string;
  name: string;
  description: string;
  group: string;
  tags: string[];
}

/** The full catalog — components first, then verbs. Pure (no I/O). */
export function buildCatalog(): CatalogEntry[] {
  const components: CatalogEntry[] = COMPONENT_CATALOG.map((c) => ({
    type: 'component',
    key: c.kind,
    name: c.name,
    description: c.description,
    group: c.group,
    tags: c.tags,
  }));
  // Verbs the AI/user can WIRE (data + mutate); gui verbs are the builder's own tools.
  const verbs: CatalogEntry[] = VERBS.filter((v) => v.group === 'data' || v.group === 'mutate').map((v) => ({
    type: 'verb',
    key: v.name,
    name: v.name,
    description: v.desc,
    group: `verb:${v.group}`,
    tags: [v.name, v.group, ...v.name.split(/(?=[A-Z])/).map((s) => s.toLowerCase())],
  }));
  return [...components, ...verbs];
}

/** Lexical rank: name/tag hits weigh more than description hits. Empty query → all,
 *  components first (stable order). Filter by `type` when the caller only wants one. */
export function searchCatalog(
  query: string,
  opts: { type?: 'component' | 'verb'; entries?: CatalogEntry[] } = {},
): CatalogEntry[] {
  let entries = opts.entries ?? buildCatalog();
  if (opts.type) entries = entries.filter((e) => e.type === opts.type);
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/\s+/);
  const scored = entries.map((e) => ({ e, s: score(e, terms) })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.e);
}

function score(e: CatalogEntry, terms: string[]): number {
  const name = e.name.toLowerCase();
  const key = e.key.toLowerCase();
  const desc = e.description.toLowerCase();
  const tags = e.tags.map((t) => t.toLowerCase());
  let s = 0;
  for (const t of terms) {
    let hit = 0;
    if (name === t || key === t) hit += 10;
    else if (name.includes(t) || key.includes(t)) hit += 6;
    if (tags.some((tag) => tag === t)) hit += 5;
    else if (tags.some((tag) => tag.includes(t))) hit += 3;
    if (desc.includes(t)) hit += 1;
    if (hit === 0) return 0; // every term must match SOMETHING (AND semantics)
    s += hit;
  }
  return s;
}
