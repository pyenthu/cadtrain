/**
 * wson-summary.ts — route-owned, self-contained WSON loader + summariser for
 * the /wells app shell.
 *
 * DELIBERATELY does NOT import from `$lib/wells/**` — that subtree is the well
 * ENGINE (owned by a parallel session) and exposes the real 3D view
 * (`$lib/wells/WellSchematic3D.svelte`) which the shell mounts at merge. The
 * shell only needs enough parsing to (a) list `.wson` docs in the sidebar and
 * (b) show a lightweight header summary in the placeholder view. Keeping this
 * parser local means the shell builds + renders on its own, before the engine
 * lands.
 *
 * Samples are bundled via `?raw` glob (same mechanism as the primitives/vocab
 * `?raw` loads) — no static serving needed.
 */

/** The shape we read out of a WSON file — intentionally loose; a `.wson` is
 *  just JSON and real files carry many more keys we don't touch here. */
export interface WsonDoc {
  meta?: {
    wellName?: string;
    td?: number;
    pbtd?: number;
    rkbToGl?: number;
    _wellType?: string;
    location?: { crs?: string; lat?: number; lon?: number };
  };
  oh?: unknown[];
  ch?: unknown[];
  completions?: unknown[];
  perforations?: unknown[];
  profile?: Array<{ md?: number; dev?: number; az?: number }>;
  [k: string]: unknown;
}

/** A `.wson` document available in the sidebar. `slug` is the filename stem;
 *  `raw` is the source text (so the future engine view can re-parse if it
 *  wants); `doc`/`error` capture the parse result. */
export interface WsonFile {
  slug: string;
  /** Filename with extension — what the sidebar shows as a leaf. */
  name: string;
  raw: string;
  doc: WsonDoc | null;
  error: string | null;
}

/** Condensed header summary for the placeholder view. */
export interface WsonSummary {
  wellName: string;
  wellType: string | null;
  td: number | null;
  pbtd: number | null;
  deviated: boolean;
  counts: {
    openHole: number;
    casing: number;
    completions: number;
    perforations: number;
    survey: number;
  };
}

const rawSamples = import.meta.glob('./samples/*.wson', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function slugOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.wson$/i, '');
}

/** All bundled sample `.wson` files, sorted by slug. */
export const wsonFiles: WsonFile[] = Object.entries(rawSamples)
  .map(([path, raw]) => {
    const slug = slugOf(path);
    try {
      const doc = JSON.parse(raw) as WsonDoc;
      return { slug, name: `${slug}.wson`, raw, doc, error: null };
    } catch (e) {
      return {
        slug,
        name: `${slug}.wson`,
        raw,
        doc: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

/** A `.wson` is deviated when any survey station has a non-zero deviation. */
function isDeviated(doc: WsonDoc): boolean {
  const prof = doc.profile ?? [];
  return prof.some((s) => Math.abs(Number(s?.dev ?? 0)) > 0.01);
}

/** Summarise a parsed WSON doc for the placeholder header. */
export function summarise(doc: WsonDoc | null): WsonSummary | null {
  if (!doc) return null;
  const meta = doc.meta ?? {};
  return {
    wellName: meta.wellName || 'Unnamed well',
    wellType: meta._wellType ?? null,
    td: typeof meta.td === 'number' ? meta.td : null,
    pbtd: typeof meta.pbtd === 'number' ? meta.pbtd : null,
    deviated: isDeviated(doc),
    counts: {
      openHole: doc.oh?.length ?? 0,
      casing: doc.ch?.length ?? 0,
      completions: doc.completions?.length ?? 0,
      perforations: doc.perforations?.length ?? 0,
      survey: doc.profile?.length ?? 0,
    },
  };
}

/** Look up a bundled file by slug. */
export function fileBySlug(slug: string): WsonFile | undefined {
  return wsonFiles.find((f) => f.slug === slug);
}
