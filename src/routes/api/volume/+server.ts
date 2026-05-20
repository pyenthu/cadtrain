/**
 * /api/volume — generic CRUD against the persistent data volume.
 *
 *   GET    /api/volume                       → tree of the root
 *   GET    /api/volume?path=kb-sources       → tree of a subdirectory
 *   GET    /api/volume?path=kb-sources/x.pdf → stream the file
 *   PUT    /api/volume?path=kb-sources/x.pdf body=raw bytes → write file
 *   DELETE /api/volume?path=kb-sources/x.pdf → remove file
 *   POST   /api/volume?path=newdir&action=mkdir → create directory
 *
 * Root + auth + proxy logic lives in `$lib/server/volume.ts`.
 *
 * Local dev → prod volume: when `CADTRAIN_VOLUME_REMOTE_URL` is set
 * (typically only in `.env.local`), every request transparently proxies
 * to the production app, which then talks to the Railway-mounted volume.
 * Same APIs, same code paths, single source of truth.
 */

import { json, error } from '@sveltejs/kit';
import { promises as fsp, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { basename, dirname, join, relative, extname } from 'node:path';
import type { RequestHandler } from './$types';
import { VOLUME_ROOT, safeVolumePath, checkVolumeAuth, maybeProxy } from '$lib/server/volume';

interface FileNode  { name: string; type: 'file'; id: string; size: number | null }
interface DirNode   { name: string; type: 'dir';  id: string; children: Record<string, FileNode | DirNode> }

/** Best-effort content type by extension. The volume serves arbitrary
 *  files; for the common image/json/pdf cases we set a real type so
 *  <img> tags and fetch().json() work without byte-sniffing. Everything
 *  else falls back to application/octet-stream. */
const TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ts': 'text/plain; charset=utf-8',
};
function contentTypeFor(path: string): string {
  return TYPE_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function buildNode(absPath: string, name: string, depth = 0, maxDepth = 1): Promise<DirNode> {
  const relPath = relative(VOLUME_ROOT, absPath) || '';
  const node: DirNode = { name, type: 'dir', id: relPath, children: {} };
  if (depth >= maxDepth) return node;

  let entries;
  try { entries = await fsp.readdir(absPath, { withFileTypes: true }); }
  catch (e: any) {
    if (e?.code === 'ENOENT') return node;
    throw e;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const ent of entries) {
    if (ent.name === 'lost+found') continue;
    const childAbs = join(absPath, ent.name);
    const childRel = relative(VOLUME_ROOT, childAbs);
    if (ent.isDirectory()) {
      node.children[ent.name] = await buildNode(childAbs, ent.name, depth + 1, maxDepth);
    } else if (ent.isFile()) {
      let size: number | null = null;
      try { size = (await fsp.stat(childAbs)).size; } catch { /* ignore */ }
      node.children[ent.name] = { name: ent.name, type: 'file', id: childRel, size };
    }
  }
  return node;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const userPath = url.searchParams.get('path') || '';
  const abs = safeVolumePath(userPath);

  let stat;
  try { stat = await fsp.stat(abs); }
  catch (e: any) {
    if (e?.code === 'ENOENT' && userPath === '') {
      return json({ name: '', type: 'dir', id: '', children: {} });
    }
    if (e?.code === 'ENOENT') throw error(404, `Not found: ${userPath}`);
    throw error(500, e?.message ?? String(e));
  }

  if (stat.isFile()) {
    const rangeHeader = request.headers.get('range');
    const total = stat.size;
    const headers: Record<string, string> = {
      'Content-Type': contentTypeFor(abs),
      'Cache-Control': 'private, max-age=60',
      'Accept-Ranges': 'bytes',
    };
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : total - 1;
        const length = end - start + 1;
        const stream = createReadStream(abs, { start, end });
        headers['Content-Range']  = `bytes ${start}-${end}/${total}`;
        headers['Content-Length'] = String(length);
        return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
      }
    }
    headers['Content-Length'] = String(total);
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { status: 200, headers });
  }

  if (stat.isDirectory()) {
    const node = await buildNode(abs, basename(abs) || '', 0, 1);
    return json(node);
  }

  throw error(415, `Unsupported path type: ${userPath}`);
};

export const PUT: RequestHandler = async ({ request, url }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const userPath = url.searchParams.get('path');
  if (!userPath) throw error(400, 'path query param is required');
  const abs = safeVolumePath(userPath);

  await fsp.mkdir(dirname(abs), { recursive: true });
  const buf = Buffer.from(await request.arrayBuffer());
  await fsp.writeFile(abs, buf);
  const stat = await fsp.stat(abs);
  return json({ ok: true, path: relative(VOLUME_ROOT, abs), size: stat.size });
};

export const DELETE: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const userPath = url.searchParams.get('path');
  if (!userPath) throw error(400, 'path query param is required');
  const abs = safeVolumePath(userPath);
  if (abs === VOLUME_ROOT) throw error(400, 'Refusing to delete the volume root');

  let stat;
  try { stat = await fsp.stat(abs); }
  catch (e: any) {
    if (e?.code === 'ENOENT') return new Response(null, { status: 204 });
    throw error(500, e?.message ?? String(e));
  }

  // Guard: protect top-level volume directories (archive / components /
  // primitives / training / …) — a single-segment relative path that
  // resolves to a directory IS a top-level dir. Allow removal ONLY when
  // it's EMPTY (cleanup of a retired dir, e.g. library/ after the rename);
  // refuse if it still holds data so a stray UI/curl click can't nuke a
  // live store. Nested files/dirs delete normally. (UI hides the control
  // for top-level dirs too; this also guards curl/script + proxied prod.)
  const relForGuard = relative(VOLUME_ROOT, abs);
  if (stat.isDirectory() && relForGuard && !/[\\/]/.test(relForGuard)) {
    let kids: string[];
    try { kids = await fsp.readdir(abs); }
    catch { kids = ['?']; /* unreadable → treat as non-empty (refuse) */ }
    if (kids.length > 0) {
      throw error(403, `Refusing to delete non-empty top-level volume directory "${relForGuard}" (${kids.length} entries).`);
    }
  }

  const recursive = url.searchParams.get('recursive') === '1';
  if (stat.isDirectory()) {
    await fsp.rm(abs, { recursive, force: false });
  } else {
    await fsp.unlink(abs);
  }
  return new Response(null, { status: 204 });
};

export const POST: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const action = url.searchParams.get('action') || 'mkdir';
  const userPath = url.searchParams.get('path');
  if (!userPath) throw error(400, 'path query param is required');
  const abs = safeVolumePath(userPath);

  if (action === 'mkdir') {
    await fsp.mkdir(abs, { recursive: true });
    return json({ ok: true, path: relative(VOLUME_ROOT, abs) });
  }
  if (action === 'move') {
    const to = url.searchParams.get('to');
    if (!to) throw error(400, 'to query param is required for move');
    const absTo = safeVolumePath(to);
    await fsp.mkdir(dirname(absTo), { recursive: true });
    await fsp.rename(abs, absTo);
    return json({ ok: true, from: relative(VOLUME_ROOT, abs), to: relative(VOLUME_ROOT, absTo) });
  }
  throw error(400, `Unknown action: ${action}`);
};
