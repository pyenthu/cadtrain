// src/lib/appkit/verbs/mutate.ts — the `mutate` verbs (edit a bound doc).
// addRow/setParam reuse the #77 list<record> machinery (parts_map) — a well's
// casings/completions/survey are list<record> params. Handlers pending until the
// doc Ctx is wired.
import type { Verb } from './registry';

const pending =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`appkit: verb "${name}" not wired yet (doc ctx pending)`);
  };

export const MUTATE_VERBS: Verb[] = [
  {
    name: 'setParam',
    group: 'mutate',
    desc: 'Set a scalar param (or a list<record> cell) on a document. Returns { ok }.',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' }, value: {} },
      required: ['id', 'name', 'value'],
    },
    handler: pending('setParam'),
  },
  {
    name: 'addRow',
    group: 'mutate',
    desc: 'Append a record to a list<record> param (e.g. a casing/completion row). Returns { ok, index }.',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, list: { type: 'string' }, row: { type: 'object' } },
      required: ['id', 'list', 'row'],
    },
    handler: pending('addRow'),
  },
  {
    name: 'removeRow',
    group: 'mutate',
    desc: 'Remove a record from a list<record> param by index.',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, list: { type: 'string' }, index: { type: 'number' } },
      required: ['id', 'list', 'index'],
    },
    handler: pending('removeRow'),
  },
  {
    name: 'reorderRow',
    group: 'mutate',
    desc: 'Move a list<record> row from one index to another.',
    params: {
      type: 'object',
      properties: {
        id: { type: 'string' }, list: { type: 'string' },
        from: { type: 'number' }, to: { type: 'number' },
      },
      required: ['id', 'list', 'from', 'to'],
    },
    handler: pending('reorderRow'),
  },
  {
    name: 'patchDoc',
    group: 'mutate',
    desc: 'Patch a document JSON: op="set|push|remove", path (dotted), value.',
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, op: { type: 'string' }, path: { type: 'string' }, value: {} },
      required: ['id', 'op', 'path'],
    },
    handler: pending('patchDoc'),
  },
];
