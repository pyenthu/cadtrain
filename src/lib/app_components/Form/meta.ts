// app_components/Form/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Form.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
// This bundle backs TWO kinds: 'form' and 'table' (both rendered by Form.svelte).
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'form',
    name: 'Form',
    description: "A document's params as editable fields + tables (list<record> controls).",
    useWhen:
      "Edit a loaded document's params as labelled fields (with nested list<record> tables) — use for " +
      'a settings/property editor bound to the active doc; NOT for standalone tabular data (use grid/edittable).',
    example: {
      id: 'params',
      kind: 'form',
      controls: [
        { kind: 'field', bind: 'name' },
        { kind: 'table', bind: 'casings', cols: ['od', 'top', 'bot'] },
      ],
    },
    dataMode: 'server',
    group: 'data',
    tags: ['form', 'params', 'fields', 'edit', 'inputs', 'properties', 'settings'],
    wiresTo: ['data', 'mutate'],
  },
  {
    kind: 'table',
    name: 'Table',
    description: 'Tabular rows of a list<record> param with columns; add/edit rows.',
    useWhen:
      'A columnar table of ONE list<record> param on the active doc, with add/edit rows — use when ' +
      'the data is a single repeated-record field; use grid for read-only variable/source rows.',
    example: {
      id: 'rows',
      kind: 'table',
      controls: [{ kind: 'table', bind: 'casings', cols: ['od', 'top', 'bot'] }],
    },
    dataMode: 'server',
    group: 'data',
    tags: ['table', 'grid', 'rows', 'columns', 'spreadsheet', 'records'],
    wiresTo: ['data', 'mutate'],
  },
];
