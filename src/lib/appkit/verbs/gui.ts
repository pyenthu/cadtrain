// src/lib/appkit/verbs/gui.ts — the `gui` verbs (build/patch the .app itself).
// These are the "AI adds panels/popovers dynamically" verbs. Several run fully
// HEADLESS today (they only touch ctx.appStore — the live, self-contained .app),
// which is what rung 1 proves.
import type { Verb, Ctx, AppDoc } from './registry';
import { dedupePanelIds } from '../manifest/validate';
import { promoteComponentProps, storeRefPath, setVarByPath } from '../manifest/promote-props';
import type { AppManifest, Panel } from '../manifest/types';

/** Auto-promote a freshly-added panel's props into the runes store (app.vars) + a structure, and
 *  bind them to $vars refs. Default-on; opt out per-app with app.autoPromoteProps === false. */
const promote = (app: AppDoc, panel: unknown) =>
  promoteComponentProps(app as unknown as AppManifest, panel as Panel);

/** Panel kinds the harness can render (Layer 4 registry). The AI may only COMPOSE
 *  these — the D1/D5 safety boundary (it never invents a new kind). */
export const PANEL_KINDS = ['list', 'form', 'table', 'grid', 'edittable', 'bake3d', 'svg', 'text', 'heading', 'divider', 'chat', 'container', 'card', 'div', 'row', 'col', 'button', 'tabs', 'toolbar', 'file', 'sidebar', 'vtoolbar', 'menu', 'popover', 'tooltip', 'iconbutton', 'gantt', 'wellschematic', 'nodetree'] as const;

const pending =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`appkit: verb "${name}" not wired yet`);
  };

function requireApp(ctx: Ctx): AppDoc {
  if (!ctx.appStore) throw new Error('appkit: no active .app (ctx.appStore is undefined)');
  return ctx.appStore;
}

