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
  /** Recency signal for the "Recent" sort — `YYYY-MM-DD`, from a leading
   *  `<!-- research-date: YYYY-MM-DD -->` marker (backfilled from
   *  `git log -1 --date=short` at authoring time). Empty string if unset —
   *  sorts last under "Recent". */
  date: string;
  /** Roadmap-relevance signal for the "Priority" sort — 1 (highest, live/
   *  active roadmap) .. 5 (lowest, parked/superseded), from a leading
   *  `<!-- research-priority: N -->` marker. Defaults to 3 (mid) if unset. */
  priority: number;
}

/** Leading `<!-- research-*: value -->` markers, read off the top of a doc
 *  body — the same mechanism, generalised to 3 keys (group/date/priority).
 *  Markers may appear in any order, stacked with blank lines between them;
 *  each is stripped so none render. */
interface LeadingMarkers {
  group: string | null;
  date: string | null;
  priority: number | null;
}

function extractLeadingMarkers(raw: string): { markers: LeadingMarkers; body: string } {
  const markers: LeadingMarkers = { group: null, date: null, priority: null };
  let body = raw;
  const markerLine = /^\s*<!--\s*research-(group|date|priority):\s*(.+?)\s*-->\s*\n?/i;
  let m: RegExpMatchArray | null;
  while ((m = body.match(markerLine)) && m.index === 0) {
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'group') markers.group = value;
    else if (key === 'date') markers.date = value;
    else if (key === 'priority') markers.priority = Number(value) || null;
    body = body.slice(m[0].length);
  }
  return { markers, body };
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
 *  subsystems (kernels · AI · graph editor · wells · architecture) so
 *  /research reads against the same mental model. `Findings` is the
 *  catch-all, shown last. */
export const CATEGORY_ORDER = [
  'Geometry kernels',
  'Local AI',
  'Graph interface',
  'Wells',
  'Architecture',
  'Findings',
] as const;

/** One-paragraph top-of-pane overview per category — shown above the doc
 *  cards so a category reads as a subsystem, not a bag of files. Single
 *  source of truth (Rule: the whole taxonomy lives in this file). */
export const categoryAbstracts: Record<string, string> = {
  'Geometry kernels':
    'cadtrain runs three geometry kernels side by side: Manifold (the primary ' +
    'CSG mesh-boolean workhorse), TrueForm (a native, WebGPU-adjacent kernel ' +
    'behind the TF tab), and a server-side BREP/OCCT engine for true curves. ' +
    'This cluster covers kernel-level feasibility spikes and bug root-causes — ' +
    'BRep-to-CSG feature retrieval, sweep self-intersection theory, normals / ' +
    'smooth-shading correctness, and the TrueForm→WebGPU port question — the ' +
    'research that keeps the multi-engine strategy honest.',
  'Local AI':
    'Runtime AI must stay local — no well or part data may leave the browser ' +
    '(the binding data-residency constraint; cloud Claude is dev/authoring ' +
    'only). This cluster tracks the in-browser LLM path: which runtime ' +
    '(web-llm/MLC + XGrammar) and model beat a server round-trip for ' +
    'tool-calling, what synthetic + real training data a fine-tune would take, ' +
    'and why alternatives (Functionary, a Python recursion harness) don’t fit ' +
    'a WebGPU-only deployment. All three are conditional-GO spikes, not yet built.',
  'Graph interface':
    'GraphEditorPane is the CAD editor’s node-graph canvas — this cluster is ' +
    'the comparative-UI homework behind it: what Blender’s Fields model, ' +
    'Flyde, Node-RED, Unit, a VPL-design article, and svelte-flow each get ' +
    'right (subgraph-as-node reuse, typed sockets, palette search) versus what ' +
    'our bounded, explicit Repeat/composition-graph model already does better. ' +
    'Feeds the open Repeat-as-subgraph and typed field-socket threads; the ' +
    'svelte-flow-for-GEP migration question is itself already decided (NO-GO ' +
    'for the editor, GO for /design).',
  Wells:
    '/wells is the WSON → 3D well-schematic engine, still actively being ' +
    'built. This cluster covers the domain model it has to get right — ' +
    'SVTC’s `.wson` schema and DTX depth-transform, NORSOK-grounded ' +
    'cement/annulus detection, a commercial Visio stencil’s component ' +
    'vocabulary — plus root-cause writeups for the empty-3D-render and ' +
    'slow-cutaway bugs that shaped the current 2D-SVG-default + WellBakePool ' +
    'architecture, and a TrueForm-native compile verification for the `bw_*` ' +
    'part library.',
  Architecture:
    'Cross-cutting audits of the codebase’s own layering: the current ' +
    '(post-K.63) CAD-authoring conventions — why the node-graph canvas won ' +
    'over the tree editor, and the 3-tier roadmap for curved/filleted ' +
    'profiles — and a `src/lib/graph/` vs `src/lib/shared/` import-cycle ' +
    'audit that feeds the open `/plan` #992 move.',
  Findings:
    'A catch-all for research that doesn’t map to a single subsystem — ' +
    'currently one entry: why default-parameter synthetic renders collapse ' +
    'pHash/CLIP similarity across primitives, and a counter-finding that raw ' +
    'VLM classification (no RAG) actually beats the retrieval-scaffolded ' +
    'pipeline on that domain.',
};

