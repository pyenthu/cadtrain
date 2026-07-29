import { describe, it, expect } from 'vitest';
import { sanitizeApp } from './sanitize';

describe('sanitizeApp (rung 4a hardening)', () => {
  it('strips bindings referencing unknown verbs, keeps known ones', () => {
    const app: any = {
      app: 'x',
      panels: [
        { id: 'a', kind: 'text', text: 'hi', source: { verb: 'static', args: {} } }, // unknown → drop
        { id: 'b', kind: 'list', source: { verb: 'listDocs', args: {} }, onSelect: { verb: 'nope' } },
        { id: 'c', kind: 'form', controls: [{ kind: 'table', add: { verb: 'addRow' }, onEdit: { verb: 'bogus' } }] },
      ],
    };
    sanitizeApp(app);
    expect(app.panels[0].source).toBeUndefined();
    expect(app.panels[0].text).toBe('hi'); // real content untouched
    expect(app.panels[1].source.verb).toBe('listDocs'); // known → kept
    expect(app.panels[1].onSelect).toBeUndefined();
    expect(app.panels[2].controls[0].add.verb).toBe('addRow');
    expect(app.panels[2].controls[0].onEdit).toBeUndefined();
  });
});
