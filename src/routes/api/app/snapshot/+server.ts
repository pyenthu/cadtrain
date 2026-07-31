// POST /api/app/snapshot  { id, app, prompt?, steps? } — save a NUMBERED version snapshot of an
// app under <appsDir>/versions/<id>.<n>.app.json and append a row to <id>.history.md, so a
// prompt-by-prompt build becomes a studyable trail (prompt ↔ version). `n` auto-increments from
// the existing snapshots. Versions live in a `versions/` subdir so they never pollute the app
// picker (listApps reads only the top dir). Atomic write (temp+rename, Rule 4).
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { writeFile, rename, mkdir, readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { appsDir } from '$lib/server/app-paths';
import { validateManifest } from '$lib/appkit/manifest/validate';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { id?: string; app?: unknown; prompt?: string; steps?: number }
    | null;
  if (!body?.id || !body.app) throw error(400, 'missing id or app');
  const id = String(body.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const res = validateManifest(body.app);
  if (!res.ok) throw error(422, res.errors.join('; '));

  const vdir = join(appsDir(), 'versions');
  await mkdir(vdir, { recursive: true });

  // next version = 1 + highest existing <id>.<k>.app.json
  const re = new RegExp(`^${id}\\.(\\d+)\\.app\\.json$`);
  let maxN = 0;
  try {
    for (const f of await readdir(vdir)) {
      const m = f.match(re);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
  } catch {
    /* fresh versions dir */
  }
  const n = maxN + 1;

  const file = join(vdir, `${id}.${n}.app.json`);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(res.app, null, 2)}\n`, 'utf8');
  await rename(tmp, file);

  // append the prompt ↔ version row to the history doc
  const hist = join(vdir, `${id}.history.md`);
  if (!existsSync(hist)) {
    await writeFile(
      hist,
      `# ${id} — build history (prompt ↔ version)\n\n` +
        `Each row is one prompt that produced a version snapshot (\`versions/${id}.<n>.app.json\`), ` +
        `so you can diff a prompt's effect version-to-version.\n\n` +
        `| v | panels | vars | prompt |\n|---|--------|------|--------|\n`,
      'utf8',
    );
  }
  const app = res.app as { panels?: unknown[]; vars?: Record<string, unknown> };
  const panels = Array.isArray(app.panels) ? app.panels.length : 0;
  const vars = app.vars ? Object.keys(app.vars).length : 0;
  const prompt = (body.prompt ?? '').replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').trim();
  await appendFile(hist, `| ${n} | ${panels} | ${vars} | ${prompt || '—'} |\n`, 'utf8');

  return json({ ok: true, n, file: `versions/${id}.${n}.app.json` });
};