/** Map a doc to one canonical category from a hint (an optional
 *  `<!-- research-group: X -->` marker) + its slug. Checked in an order that
 *  resolves overlaps: Graph interface → Wells → Local AI → Geometry, so
 *  `webgpu-slm` lands in Local AI (not Geometry) and `wells-tf-verification`
 *  in Wells (not Geometry). Everything unmatched falls to Architecture.
 *  Normalising here (rather than per-file markers) keeps the whole scheme in
 *  one place. */
function canonicalCategory(slug: string, marker: string | null): string {
  const hay = `${marker ?? ''} ${slug}`.toLowerCase();
  if (/node editor|graph interface|(^|[^a-z])ne-|svelteflow|blender-fields|\bvpl\b|flyde|node-?red|\bunit\b/.test(hay)) return 'Graph interface';
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
    const { markers, body } = extractLeadingMarkers(raw);
    const category = canonicalCategory(slug, markers.group);
    out.push({
      slug, title: titleOf(body, slug), excerpt: excerptOf(body), body,
      group: 'Research', category,
      date: markers.date ?? '', priority: markers.priority ?? 3,
    });
  }

  for (const [path, raw] of Object.entries(findingsRaw)) {
    const slug = slugOf(path); // -> 'findings'
    const { markers, body } = extractLeadingMarkers(raw);
    out.push({
      slug, title: titleOf(body, slug), excerpt: excerptOf(body), body,
      group: 'Findings', category: 'Findings',
      date: markers.date ?? '', priority: markers.priority ?? 3,
    });
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

/** Sort modes for the horizontal view control. "category" is the default
 *  grouped view (rendered per-category by the page, not a flat array here). */
export type SortMode = 'category' | 'recent' | 'priority' | 'az';

/** Newest `research-date` first; undated docs sort last. Ties broken by title. */
export function sortByRecent(list: Doc[]): Doc[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date ? (b.date ? (a.date < b.date ? 1 : -1) : -1) : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Highest priority (lowest N) first. Ties broken by recency, then title. */
export function sortByPriority(list: Doc[]): Doc[] {
  return [...list].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.date !== b.date) return a.date ? (b.date ? (a.date < b.date ? 1 : -1) : -1) : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Alphabetical by title. */
export function sortByTitle(list: Doc[]): Doc[] {
  return [...list].sort((a, b) => a.title.localeCompare(b.title));
}

/** Pre-sorted whole-corpus arrays (Research + Findings together) for the
 *  flat, cross-category "Recent" / "Priority" / "A–Z" view modes. */
export const byRecent: Doc[] = sortByRecent(docs);
export const byPriority: Doc[] = sortByPriority(docs);
export const byTitle: Doc[] = sortByTitle(docs);
