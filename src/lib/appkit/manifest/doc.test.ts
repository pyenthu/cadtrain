import { describe, it, expect } from 'vitest';
import { autoDoc } from './doc';

describe('autoDoc (manifest MD summary — feeds the RAG)', () => {
  it('summarizes title, data files, panels, controls', () => {
    const md = autoDoc({
      app: 'wells',
      title: 'Well Designer',
      docType: 'well',
      files: [{ slot: 'well', type: '.wson', label: 'Well' }],
      panels: [
        { id: 'list', kind: 'list', title: 'Wells', source: { verb: 'listDocs' } },
        { id: 'params', kind: 'form', title: 'Params', controls: [{ kind: 'table', bind: 'casings' }] },
      ],
    });
    expect(md).toContain('# Well Designer');
    expect(md).toContain('## Data files');
    expect(md).toContain('`well`');
    expect(md).toContain('**Wells** (`list`) — source `listDocs`');
    expect(md).toContain('table bound to `casings`');
  });

  it('handles an empty app', () => {
    expect(autoDoc({ app: 'x', panels: [] })).toContain('_(no panels yet)_');
  });
});
