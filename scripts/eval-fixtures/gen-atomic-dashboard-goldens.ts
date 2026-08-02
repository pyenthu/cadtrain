// Prototype: slice the full-app dashboard goldens into ATOMIC per-component golden pairs so the
// small local model retrieves JUST the relevant component per prompt (not the whole app, which it
// over-copied — dropping the data vars). Writes locally (source of truth) + PUTs to the volume,
// and DELETEs the full-app partsdash/opsdash .md retrieval keys (kept locally as backup) so the
// atomic goldens are what gets retrieved. Reversible: re-PUT the .md to restore.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/neerajsethi/code/cadtrain';
const GOLD_LOCAL = join(ROOT, 'scripts/eval-fixtures/golden');
const ATOM_LOCAL = join(GOLD_LOCAL, 'atomic'); // local source-of-truth mirror
mkdirSync(ATOM_LOCAL, { recursive: true });
const BASE = 'http://localhost:3333';

const pd = JSON.parse(readFileSync(join(GOLD_LOCAL, 'partsdash.app'), 'utf8'));
const od = JSON.parse(readFileSync(join(GOLD_LOCAL, 'opsdash.app'), 'utf8'));
const panel = (app: any, id: string) => app.panels.find((p: any) => p.id === id);

const DT = 'dashboard';
// name → { md (retrieval key, mirrors the atomic prompt), app (minimal docType-tagged slice) }
const atoms: Record<string, { md: string; app: any }> = {
  'atom-dash-create': {
    md: 'Create a dashboard app with a title, docType dashboard.',
    app: { app: 'dash', title: 'Dashboard', docType: DT, panels: [] },
  },
  'atom-dash-theme': {
    md: 'Use a light theme with an accent colour.',
    app: { docType: DT, theme: pd.theme, panels: [] },
  },
  'atom-dash-heading': {
    md: 'Add a level-1 heading.',
    app: { docType: DT, panels: [panel(pd, 'title')] },
  },
  'atom-dash-subtitle': {
    md: 'Add a small muted subtitle.',
    app: { docType: DT, panels: [panel(pd, 'sub')] },
  },
  'atom-dash-struct-part': {
    md: 'Define a record structure with named typed fields.',
    app: { docType: DT, structures: pd.structures, panels: [] },
  },
  'atom-dash-var-parts': {
    md: 'Seed a parts variable with a list of part records with id, category, verts, tris.',
    app: { docType: DT, vars: { parts: pd.vars.parts }, panels: [] },
  },
  'atom-dash-var-months': {
    md: 'Seed a months variable with a list of monthly records with month, revenue, orders.',
    app: { docType: DT, vars: { months: od.vars.months }, panels: [] },
  },
  'atom-dash-statgrid': {
    md: 'Add a stat grid.',
    app: { docType: DT, panels: [{ id: 'kpis', kind: 'statgrid', props: panel(pd, 'kpis').props, children: [] }] },
  },
  'atom-dash-stat': {
    md: 'Inside the stat grid add a KPI tile with a label and a value (optionally a currency/compact format and an up/down delta).',
    app: { docType: DT, panels: [{ id: 'kpis', kind: 'statgrid', props: panel(od, 'kpis').props, children: [panel(od, 'kpis').children[0]] }] },
  },
  'atom-dash-chart-bar': {
    md: 'Add a bar chart titled ... reading the parts variable, x = id, y = tris.',
    app: { docType: DT, panels: [panel(pd, 'trischart')] },
  },
  'atom-dash-chart-line': {
    md: 'Add a line chart titled ... reading the months variable, x = month, y = revenue.',
    app: { docType: DT, panels: [panel(od, 'revchart')] },
  },
  'atom-dash-datatable': {
    md: 'Add a data table reading a variable with columns, search, sorting and totals.',
    app: { docType: DT, panels: [panel(pd, 'partstable')] },
  },
  'atom-dash-cad3d': {
    md: 'Add a 3D CAD viewer of a named part.',
    app: { docType: DT, panels: [panel(pd, 'viewer')] },
  },
};

async function put(path: string, body: string, ct: string) {
  const r = await fetch(`${BASE}/api/volume?path=${encodeURIComponent(path)}`, {
    method: 'PUT', headers: { 'content-type': ct }, body,
  });
  return r.status;
}
async function del(path: string) {
  const r = await fetch(`${BASE}/api/volume?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  return r.status;
}

let n = 0;
for (const [name, { md, app }] of Object.entries(atoms)) {
  const appTxt = `${JSON.stringify(app, null, 2)}\n`;
  writeFileSync(join(ATOM_LOCAL, `${name}.app`), appTxt);
  writeFileSync(join(ATOM_LOCAL, `${name}.md`), `${md}\n`);
  const s1 = await put(`ai/app-rag/golden/${name}.app`, appTxt, 'application/json');
  const s2 = await put(`ai/app-rag/golden/${name}.md`, `${md}\n`, 'text/markdown');
  console.log(`${name}: app ${s1} · md ${s2}  [${app.panels?.length ?? 0}p ${app.vars ? Object.keys(app.vars).join(',') : ''}${app.theme ? 'theme' : ''}${app.structures ? 'struct' : ''}]`);
  n++;
}
// Remove the full-app dashboard .md keys from RETRIEVAL (the .app scoring targets stay). Backed up
// locally in scripts/eval-fixtures/golden/{partsdash,opsdash}.md — re-PUT to restore.
for (const id of ['partsdash', 'opsdash']) {
  const s = await del(`ai/app-rag/golden/${id}.md`);
  console.log(`DELETE ${id}.md (full-app key) -> ${s}`);
}
console.log(`\n${n} atomic goldens written + uploaded.`);
