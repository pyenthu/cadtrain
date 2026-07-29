// src/lib/appkit/verbs/data.ts — the `data` verbs (read the world for the AI).
// Handlers are `pending` until the doc/engine Ctx is wired (Layer 3 + the HTTP
// projection); the SHAPES (name/desc/params) are the durable AI contract.
import type { Verb } from './registry';

const pending =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`appkit: verb "${name}" not wired yet (engine/doc ctx pending)`);
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
    handler: pending('listDocs'),
  },
  {
    name: 'loadDoc',
    group: 'data',
    desc: 'Load a document by id. Returns { graph, params }.',
    params: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id.' } },
      required: ['id'],
    },
    handler: pending('loadDoc'),
  },
  {
    name: 'getParams',
    group: 'data',
    desc: "Get a document's params (name→value; list<record> for wells casings/completions/survey).",
    params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: pending('getParams'),
  },
  {
    name: 'bake',
    group: 'data',
    desc: 'Bake a document with params → geometry + stats (via the engine).',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, params: { type: 'object' } },
      required: ['id'],
    },
    handler: pending('bake'),
  },
  {
    name: 'listParts',
    group: 'data',
    desc: 'List volume parts, optionally filtered by category. Returns [{id, meta}].',
    params: { type: 'object', properties: { category: { type: 'string' } } },
    handler: pending('listParts'),
  },
];
