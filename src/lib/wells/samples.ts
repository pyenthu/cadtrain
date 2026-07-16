/**
 * Sample WSON wells for the /wells scaffold.
 *
 * CANONICAL SOURCE = the persistent volume (`<volume>/wells/samples/`, served by
 * `/api/wells/samples`) so a user can add / edit / customise samples live —
 * `loadSampleWells()` fetches + parses them. The bundled `src/lib/wells/samples/
 * *.wson` files (eager `?raw` glob) remain as the SEED the volume is populated
 * from on first read, and as the offline FALLBACK (`sampleWells`) when the
 * endpoint is unreachable or the volume is empty. Tests that need synchronous,
 * network-free data import `sampleWells` directly.
 */
import { parseWson, type Wson, type WsonIssue } from './wson';

const raw = import.meta.glob('./samples/*.wson', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface WellSample { slug: string; name: string; wson: Wson; issues: WsonIssue[]; }

function slugOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.wson$/i, '');
}

/** Parse one `.wson` blob into a `WellSample`, capturing (not throwing) parse
 *  errors so a bad sample is visible rather than silently dropped. */
export function toWellSample(slug: string, text: string): WellSample {
  try {
    const { wson, issues } = parseWson(text);
    return { slug, name: wson.meta?.wellName || slug, wson, issues };
  } catch (e: any) {
    return {
      slug,
      name: `${slug} (parse error: ${e?.message ?? e})`,
      wson: { meta: { wellName: slug } } as Wson,
      issues: [{ level: 'error', path: '', message: String(e?.message ?? e) }],
    };
  }
}

/** Bundled seed / offline fallback — the git-tracked `./samples/*.wson`. */
export const sampleWells: WellSample[] = Object.entries(raw)
  .map(([path, text]) => toWellSample(slugOf(path), text))
  .sort((a, b) => a.slug.localeCompare(b.slug));

/** Shape returned by `GET /api/wells/samples`. */
interface SamplesListResponse {
  samples?: Array<{ slug?: string; name?: string; text?: string }>;
}

/**
 * Load the sample wells from the VOLUME store (`/api/wells/samples`), parsing
 * each `.wson`. Falls back to the bundled `sampleWells` when the endpoint is
 * unreachable OR the volume is empty — so /wells always has data. Pass a custom
 * `fetch` (e.g. SvelteKit's `event.fetch`) when calling during SSR/tests.
 */
export async function loadSampleWells(fetchFn: typeof fetch = fetch): Promise<WellSample[]> {
  try {
    const res = await fetchFn('/api/wells/samples');
    if (!res.ok) throw new Error(`GET /api/wells/samples → ${res.status}`);
    const data = (await res.json()) as SamplesListResponse;
    const files = Array.isArray(data?.samples) ? data.samples : [];
    if (files.length === 0) return sampleWells; // empty volume → offline fallback
    return files
      .filter((f) => typeof f?.text === 'string')
      .map((f) => toWellSample(f.slug || slugOf(f.name ?? ''), f.text as string))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  } catch {
    return sampleWells;
  }
}
