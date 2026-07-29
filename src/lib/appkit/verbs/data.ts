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
    name: 'listParts',
    group: 'data',
    desc: 'List volume parts, optionally filtered by category. Returns [{id, meta}].',
    params: { type: 'object', properties: { category: { type: 'string' } } },
    handler: async (a: { category?: string }, ctx) =>
      (await engine(ctx).list({ category: a?.category })).map((d) => ({ id: d.id, meta: { name: d.name } })),
  },
];
