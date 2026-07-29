// src/lib/appkit/verbs/gui.ts — the `gui` verbs (build/patch the .app itself).
// These are the "AI adds panels/popovers dynamically" verbs. Several run fully
// HEADLESS today (they only touch ctx.appStore — the live, self-contained .app),
// which is what rung 1 proves.
import type { Verb, Ctx, AppDoc } from './registry';

/** Panel kinds the harness can render (Layer 4 registry). The AI may only COMPOSE
 *  these — the D1/D5 safety boundary (it never invents a new kind). */
export const PANEL_KINDS = ['list', 'form', 'table', 'bake3d', 'svg', 'text', 'chat', 'container', 'card'] as const;

const pending =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`appkit: verb "${name}" not wired yet`);
  };

function requireApp(ctx: Ctx): AppDoc {
  if (!ctx.appStore) throw new Error('appkit: no active .app (ctx.appStore is undefined)');
  return ctx.appStore;
}

/** Minimal JSON patch by dotted path — set | push | remove. Dependency-free; the
 *  eventual patchDoc impl shares this shape. */
function applyPatch(root: AppDoc, op: string, path: string, value: unknown): void {
  const keys = path.split('.');
  let node: any = root;
  for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]] ??= {};
  const last = keys[keys.length - 1];
  if (op === 'set') node[last] = value;
  else if (op === 'push') (node[last] ??= []).push(value);
  else if (op === 'remove') {
    if (Array.isArray(node[last])) node[last].splice(Number(value), 1);
    else delete node[last];
  } else throw new Error(`appkit: unknown patch op "${op}"`);
}

export const GUI_VERBS: Verb[] = [
  {
    name: 'listPanelKinds',
    group: 'gui',
    desc: 'List the panel kinds the harness can render. Returns [{kind}].',
    params: { type: 'object', properties: {} },
    returns: { type: 'array' },
    handler: () => PANEL_KINDS.map((kind) => ({ kind })),
  },
  {
    name: 'definePanel',
    group: 'gui',
    desc: 'Append a panel to the .app: { id, kind, source?, controls? }. Returns { ok }.',
    params: { type: 'object', properties: { panel: { type: 'object' } }, required: ['panel'] },
    handler: (a: { panel: Record<string, unknown> }, ctx) => {
      const app = requireApp(ctx);
      (app.panels ??= []).push(a.panel);
      return { ok: true };
    },
  },
  {
    name: 'addControl',
    group: 'gui',
    desc: 'Add a control to a panel (by panelId). Returns { ok }.',
    params: {
      type: 'object',
      properties: { panelId: { type: 'string' }, control: { type: 'object' } },
      required: ['panelId', 'control'],
    },
    handler: (a: { panelId: string; control: Record<string, unknown> }, ctx) => {
      const app = requireApp(ctx);
      const panel = (app.panels ?? []).find((p) => (p as any).id === a.panelId) as any;
      if (!panel) throw new Error(`appkit: no panel "${a.panelId}"`);
      (panel.controls ??= []).push(a.control);
      return { ok: true };
    },
  },
  {
    name: 'removePanel',
    group: 'gui',
    desc: 'Remove a panel from the .app by id.',
    params: { type: 'object', properties: { panelId: { type: 'string' } }, required: ['panelId'] },
    handler: (a: { panelId: string }, ctx) => {
      const app = requireApp(ctx);
      app.panels = (app.panels ?? []).filter((p: any) => p.id !== a.panelId);
      return { ok: true };
    },
  },
  {
    name: 'movePanel',
    group: 'gui',
    desc: 'Reorder a panel to a new 0-based index.',
    params: {
      type: 'object',
      properties: { panelId: { type: 'string' }, to: { type: 'number' } },
      required: ['panelId', 'to'],
    },
    handler: (a: { panelId: string; to: number }, ctx) => {
      const app = requireApp(ctx);
      const ps = (app.panels ?? []) as any[];
      const i = ps.findIndex((p) => p.id === a.panelId);
      if (i < 0) throw new Error(`appkit: no panel "${a.panelId}"`);
      const [p] = ps.splice(i, 1);
      ps.splice(Math.max(0, Math.min(a.to, ps.length)), 0, p);
      app.panels = ps;
      return { ok: true };
    },
  },
  {
    name: 'setPanelProp',
    group: 'gui',
    desc: 'Set a property on a panel (e.g. title, text, kind).',
    params: {
      type: 'object',
      properties: { panelId: { type: 'string' }, key: { type: 'string' }, value: {} },
      required: ['panelId', 'key', 'value'],
    },
    handler: (a: { panelId: string; key: string; value: unknown }, ctx) => {
      const app = requireApp(ctx);
      const p = ((app.panels ?? []) as any[]).find((x) => x.id === a.panelId);
      if (!p) throw new Error(`appkit: no panel "${a.panelId}"`);
      p[a.key] = a.value;
      return { ok: true };
    },
  },
  {
    name: 'setAppMeta',
    group: 'gui',
    desc: 'Set the app title and/or docType.',
    params: { type: 'object', properties: { title: { type: 'string' }, docType: { type: 'string' } } },
    handler: (a: { title?: string; docType?: string }, ctx) => {
      const app = requireApp(ctx);
      if (a.title != null) app.title = a.title;
      if (a.docType != null) app.docType = a.docType;
      return { ok: true };
    },
  },
  {
    name: 'bindAction',
    group: 'gui',
    desc: 'Bind a control (by controlId) to a verb + args.',
    params: {
      type: 'object',
      properties: { controlId: { type: 'string' }, verb: { type: 'string' }, args: { type: 'object' } },
      required: ['controlId', 'verb'],
    },
    handler: pending('bindAction'),
  },
  {
    name: 'patchApp',
    group: 'gui',
    desc: 'Patch the .app JSON directly: op="set|push|remove", path (dotted, e.g. "popovers"), value.',
    params: {
      type: 'object',
      properties: { op: { type: 'string' }, path: { type: 'string' }, value: {} },
      required: ['op', 'path'],
    },
    handler: (a: { op: string; path: string; value?: unknown }, ctx) => {
      applyPatch(requireApp(ctx), a.op, a.path, a.value);
      return { ok: true };
    },
  },
];
