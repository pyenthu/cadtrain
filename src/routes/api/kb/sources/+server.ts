/**
 * GET /api/kb/sources — list raw source documents on the persistent volume.
 *
 * Lists `<VOLUME>/kb-sources/` (every PDF / docx / xlsx), enriches each
 * entry with metadata from the sidecar `<VOLUME>/kb-sources/_index.json`
 * if present. Returns the structure the /components Sources tab consumes
 * — replacing the old "fetch every bundled KB JSON at mount time" path.
 *
 * Sidecar `_index.json` shape (all fields optional except `name` or `url`):
 *   {
 *     "files": [
 *       {
 *         "name": "bha-reference.pdf",
 *         "title": "Bottom-Hole Assembly Reference",
 *         "family": "drillstring",          // one of FAMILIES; default 'basic'
 *         "kind": "industry_chart"          // free-form, surfaced as a badge
 *       },
 *       {
 *         "url": "https://miracleoilfield.com/tubing-hanger-spools-and-couplings/",
 *         "title": "Tubing Hanger Spools (Miracle Industries)",
 *         "family": "wellhead_xt",
 *         "kind": "vendor_catalog"
 *       }
 *     ]
 *   }
 *
 * Files present in the directory but not in the sidecar still appear in
 * the response (with default metadata) so you can drop a PDF in via the
 * /api/volume PUT endpoint and have it appear immediately — sidecar
 * editing is optional polish.
 *
 * Cross-instance: `maybeProxy()` lets a local dev instance read the prod
 * volume's source list when `CADTRAIN_VOLUME_REMOTE_URL` is set.
 */

import { json } from '@sveltejs/kit';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { VOLUME_ROOT, checkVolumeAuth, maybeProxy } from '$lib/server/volume';

interface SidecarFile {
  name?: string;            // filename under kb-sources/
  url?: string;             // external URL (no local file)
  title?: string;
  family?: string;
  kind?: string;
}

interface SourceEntry {
  key: string;              // dedup key (filename or url)
  file?: string;            // relative path under the volume, e.g. 'kb-sources/foo.pdf'
  url?: string;
  label: string;            // user-facing display
  title?: string;
  family: string;           // default 'basic' for unclassified entries
  kind?: string;
  size?: number | null;
  mtime?: string;
}

async function readSidecar(): Promise<SidecarFile[]> {
  const p = join(VOLUME_ROOT, 'kb-sources', '_index.json');
  try {
    const raw = await fsp.readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.files) ? parsed.files : [];
  } catch {
    return [];
  }
}

async function listDirectory(): Promise<{ name: string; size: number | null; mtime: string }[]> {
  const dir = join(VOLUME_ROOT, 'kb-sources');
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const out: { name: string; size: number | null; mtime: string }[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
    let size: number | null = null;
    let mtime = '';
    try {
      const s = await fsp.stat(join(dir, ent.name));
      size = s.size; mtime = s.mtime.toISOString();
    } catch { /* ignore */ }
    out.push({ name: ent.name, size, mtime });
  }
  return out;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const [sidecar, files] = await Promise.all([readSidecar(), listDirectory()]);

  // Index sidecar entries by their name / url for fast lookup.
  const byName = new Map<string, SidecarFile>();
  const urlOnly: SidecarFile[] = [];
  for (const s of sidecar) {
    if (s.name) byName.set(s.name, s);
    else if (s.url) urlOnly.push(s);
  }

  const out: SourceEntry[] = [];

  // 1. Files actually present on the volume — sidecar metadata overlays.
  for (const f of files) {
    const meta = byName.get(f.name) ?? {};
    out.push({
      key: f.name,
      file: `kb-sources/${f.name}`,
      label: meta.title ?? f.name,
      title: meta.title,
      family: meta.family ?? 'basic',
      kind: meta.kind,
      size: f.size,
      mtime: f.mtime,
    });
  }

  // 2. URL-only entries from the sidecar — no local file, link out.
  for (const s of urlOnly) {
    if (!s.url) continue;
    out.push({
      key: s.url,
      url: s.url,
      label: s.title ?? new URL(s.url).host,
      title: s.title,
      family: s.family ?? 'basic',
      kind: s.kind,
    });
  }

  return json({ sources: out });
};
