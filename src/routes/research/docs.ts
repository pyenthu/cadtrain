/**
 * Shared loader for the /research route.
 *
 * Inlines the raw markdown text of every research doc at BUILD time via
 * `import.meta.glob({ query:'?raw', eager:true })` — the exact mechanism
 * src/lib/server/stdlib.ts uses to bake src files into the bundle. The
 * leading-slash glob path is relative to the Vite project root (the repo
 * root), so `/docs/...` resolves even though `docs/` lives outside `src/`.
 * `?raw` means the docs ship inside the JS bundle, no static serving needed.
 *
 * Drop a new `.md` into docs/research/ and it auto-appears on /research after
 * the next build (HMR picks it up in dev). No code change required.
 */

const researchRaw = import.meta.glob('/docs/research/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const findingsRaw = import.meta.glob('/docs/FINDINGS.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type DocGroup = 'Research' | 'Findings';

export interface Doc {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  group: DocGroup;
  /** Display category (tab cluster). From an optional leading
   *  `<!-- research-group: X -->` marker, else the group name. */
  category: string;
}

/** Read an optional leading `<!-- research-group: X -->` marker — used to
 *  cluster related docs into one tab group (e.g. "Node editors"). */
function categoryMarkerOf(body: string): string | null {
  const m = body.match(/<!--\s*research-group:\s*(.+?)\s*-->/i);
  return m ? m[1].trim() : null;
}

/** Drop the marker comment line so it never renders. */
function stripMarker(body: string): string {
  return body.replace(/^\s*<!--\s*research-group:.*?-->\s*\n?/i, '');
}

/** First `#` heading in the body, else the prettified slug. */
function titleOf(body: string, slug: string): string {
  const h = body.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : slug.replace(/[-_]/g, ' ');
}

/** First non-heading, non-empty line, truncated — a short hint for index rows. */
function excerptOf(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('<!--')) continue;
    // strip the most common inline markdown so the hint reads as plain text
    const plain = line
      .replace(/[*_`]+/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    if (!plain) continue;
    return plain.length > 140 ? plain.slice(0, 137).trimEnd() + '…' : plain;
  }
  return '';
}

function slugOf(path: string): string {
  const file = path.split('/').pop() ?? '';
  return file.replace(/\.md$/i, '').toLowerCase();
}

function build(): Doc[] {
  const out: Doc[] = [];

  for (const [path, raw] of Object.entries(researchRaw)) {
    const slug = slugOf(path);
    // Skip archived snapshot variants for v1.
    if (/\.archived-/i.test(slug)) continue;
    const category = categoryMarkerOf(raw) ?? 'Research';
    const body = stripMarker(raw);
    out.push({ slug, title: titleOf(body, slug), excerpt: excerptOf(body), body, group: 'Research', category });
  }

  for (const [path, raw] of Object.entries(findingsRaw)) {
    const slug = slugOf(path); // -> 'findings'
    const body = stripMarker(raw);
    out.push({ slug, title: titleOf(body, slug), excerpt: excerptOf(body), body, group: 'Findings', category: 'Findings' });
  }

  out.sort((a, b) => {
    if (a.group !== b.group) return a.group === 'Findings' ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return out;
}

export const docs: Doc[] = build();

export const bySlug = new Map<string, Doc>(docs.map((d) => [d.slug, d]));

/** Ordered category list (tab clusters): Node editors first, other Research,
 *  then Findings. */
export const categories: string[] = (() => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const d of docs) if (!seen.has(d.category)) { seen.add(d.category); order.push(d.category); }
  const rank = (c: string) => (c === 'Node editors' ? 0 : c === 'Findings' ? 2 : 1);
  return order.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
})();

export function getDoc(slug: string | undefined): Doc | undefined {
  if (!slug) return undefined;
  return bySlug.get(slug.toLowerCase());
}
