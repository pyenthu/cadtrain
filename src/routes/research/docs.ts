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

/** The category clusters, in display order — mirrors /design's abstracted
 *  subsystems (editor · kernel · wells · AI · architecture) so /research reads
 *  against the same mental model. `Findings` is the catch-all, shown last. */
export const CATEGORY_ORDER = [
  'Node editors',
  'Geometry kernels',
  'Wells',
  'Local AI',
  'Architecture',
  'Findings',
] as const;

/** Map a doc to one canonical category from a hint (an optional
 *  `<!-- research-group: X -->` marker) + its slug. Checked in an order that
 *  resolves overlaps: Node → Wells → Local AI → Geometry, so `webgpu-slm` lands
 *  in Local AI (not Geometry) and `wells-tf-verification` in Wells (not
 *  Geometry). Everything unmatched falls to Architecture. Normalising here
 *  (rather than per-file markers) keeps the whole scheme in one place. */
function canonicalCategory(slug: string, marker: string | null): string {
  const hay = `${marker ?? ''} ${slug}`.toLowerCase();
  if (/node editor|(^|[^a-z])ne-|svelteflow|blender-fields|\bvpl\b|flyde|node-?red|\bunit\b/.test(hay)) return 'Node editors';
  if (/\bwells?\b|svtc|wson|wbd|cement|dtx|schematic/.test(hay)) return 'Wells';
  if (/\bslm\b|web-?llm|\bllm\b|functionary|fncall|function-call|synthetic/.test(hay)) return 'Local AI';
  if (/brep|occt|trueform|(^|[^a-z])tf(-|\b)|sweep|normal|shading|\bmesh\b|webgpu|wasm|revolve|kernel|\bcsg\b/.test(hay)) return 'Geometry kernels';
  if (/architecture|overlap|authoring|shared/.test(hay)) return 'Architecture';
  return 'Architecture';
}

function build(): Doc[] {
  const out: Doc[] = [];

  for (const [path, raw] of Object.entries(researchRaw)) {
    const slug = slugOf(path);
    // Skip archived snapshot variants for v1.
    if (/\.archived-/i.test(slug)) continue;
    const category = canonicalCategory(slug, categoryMarkerOf(raw));
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

/** Ordered category list (tab clusters), following CATEGORY_ORDER — only the
 *  categories that actually have docs, in the canonical /design-aligned order.
 *  Any unforeseen category (should not happen) sorts to the end alphabetically. */
export const categories: string[] = (() => {
  const present = new Set(docs.map((d) => d.category));
  const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !CATEGORY_ORDER.includes(c as any)).sort();
  return [...ordered, ...extra];
})();

export function getDoc(slug: string | undefined): Doc | undefined {
  if (!slug) return undefined;
  return bySlug.get(slug.toLowerCase());
}
