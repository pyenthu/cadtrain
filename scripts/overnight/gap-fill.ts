#!/usr/bin/env bun
/**
 * scripts/overnight/gap-fill.ts — RAG factory step: fill retrieval holes with a FEW candidates.
 *
 * Replaces the old hour-bounded `claude --print` corpus spray (#49).
 *   1. Asks Ollama for N small .app JSON drafts for a target docType / gap prompt
 *   2. validateManifest — reject junk
 *   3. Near-dup skip (panel-kind signature vs existing staged + seed goldens)
 *   4. Stage full candidate + ATOMIC pieces under an OUT corpus dir (local only by default)
 *
 *   bun run scripts/overnight/gap-fill.ts \
 *     --out scripts/overnight/runs/trial-corpus \
 *     --docType dashboard \
 *     --gap "ops dashboard with KPI stats, a line chart, and a data table with vars" \
 *     --max 3
 *
 * NEVER writes the shared prod volume. Point CADTRAIN_APP_CORPUS at --out to eval against it.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateManifest } from '../../src/lib/appkit/manifest/validate';

/** Local copy of decomposeToAtomicGoldens — avoids importing app-corpus.ts (pulls $env via the store). */
function docTypeOf(app: unknown): string | undefined {
  const d = (app as any)?.docType;
  return typeof d === 'string' && d.trim() ? d.trim() : undefined;
}
function decomposeToAtomicGoldens(app: any, opts: { base?: string } = {}): Array<{ name: string; md: string; app: any }> {
  const dt = docTypeOf(app);
  const base = (opts.base || app?.app || app?.title || 'app').toString().replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  const tag: Record<string, unknown> = dt ? { docType: dt } : {};
  const out: Array<{ name: string; md: string; app: any }> = [];
  if (app?.title || dt) {
    out.push({
      name: `${base}-meta`,
      md: `Create ${dt ? `a ${dt} app` : 'an app'}${app?.title ? ` titled "${app.title}"` : ''}${dt ? `, docType ${dt}` : ''}.`,
      app: { ...(app?.app ? { app: app.app } : {}), ...(app?.title ? { title: app.title } : {}), ...tag, panels: [] },
    });
  }
  if (app?.theme) out.push({ name: `${base}-theme`, md: `Set theme ${JSON.stringify(app.theme)}.`, app: { ...tag, theme: app.theme, panels: [] } });
  for (const [n, fields] of Object.entries(app?.structures ?? {})) {
    const fnames = Array.isArray(fields) ? fields.map((f: any) => f?.name).filter(Boolean) : [];
    out.push({ name: `${base}-struct-${n}`, md: `Define a ${n} structure with fields ${fnames.join(', ')}.`, app: { ...tag, structures: { [n]: fields }, panels: [] } });
  }
  for (const [n, v] of Object.entries(app?.vars ?? {})) {
    out.push({ name: `${base}-var-${n}`, md: `Define var ${n}.`, app: { ...tag, vars: { [n]: v }, panels: [] } });
  }
  for (const p of (app?.panels ?? []) as any[]) {
    out.push({
      name: `${base}-${p.kind}-${p.id}`.replace(/[^a-z0-9_-]+/gi, '_'),
      md: `Add a ${p.kind} panel id=${p.id}.`,
      app: { ...tag, panels: [p] },
    });
  }
  return out;
}

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.GAP_FILL_MODEL ?? 'qwen2.5:1.5b';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function kindSig(app: any): string {
  const kinds = ((app?.panels ?? []) as any[]).map((p) => p?.kind ?? '?').sort();
  return `${app?.docType ?? '?'}|${kinds.join(',')}`;
}

