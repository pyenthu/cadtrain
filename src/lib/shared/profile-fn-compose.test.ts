import { describe, it, expect } from 'vitest';
import {
  splitArgs,
  parseBody,
  composeBody,
  bodyTooComplexToDecompose,
  type Move,
} from './profile-fn-compose';

describe('splitArgs', () => {
  it('splits on top-level commas only', () => {
    expect(splitArgs('a, b')).toEqual(['a', 'b']);
    expect(splitArgs('Math.max(a, b), z')).toEqual(['Math.max(a, b)', 'z']);
    expect(splitArgs('[i, j], k')).toEqual(['[i, j]', 'k']);
  });
});

describe('composeBody', () => {
  it('emits the param destructure + pen chain for a simple expr + moves', () => {
    const moves: Move[] = [
      { cmd: 'mv', a: '0', b: '0' },
      { cmd: 'line', a: 'r', b: '0' },
    ];
    const out = composeBody({ keys: ['r', 'len'], calc: [], moves });
    expect(out).toBe(
      '  const { r, len } = p;\n' +
      '  return pen()\n' +
      '    .mv(0, 0)\n' +
      '    .line(r, 0)\n' +
      '    .pts();',
    );
  });

  it('prepends calc lines and skips destructuring names the calc declares', () => {
    const out = composeBody({
      keys: ['r'],
      calc: [{ name: 'd', expr: 'r * 2' }],
      moves: [{ cmd: 'mv', a: '0', b: '0' }],
    });
    expect(out).toBe(
      '  const { r } = p;\n' +
      '  const d = r * 2;\n' +
      '  return pen()\n' +
      '    .mv(0, 0)\n' +
      '    .pts();',
    );
  });

  it('emits a raw point-array (Array.from spread) when a repeat row is present', () => {
    const out = composeBody({
      keys: ['n'],
      calc: [],
      moves: [{ cmd: 'repeat', a: 'n', b: 'cos(i)', c: 'sin(i)' }],
    });
    expect(out).toBe(
      '  const { n } = p;\n' +
      '  return [\n' +
      '    ...Array.from({ length: Math.max(0, Math.round(n)) }, (_, i) => [cos(i), sin(i)]),\n' +
      '  ];',
    );
  });

  it('returns a visible empty array when there are no moves and no seed body', () => {
    expect(composeBody({ keys: [], calc: [], moves: [] })).toBe('  return [];');
  });
});

describe('parseBody ⇄ composeBody round-trip (decomposable bodies)', () => {
  it('round-trips a pen chain with no params/calc', () => {
    const moves: Move[] = [
      { cmd: 'mv', a: '0', b: '0' },
      { cmd: 'line', a: 'r', b: '0' },
      { cmd: 'line', a: 'r', b: 'len' },
    ];
    const body = composeBody({ keys: [], calc: [], moves });
    // No param destructure + no calc → expr is empty, moves recovered exactly.
    expect(parseBody(body)).toEqual({ expr: '', moves });
  });

  it('extracts moves from a return-array literal body', () => {
    // The shape every curated revolve profile loads as: a `return [[..], ..]`.
    // (No pen() call → `expr` keeps the whole body verbatim, which the editor
    //  then runs through parseCalc — that yields zero calc rows for a bare
    //  `return [...]`, so the duplication is harmless.)
    const body = 'return [[0, 0], [r, 0], [r, len], [0, len]];';
    const parsed = parseBody(body);
    expect(parsed.expr).toBe('return [[0, 0], [r, 0], [r, len], [0, len]];');
    expect(parsed.moves).toEqual([
      { cmd: 'mv', a: '0', b: '0' },
      { cmd: 'line', a: 'r', b: '0' },
      { cmd: 'line', a: 'r', b: 'len' },
      { cmd: 'line', a: '0', b: 'len' },
    ]);
  });
});

describe('bodyTooComplexToDecompose — KNOWN LOSSY case (pinned)', () => {
  // Memory `profile_editor_composeSource_bug`: the structured editor models
  // exactly ONE repeat row, so a body with MULTIPLE `Array.from(...)` arcs
  // can't round-trip. This is a KNOWN LIMITATION — these assertions pin the
  // CURRENT (lossy) behaviour so the bug is testable, NOT a spec to preserve
  // forever. parseBody intentionally returns ZERO moves (the passthrough) so
  // composeBody re-emits the original body verbatim instead of a malformed one.
  const multiArrayFrom =
    'return [\n' +
    '  ...Array.from({ length: n }, (_, i) => [r * cos(i), r * sin(i)]),\n' +
    '  ...Array.from({ length: m }, (_, i) => [r2 * cos(i), r2 * sin(i)]),\n' +
    '];';

  it('flags a multi-Array.from body as too complex', () => {
    expect(bodyTooComplexToDecompose(multiArrayFrom)).toBe(true);
  });

  it('also flags a named ...spread inside the return array', () => {
    expect(bodyTooComplexToDecompose('return [...corners, [r, 0]];')).toBe(true);
  });

  it('parseBody returns ZERO moves (the documented lossy passthrough)', () => {
    const parsed = parseBody(multiArrayFrom);
    // The lossy passthrough: no moves are extracted, so the editor falls back
    // to the verbatim branch and the second arc is NOT dropped on save.
    expect(parsed.moves).toEqual([]);
  });

  it('composeBody round-trips the complex body verbatim via the seed branch', () => {
    // With zero moves + the original as seedBody, the body is preserved
    // (re-indented under build(p)) rather than recomposed lossily.
    const out = composeBody({ keys: [], calc: [], moves: [], seedBody: multiArrayFrom });
    expect(out).toContain('...Array.from({ length: n }');
    expect(out).toContain('...Array.from({ length: m }');
  });
});
