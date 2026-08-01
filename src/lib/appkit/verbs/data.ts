// src/lib/appkit/verbs/data.ts — the `data` verbs (read the world for the AI).
// Rung 3: listDocs/getParams/loadDoc/listParts call ctx.engine (INJECTED — a client
// engine over /api/primitives/*, or a server engine in the AI loop). bake is rung 3b.
import type { Verb, Ctx, AppEngine } from './registry';

function engine(ctx: Ctx): AppEngine {
  if (!ctx.engine) throw new Error('appkit: verb needs an engine (ctx.engine not injected)');
  return ctx.engine;
}

const pending =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`appkit: verb "${name}" not wired yet`);
  };

export const DATA_VERBS: Verb[] = [
  {
    name: 'readVar',
    group: 'data',
    desc:
      "Read an app-level variable (app.vars[name]) — the seed-data bridge. Lets a data component " +
      "(grid/list) SOURCE its rows from a seeded list<record> variable, e.g. source " +
      "{ verb:'readVar', args:{ name:'tasks' } }. Returns the value (often an array of records); " +
      "an empty array if the variable is absent. No engine needed — reads the live .app.",
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    returns: { type: 'array' },
    handler: (a: { name: string }, ctx) => {
      const vars = (ctx.appStore as { vars?: Record<string, unknown> } | undefined)?.vars;
      const v = vars?.[a?.name];
      return v === undefined ? [] : v;
    },
  },
  {
    name: 'listDocs',
    group: 'data',
    desc: 'List available documents of a type. Returns [{id, title}].',
    params: {
      type: 'object',
      properties: { docType: { type: 'string', description: 'Filter by doc type, e.g. "well".' } },
    },
    returns: { type: 'array' },
    handler: async (a: { docType?: string }, ctx) =>
      (await engine(ctx).list({ docType: a?.docType })).map((d) => ({ id: d.id, title: d.name ?? d.id })),
  },
  {
    name: 'loadDoc',
    group: 'data',
    desc: 'Load a document by id. Returns { id, params }.',
    params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (a: { id: string }, ctx) => {
      const d = (await engine(ctx).list()).find((x) => x.id === a.id);
      if (!d) throw new Error(`appkit: no doc "${a.id}"`);
      return { id: d.id, params: d.params ?? {} };
    },
  },
  {
    name: 'getParams',
    group: 'data',
    desc: "Get a document's params (name→value; list<record> for wells casings/completions/survey).",
    params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (a: { id: string }, ctx) => {
      const d = (await engine(ctx).list()).find((x) => x.id === a.id);
      if (!d) throw new Error(`appkit: no doc "${a.id}"`);
      return d.params ?? {};
    },
  },
  {
    name: 'bake',
    group: 'data',
    desc: 'Bake a document with params → geometry stats { verts, tris }.',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, params: { type: 'object' } },
      required: ['id'],
    },
    handler: async (a: { id: string; params?: Record<string, unknown> }, ctx) => {
      const e = engine(ctx);
      if (!e.bake) throw new Error('appkit: engine has no bake()');
      return e.bake(a.id, a.params);
    },
  },
  {
    name: 'getSource',
    group: 'data',
    desc: "Get a document's TypeScript source.",
    params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (a: { id: string }, ctx) => {
      const e = engine(ctx);
      if (!e.getSource) throw new Error('appkit: engine has no getSource()');
      return e.getSource(a.id);
    },
  },
  {
    name: 'compile',
    group: 'data',
    desc: 'Compile a document → the dep-inlined Manifold script + scriptHash.',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, params: { type: 'object' } },
      required: ['id'],
    },
    handler: async (a: { id: string; params?: Record<string, unknown> }, ctx) => {
      const e = engine(ctx);
      if (!e.compile) throw new Error('appkit: engine has no compile()');
      return e.compile(a.id, a.params);
    },
  },
  {
    name: 'bakeGeo',
    group: 'data',
    desc:
      'Bake a CAD part by id → the SERIALIZED renderable MESH ({ full, cutVC } vertex-coloured ' +
      'geometry) for the interactive 3D viewer (the cad3d component sources its geometry from this). ' +
      'Unlike `bake` (which returns verts/tris STATS only), bakeGeo returns the geometry to draw. ' +
      'The engine + the part source stay SERVER-side (computeMode:server) — only mesh reaches the ' +
      "client. args: { partId, params?, cutaway? }.",
    params: {
      type: 'object',
      properties: {
        partId: { type: 'string' },
        params: { type: 'object', description: 'name→value overrides; defaults fill the rest.' },
        cutaway: { type: 'boolean', description: 'Return the cutaway cross-section too.' },
      },
      required: ['partId'],
    },
    handler: async (a: { partId: string; params?: Record<string, unknown>; cutaway?: boolean }, ctx) => {
      const e = engine(ctx);
      if (!e.bakeGeo) throw new Error('appkit: engine has no bakeGeo()');
      return e.bakeGeo(a.partId, a.params, a.cutaway);
    },
  },
  {
    name: 'listParts',
    group: 'data',
    desc: 'List volume parts, optionally filtered by category. Returns [{id, meta}].',
    params: { type: 'object', properties: { category: { type: 'string' } } },
    handler: async (a: { category?: string }, ctx) =>
      (await engine(ctx).list({ category: a?.category })).map((d) => ({ id: d.id, meta: { name: d.name } })),
  },
];