async function loadExistingSigs(goldenDir: string): Promise<Set<string>> {
  const out = new Set<string>();
  let names: string[] = [];
  try {
    names = (await readdir(goldenDir)).filter((f) => f.endsWith('.app')).map((f) => f.slice(0, -4));
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const app = JSON.parse(await readFile(join(goldenDir, `${n}.app`), 'utf8'));
      out.add(kindSig(app));
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

async function ollamaJson(prompt: string): Promise<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0.7, num_predict: 1200 },
      messages: [
        {
          role: 'system',
          content:
            'You emit ONLY a minimal cadtrain .app JSON object. No prose. Shape: {"app":slug,"title":str,"docType":str,"theme"?:{mode,accent},"vars"?:{name:[rows]},"structures"?:{name:[{name,type}]},"panels":[{"id":slug,"kind":str,"props"?:{},"source"?:{verb,args},"children"?:[]}]}. Use real kinds: heading,text,statgrid,stat,chart,datatable,list,form,tabs,cad3d. Keep it small and valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { message?: { content?: string } };
  return j.message?.content ?? '';
}

function stripFences(s: string): string {
  return s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
}

async function main() {
  const outRoot = flag('--out') ?? 'scripts/overnight/runs/trial-corpus';
  const docType = flag('--docType') ?? 'dashboard';
  const gap =
    flag('--gap') ??
    'an operations dashboard with three KPI stat tiles, a line chart, a data table, and named vars for the rows';
  const max = Math.max(1, Math.min(10, Number(flag('--max') ?? '3') || 3));
  const candDir = join(outRoot, 'candidates');
  const goldenDir = join(outRoot, 'golden');
  await mkdir(candDir, { recursive: true });
  await mkdir(goldenDir, { recursive: true });

  const sigs = await loadExistingSigs(goldenDir);
  console.log(`[gap-fill] model=${MODEL} docType=${docType} max=${max} out=${outRoot}`);
  console.log(`[gap-fill] existing golden sigs: ${sigs.size}`);

  let kept = 0;
  let attempts = 0;
  const budget = max * 4; // allow a few rejects
  while (kept < max && attempts < budget) {
    attempts++;
    const prompt = `Build a ${docType} .app for: ${gap}. docType MUST be "${docType}".`;
    let raw: string;
    try {
      raw = await ollamaJson(prompt);
    } catch (e) {
      console.log(`[gap-fill] SKIP ollama: ${String((e as Error).message ?? e).slice(0, 80)}`);
      continue;
    }
    let app: any;
    try {
      app = JSON.parse(stripFences(raw));
    } catch (e) {
      console.log(`[gap-fill] SKIP parse: ${String((e as Error).message ?? e).slice(0, 60)}`);
      continue;
    }
    const v = validateManifest(app);
    if (!v.ok) {
      console.log(`[gap-fill] SKIP invalid: ${v.errors.join('; ').slice(0, 80)}`);
      continue;
    }
    app = v.app;
    if ((app as any).docType !== docType) {
      console.log(`[gap-fill] SKIP wrong docType ${(app as any).docType}`);
      continue;
    }
    const sig = kindSig(app);
    if (sigs.has(sig)) {
      console.log(`[gap-fill] SKIP near-dup ${sig}`);
      continue;
    }
    sigs.add(sig);
    const base = String(app.app || app.title || 'gap')
      .replace(/[^a-z0-9_-]+/gi, '_')
      .toLowerCase()
      .slice(0, 40);
    const stamp = `${base}-${Date.now()}`;
    await writeFile(join(candDir, `${stamp}.app.json`), `${JSON.stringify(app, null, 2)}\n`);
    const pieces = decomposeToAtomicGoldens(app, { base: `trial-${base}` });
    for (const p of pieces) {
      const safe = p.name.replace(/[^a-z0-9_-]+/gi, '_');
      await writeFile(join(goldenDir, `${safe}.app`), `${JSON.stringify(p.app, null, 2)}\n`);
      await writeFile(join(goldenDir, `${safe}.md`), p.md.endsWith('\n') ? p.md : `${p.md}\n`);
    }
    kept++;
    console.log(`[gap-fill] OK ${kept}/${max} ${stamp} → ${pieces.length} atoms  (${sig})`);
  }
  console.log(`[gap-fill] DONE kept=${kept} attempts=${attempts}`);
  if (kept === 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
