/**
 * Bundled sample WSON wells (W0) — ported from SVTC's sample set so the /wells
 * scaffold has real data to parse before the volume store + editor land. Loaded
 * via `?raw` glob (same mechanism as the /research docs); each sample ships in
 * the JS bundle, no static serving needed.
 */
import { parseWson, type Wson, type WsonIssue } from './wson';

const raw = import.meta.glob('./samples/*.wson', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface WellSample { slug: string; name: string; wson: Wson; issues: WsonIssue[]; }

function slugOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.wson$/i, '');
}

export const sampleWells: WellSample[] = Object.entries(raw)
  .map(([path, text]) => {
    const slug = slugOf(path);
    try {
      const { wson, issues } = parseWson(text);
      return { slug, name: wson.meta?.wellName || slug, wson, issues };
    } catch (e: any) {
      // Keep a placeholder so a bad sample is visible rather than silently dropped.
      return { slug, name: `${slug} (parse error: ${e?.message ?? e})`, wson: { meta: { wellName: slug } } as Wson, issues: [{ level: 'error', path: '', message: String(e?.message ?? e) }] };
    }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));
