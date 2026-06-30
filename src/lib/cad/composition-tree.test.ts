import { describe, it, expect } from 'vitest';
import {
  emitNode,
  serializeComposition,
  parseComposition,
  applyToSource,
  newNodeId,
  type TreeNode,
} from './composition-tree';
import { partHashId } from './part-id';

// emitNode stamps each Call `__tag(<expr>, partHashId(fn))` so the
// color-by-source LUT (analyzeAssembly) matches the bake's mesh originalIDs.
// The hash is deterministic per fn name; build the expected wrapper with it.
const TAG = (inner: string, fn: string) => `__tag(${inner}, ${partHashId(fn)})`;

/** Minimal .asm.ts skeleton the source-level writers can mutate against. */
const ASM_SKELETON = `
import type { Manifold } from 'manifold-3d';
export const meta = {
  name: 'tube_demo',
  tags: ['test'],
  imports: [],
  composition: null,
  uses: [],
  params: {},
} as const;
export function tube_demo() {
  return empty();
}
`;

describe('composition-tree — Call inline transforms (mv / rot)', () => {
  it('emits a bare Call when neither mv nor rot is set', () => {
    const call: TreeNode = {
      type: 'call', id: newNodeId(), fn: 'shaft',
      args: [
        { type: 'literal', id: newNodeId(), value: 'p.od' },
        { type: 'literal', id: newNodeId(), value: 'p.length' },
      ],
    };
    expect(emitNode(call)).toBe(TAG('shaft(p.od, p.length)', 'shaft'));
  });

  it('wraps in mv(...) when mv set', () => {
    const call: TreeNode = {
      type: 'call', id: newNodeId(), fn: 'shaft',
      args: [{ type: 'literal', id: newNodeId(), value: 'p.od' }],
      mv: [
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '5' },
      ],
    };
    expect(emitNode(call)).toBe(TAG('mv(shaft(p.od), [0, 0, 5])', 'shaft'));
  });

  it('wraps in rot(mv(...)) when both set — mv inner, rot outer', () => {
    const call: TreeNode = {
      type: 'call', id: newNodeId(), fn: 'shaft',
      args: [],
      mv:  [
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '5' },
      ],
      rot: [
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '90' },
      ],
    };
    expect(emitNode(call)).toBe(TAG('rot(mv(shaft(), [0, 0, 5]), [0, 0, 90])', 'shaft'));
  });

  it('round-trips through serialize → parse', () => {
    const original: TreeNode = {
      type: 'call', id: 'aaaaaaaa', fn: 'shaft',
      args: [{ type: 'literal', id: 'bbbbbbbb', value: 'p.od' }],
      mv:  [
        { type: 'literal', id: 'cccccccc', value: '0' },
        { type: 'literal', id: 'dddddddd', value: '0' },
        { type: 'literal', id: 'eeeeeeee', value: '5' },
      ],
      rot: [
        { type: 'literal', id: 'ffffffff', value: '0' },
        { type: 'literal', id: 'gggggggg', value: '0' },
        { type: 'literal', id: 'hhhhhhhh', value: '90' },
      ],
    };
    const literal = serializeComposition(original);
    // Splice into a fake `composition: <lit>,` line so parseComposition can read it.
    const wrapped = `\nconst x = { composition: ${literal}, };`;
    const back = parseComposition(wrapped);
    expect(back).not.toBeNull();
    expect(back!.type).toBe('call');
    const call = back as Extract<TreeNode, { type: 'call' }>;
    expect(call.fn).toBe('shaft');
    expect(call.mv).toBeTruthy();
    expect(call.rot).toBeTruthy();
    // Re-emit & compare strings.
    expect(emitNode(back!)).toBe(emitNode(original));
  });

  it('applyToSource emits the wrapped form into the function body', () => {
    const call: TreeNode = {
      type: 'call', id: newNodeId(), fn: 'shaft', args: [],
      mv:  [
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '0' },
        { type: 'literal', id: newNodeId(), value: '5' },
      ],
    };
    const out = applyToSource(ASM_SKELETON, 'tube_demo', [], call);
    expect(out).toContain(`return ${TAG('mv(shaft(), [0, 0, 5])', 'shaft')};`);
  });
});
