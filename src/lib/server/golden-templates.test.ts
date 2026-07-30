import { describe, it, expect } from 'vitest';
import {
  extractSlots,
  slotNamesOf,
  isTemplated,
  maskSlots,
  fillTemplate,
  applyTemplate,
  matchTemplate,
  goldenScore,
  tokenize,
  overlap,
} from './golden-templates';
import type { GoldenPair } from './app-corpus-store';

// The canonical templated golden from the design note: one entry covers the whole colour family.
const colorGolden: GoldenPair = {
  name: 'bg-color',
  md: 'turn the background {{color}}',
  app: { app: 'bg', panels: [{ id: 'root', kind: 'stack' }], theme: { background: '{{color}}' } },
};

describe('extractSlots / slotNamesOf / isTemplated', () => {
  it('finds {{name}} placeholders in order, de-duplicated', () => {
    expect(extractSlots('turn the background {{color}}')).toEqual(['color']);
    expect(extractSlots('a {{size}} {{color}} box, again {{color}}')).toEqual(['size', 'color']);
    expect(extractSlots('no slots here')).toEqual([]);
  });
  it('tolerates whitespace inside the braces', () => {
    expect(extractSlots('bg {{ color }}')).toEqual(['color']);
  });
  it('slotNamesOf prefers explicit slots metadata, else derives from md', () => {
    expect(slotNamesOf(colorGolden)).toEqual(['color']);
    expect(slotNamesOf({ md: 'x {{a}}', slots: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b']);
    expect(isTemplated(colorGolden)).toBe(true);
    expect(isTemplated({ md: 'plain literal golden' })).toBe(false);
  });
});

describe('maskSlots — strip the slot so the skeleton is what we compare', () => {
  it('drops the placeholder, leaving the non-slot skeleton', () => {
    expect(tokenize(maskSlots('turn the background {{color}}', ['color']))).toEqual(
      new Set(['turn', 'the', 'background']),
    );
  });
  it('is identity when there are no slot names (backward-compatible)', () => {
    expect(maskSlots('a literal golden', [])).toBe('a literal golden');
  });
  it('does not glue neighbouring words together', () => {
    expect(maskSlots('a{{x}}b', ['x'])).toBe('a b');
  });
});

describe('fillTemplate / applyTemplate — deterministic substitution', () => {
  it('substitutes {{name}} in a string', () => {
    expect(fillTemplate('turn the background {{color}}', { color: 'teal' })).toBe('turn the background teal');
  });
  it('leaves unknown placeholders intact', () => {
    expect(fillTemplate('{{a}} and {{b}}', { a: 'X' })).toBe('X and {{b}}');
  });
  it('deep-fills every string in an .app doc, non-strings untouched', () => {
    const filled = applyTemplate(colorGolden.app, { color: 'teal' }) as any;
    expect(filled.theme.background).toBe('teal');
    expect(filled.panels[0].kind).toBe('stack'); // untemplated string unchanged
    // original is not mutated
    expect((colorGolden.app as any).theme.background).toBe('{{color}}');
  });
  it('fills nested arrays/objects and numeric leaves pass through', () => {
    const src = { a: ['{{x}}', { b: '{{x}}', n: 5, ok: true }] };
    expect(applyTemplate(src, { x: 'q' })).toEqual({ a: ['q', { b: 'q', n: 5, ok: true }] });
  });
});

describe('matchTemplate — regex capture of the concrete prompt', () => {
  it('captures the slot value from an exact-structure prompt', () => {
    expect(matchTemplate('turn the background teal', colorGolden)).toEqual({ values: { color: 'teal' } });
  });
  it('is case-insensitive on literals but preserves the captured value case', () => {
    expect(matchTemplate('Turn The Background Teal', colorGolden)).toEqual({ values: { color: 'Teal' } });
  });
  it('tolerates trailing punctuation and surrounding whitespace', () => {
    expect(matchTemplate('  turn the background teal!  ', colorGolden)).toEqual({ values: { color: 'teal' } });
  });
  it('returns null when the phrasing differs (brittle by design)', () => {
    expect(matchTemplate('make the background red', colorGolden)).toBeNull();
  });
  it('returns null for a non-templated golden', () => {
    expect(matchTemplate('anything', { md: 'a literal golden' })).toBeNull();
  });
  it('captures multiple slots', () => {
    const g: GoldenPair = { md: 'a {{size}} {{color}} box', app: {}, name: 'box' } as GoldenPair;
    expect(matchTemplate('a large blue box', g)).toEqual({ values: { size: 'large', color: 'blue' } });
  });
  it('with declared values, matches only allow-listed members', () => {
    const g: GoldenPair = {
      name: 'bg',
      md: 'turn the background {{color}}',
      app: {},
      slots: [{ name: 'color', values: ['teal', 'red', 'blue'] }],
    };
    expect(matchTemplate('turn the background teal', g)).toEqual({ values: { color: 'teal' } });
    expect(matchTemplate('turn the background chartreuse', g)).toBeNull(); // not in the allow-list
  });
});

describe('goldenScore — slot-aware ranking', () => {
  it('a single {{color}} golden scores > 0 for every family member', () => {
    expect(goldenScore('turn the background teal', colorGolden)).toBeGreaterThan(0);
    expect(goldenScore('make the background red', colorGolden)).toBeGreaterThan(0);
  });
  it('is INVARIANT to the slot value (teal and magenta score identically)', () => {
    expect(goldenScore('turn the background teal', colorGolden)).toBe(
      goldenScore('turn the background magenta', colorGolden),
    );
  });
  it('an exact-phrasing family member scores a perfect skeleton coverage (1)', () => {
    expect(goldenScore('turn the background teal', colorGolden)).toBe(1);
  });
  it('scores 0 for an unrelated prompt', () => {
    expect(goldenScore('add a survey depth chart', colorGolden)).toBe(0);
  });
  it('a LITERAL golden keeps the original prompt↔md overlap (unchanged)', () => {
    const lit: GoldenPair = { name: 'h', md: 'a hello world text panel', app: {} };
    // original formula: overlap(tokenize(prompt), tokenize(md))
    expect(goldenScore('a hello world app', lit)).toBe(overlap(tokenize('a hello world app'), tokenize(lit.md)));
  });
});