/** A panel id not already used anywhere in the tree (append -2, -3, … on collision). */
export function uniquePanelId(app: AppDoc, base: string): string {
  if (!findPanel(app, base)) return base;
  let n = 2;
  while (findPanel(app, `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The node whose `.children` array IS the given array (reference match) — the parent. */
function findOwnerOfChildren(app: AppDoc, arr: any[]): any | undefined {
  const walk = (list: any[] | undefined): any => {
    for (const p of list ?? []) {
      if (p?.children === arr) return p;
      if (p?.children) {
        const r = walk(p.children);
        if (r) return r;
      }
    }
    return undefined;
  };
  return walk((app.panels ?? []) as any[]);
}

/** Find a panel by id anywhere in the tree (top-level panels + nested children). */
export function findPanel(app: AppDoc, id: string): any | undefined {
  const walk = (list: any[]): any => {
    for (const p of list ?? []) {
      if (p?.id === id) return p;
      const found = p?.children ? walk(p.children) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  return walk((app.panels ?? []) as any[]);
}

/** The array (+ index) that DIRECTLY contains a panel id — the top-level panels array or
 *  some node's children array. Lets remove/move operate anywhere in the tree. */
function findContainingList(app: AppDoc, id: string): { list: any[]; index: number } | undefined {
  const search = (list: any[] | undefined): { list: any[]; index: number } | undefined => {
    if (!Array.isArray(list)) return undefined;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p?.id === id) return { list, index: i };
      if (p?.children) {
        const r = search(p.children);
        if (r) return r;
      }
    }
    return undefined;
  };
  return search((app.panels ?? []) as any[]);
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
      const panel = a.panel as any;
      panel.id = uniquePanelId(app, String(panel.id ?? 'p')); // never collide (keyed renders + lookups)
      (app.panels ??= []).push(panel);
      promote(app, panel); // props → runes store + inferred structure (default-on)
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
    name: 'addChildPanel',
    group: 'gui',
    desc: 'Append a child panel to a container/card/tabs/toolbar/div (by parentId). Returns { ok }. Nesting = HTML-style encapsulation.',
    params: {
      type: 'object',
      properties: { parentId: { type: 'string' }, panel: { type: 'object' } },
      required: ['parentId', 'panel'],
    },
    handler: (a: { parentId: string; panel: Record<string, unknown> }, ctx) => {
      const app = requireApp(ctx);
      const parent = findPanel(app, a.parentId);
      if (!parent) throw new Error(`appkit: no panel "${a.parentId}"`);
      const panel = a.panel as any;
      panel.id = uniquePanelId(app, String(panel.id ?? 'p'));
      (parent.children ??= []).push(panel);
      promote(app, panel); // props → runes store + inferred structure (default-on)
      return { ok: true };
    },
  },
  {
    name: 'indentPanel',
    group: 'gui',
    desc: 'Demote a panel INTO its previous sibling (append to prevSibling.children). No-op if first in its list.',
    params: { type: 'object', properties: { panelId: { type: 'string' } }, required: ['panelId'] },
    handler: (a: { panelId: string }, ctx) => {
      const loc = findContainingList(requireApp(ctx), a.panelId);
      if (!loc || loc.index === 0) return { ok: true };
      const prev = loc.list[loc.index - 1];
      const [node] = loc.list.splice(loc.index, 1);
      (prev.children ??= []).push(node);
      return { ok: true };
    },
  },
  {
    name: 'outdentPanel',
    group: 'gui',
    desc: 'Promote a panel OUT of its parent (move it just after the parent in the parent\'s list). No-op at top level.',
    params: { type: 'object', properties: { panelId: { type: 'string' } }, required: ['panelId'] },
    handler: (a: { panelId: string }, ctx) => {
      const app = requireApp(ctx);
      const loc = findContainingList(app, a.panelId);
      if (!loc || loc.list === (app.panels as any[])) return { ok: true }; // already top-level
      const parent = findOwnerOfChildren(app, loc.list);
      if (!parent) return { ok: true };
      const parentLoc = findContainingList(app, parent.id);
      if (!parentLoc) return { ok: true };
      const [node] = loc.list.splice(loc.index, 1);
      parentLoc.list.splice(parentLoc.index + 1, 0, node);
      return { ok: true };
    },
  },
  {
    name: 'insertTree',
    group: 'gui',
    desc: 'Insert a cloned subtree (a saved component/template) into the .app — at the root or into a parent by id. Re-ids on insert so nothing collides.',
    params: {
      type: 'object',
      properties: { nodes: { type: 'array' }, parentId: { type: 'string' } },
      required: ['nodes'],
    },
    handler: (a: { nodes: any[]; parentId?: string }, ctx) => {
      const app = requireApp(ctx);
      const clones = JSON.parse(JSON.stringify(a.nodes ?? []));
      if (a.parentId) {
        const parent = findPanel(app, a.parentId);
        if (!parent) throw new Error(`appkit: no panel "${a.parentId}"`);
        (parent.children ??= []).push(...clones);
      } else {
        (app.panels ??= []).push(...clones);
      }
      dedupePanelIds(app); // re-id any collisions from the clone
      return { ok: true };
    },
  },
  {
    name: 'removePanel',
    group: 'gui',
    desc: 'Remove a panel from the .app by id (anywhere in the tree — top-level or nested).',
    params: { type: 'object', properties: { panelId: { type: 'string' } }, required: ['panelId'] },
    handler: (a: { panelId: string }, ctx) => {
      const loc = findContainingList(requireApp(ctx), a.panelId);
      if (loc) loc.list.splice(loc.index, 1);
      return { ok: true };
    },
  },
  {
    name: 'movePanel',
    group: 'gui',
    desc: 'Reorder a panel within its siblings — "to" is the target index in its own list (top-level or nested).',
    params: {
      type: 'object',
      properties: { panelId: { type: 'string' }, to: { type: 'number' } },
      required: ['panelId', 'to'],
    },
    handler: (a: { panelId: string; to: number }, ctx) => {
      const loc = findContainingList(requireApp(ctx), a.panelId);
      if (!loc) throw new Error(`appkit: no panel "${a.panelId}"`);
      const { list, index } = loc;
      const [p] = list.splice(index, 1);
      list.splice(Math.max(0, Math.min(a.to, list.length)), 0, p);
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
      const p = findPanel(app, a.panelId);
      if (!p) throw new Error(`appkit: no panel "${a.panelId}"`);
      p[a.key] = a.value;
      return { ok: true };
    },
  },
  {
    name: 'setComponentProp',
    group: 'gui',
    desc:
      "Set a typed PROP on a component (panel) by id — writes panel.props[name] (text, label, " +
      'columns, align, slot, …). Finds nested children too. A null/undefined value deletes the prop.',
    params: {
      type: 'object',
      properties: { panelId: { type: 'string' }, name: { type: 'string' }, value: {} },
      required: ['panelId', 'name'],
    },
    handler: (a: { panelId: string; name: string; value?: unknown }, ctx) => {
      const app = requireApp(ctx);
      const p = findPanel(app, a.panelId);
      if (!p) throw new Error(`appkit: no panel "${a.panelId}"`);
      p.props ??= {};
      // If the prop is bound to the runes store ($vars.<id>.<key>), write THROUGH to the store —
      // it's the source of truth, so the component + any other reader react (keeps the binding).
      const path = storeRefPath(p.props[a.name]);
      if (path) {
        setVarByPath(app as unknown as AppManifest, path, a.value);
        return { ok: true };
      }
      if (a.value === null || a.value === undefined) delete p.props[a.name];
      else p.props[a.name] = a.value;
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
    desc: 'Patch the .app JSON directly: op="set|push|remove", path (dotted), value. For app-level state the other verbs don\'t cover — SEED DATA: path "vars.<name>" (a scalar / list / list-of-records, read as $vars.<name>); DEFINE A STRUCTURE: path "structures.<name>" value [{name,type},…] (a record schema); theme: path "theme" value {mode,accent}; app id: path "app".',
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
