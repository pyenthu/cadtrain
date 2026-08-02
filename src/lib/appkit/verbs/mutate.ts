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
    desc:
      'Set a scalar param on a document (or one cell of a list<record> param). Use for edit forms + ' +
      'controls that write a single value back to the bound doc. Returns { ok }.',
    example: { args: { id: '$active', name: 'length', value: 120 }, note: 'set the length param on the active doc' },
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
    desc:
      'Append a record (row) to a list<record> param — e.g. add a casing/completion/survey row to a well. ' +
      'Wire an "Add row" button to it. Returns { ok, index }.',
    example: { args: { id: '$active', list: 'casings', row: { od: 9.625, top: 0, bottom: 3500 } }, note: 'add a casing row to the well' },
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
    desc: 'Remove a row from a list<record> param by index. Returns { ok }.',
    example: { args: { id: '$active', list: 'casings', index: 2 }, note: 'delete the 3rd casing row' },
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
    desc: 'Move a list<record> row from one index to another. Returns { ok }.',
    example: { args: { id: '$active', list: 'casings', from: 2, to: 0 }, note: 'move a row to the top' },
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
    desc:
      "Patch a bound document's JSON directly: op=\"set|push|remove\", path (dotted), value — for doc " +
      "edits the typed param verbs don't cover. Returns { ok }.",
    example: { args: { id: '$active', op: 'set', path: 'name', value: 'Surface casing' }, note: 'rename the active doc' },
    params: {
      type: 'object',
      properties: { id: { type: 'string' }, op: { type: 'string' }, path: { type: 'string' }, value: {} },
      required: ['id', 'op', 'path'],
    },
    handler: pending('patchDoc'),
  },
];
