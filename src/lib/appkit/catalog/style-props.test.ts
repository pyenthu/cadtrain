// Shared STYLE props (width/height/background/… + the `css` escape hatch) — declared once in the
// catalog and merged onto every component, rendered to CSS by the harness.
import { describe, it, expect } from 'vitest';
import {
  STYLE_PROPS,
  COMPONENT_CATALOG,
  getComponentMeta,
  styleFromProps,
  hasStyleProps,
  isStyleProp,
} from './components';
import { promoteComponentProps } from '../manifest/promote-props';

describe('shared style props — catalog merge', () => {
  it('every component kind gains the full shared set', () => {
    for (const meta of COMPONENT_CATALOG) {
      for (const s of STYLE_PROPS) {
        expect(meta.props?.some((p) => p.name === s.name), `${meta.kind} missing ${s.name}`).toBe(true);
      }
    }
  });

  it("keeps a component's OWN prop when the name collides (never clobbered by the shared one)", () => {
    // Synthesise the collision the merge is written to survive: a kind declaring its own `height`
    // with bespoke semantics must keep that spec, not inherit the generic style one.
    const withOwnHeight = COMPONENT_CATALOG.filter((m) =>
      (m.props ?? []).filter((p) => p.name === 'height').length > 0,
    );
    for (const m of withOwnHeight) {
      expect((m.props ?? []).filter((p) => p.name === 'height')).toHaveLength(1); // no duplicate
    }
  });

  it('marks every shared style prop non-promotable and presentation-only', () => {
    const stat = getComponentMeta('stat')!;
    const shared = stat.props!.filter((p) => isStyleProp(p.name));
    expect(shared.length).toBe(STYLE_PROPS.length);
    expect(shared.every((p) => p.promote === false)).toBe(true);
    expect(shared.every((p) => p.style === true)).toBe(true);
  });
});

describe('styleFromProps', () => {
  it('treats a bare number as px and passes any other unit through', () => {
    expect(styleFromProps({ width: 200 })).toBe('width:200px');
    expect(styleFromProps({ width: '50%' })).toBe('width:50%');
    expect(styleFromProps({ height: 'calc(100vh - 40px)' })).toBe('height:calc(100vh - 40px)');
  });

  it('maps the friendly names onto real CSS declarations', () => {
    expect(styleFromProps({ radius: 6 })).toBe('border-radius:6px');
    expect(styleFromProps({ align: 'center' })).toBe('text-align:center');
    expect(styleFromProps({ background: '#eef', color: '#123' })).toBe('background:#eef;color:#123');
  });

  it('appends `css` LAST so a hand-written declaration wins over a typed prop', () => {
    const out = styleFromProps({ background: '#fff', css: 'background:red' });
    expect(out).toBe('background:#fff;background:red'); // later wins in inline CSS
    expect(out.lastIndexOf('background:red')).toBeGreaterThan(out.indexOf('background:#fff'));
  });

  it('accepts the pre-existing `style` prop as an alias (apps authored before this existed)', () => {
    expect(styleFromProps({ style: 'opacity:.5' })).toBe('opacity:.5');
  });

  it('emits nothing for absent / blank values', () => {
    expect(styleFromProps(undefined)).toBe('');
    expect(styleFromProps({})).toBe('');
    expect(styleFromProps({ width: '', background: '   ' })).toBe('');
    expect(styleFromProps({ label: 'Revenue', value: 12 })).toBe(''); // non-style props ignored
  });
});

describe('hasStyleProps — gates the wrapper', () => {
  it('is false when unstyled, so an existing app renders byte-identical markup', () => {
    expect(hasStyleProps(undefined)).toBe(false);
    expect(hasStyleProps({ label: 'Revenue', value: 12 })).toBe(false);
    expect(hasStyleProps({ width: '' })).toBe(false);
  });

  it('is true as soon as any style prop carries a value', () => {
    expect(hasStyleProps({ width: '10px' })).toBe(true);
    expect(hasStyleProps({ css: 'opacity:.5' })).toBe(true);
    expect(hasStyleProps({ style: 'opacity:.5' })).toBe(true);
  });
});

describe('promotion', () => {
  it('leaves style props on the panel as literal CSS and out of app.vars', () => {
    const app: any = { app: 't', panels: [] };
    const panel: any = {
      id: 'kpi',
      kind: 'stat',
      props: { label: 'Revenue', value: 1234, width: '200px', background: '#eef', css: 'opacity:.9' },
    };
    promoteComponentProps(app, panel);

    // Presentation stays literal — promoting it would bloat vars (and the RAG grounding) with CSS.
    expect(Object.keys(app.vars.kpi)).not.toContain('width');
    expect(Object.keys(app.vars.kpi)).not.toContain('css');
    expect(panel.props.width).toBe('200px');
    expect(panel.props.css).toBe('opacity:.9');

    // Real props still promote to store refs as before.
    expect(panel.props.label).toBe('$vars.kpi.label');
    expect(app.vars.kpi.label).toBe('Revenue');
  });
});
