import { describe, it, expect, vi } from 'vitest';
import { newGraph, addCall, type CallNode, type Graph } from '$lib/graph/composition-graph';
import { runAssistLoop, MAX_STEPS, type AnthMessage, type AssistTurnResponse, type PostTurn } from './ge-assist';

/**
 * Loop-logic tests for the multi-shot assist engine. The pure loop is driven by
 * a SCRIPTED `postTurn` (a stubbed fetch) against a real local `Graph` + the
 * real pure dispatcher — no browser, no Claude, no Svelte. We assert the graph
 * lands the edits, that an `is_error` tool_result is fed back on a bad call,
 * that logFixError fires, and that every termination path returns the right
 * status.
 */

function fixture() {
  const base = newGraph();
  const { graph, id: callId } = addCall(base, 'r_cuboid', {}, undefined);
  return { graph, callId, alias: (graph.nodes[callId] as CallNode).alias };
}

/** A live-graph harness: getGraph/setGraph close over a mutable local var, just
 *  like the pane's reactive `graph` $state would. */
function harness(initial: Graph) {
  let graph = initial;
  return {
    getGraph: () => graph,
    setGraph: (g: Graph) => {
      graph = g;
    },
    getCtx: () => ({ partId: 'g_test', selectedId: null, activeTab: 'basic' }),
    current: () => graph,
  };
}

/** Build a scripted postTurn that returns each response in order and records
 *  the `messages` it was called with (to inspect tool_result feedback). */
function scriptedPostTurn(responses: AssistTurnResponse[]) {
  const seenMessages: AnthMessage[][] = [];
  let i = 0;
  const fn: PostTurn = vi.fn(async ({ messages }) => {
    seenMessages.push(JSON.parse(JSON.stringify(messages)));
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r;
  });
  return { fn, seenMessages, calls: () => i };
}

const toolUse = (id: string, name: string, input: Record<string, unknown>): AssistTurnResponse => ({
  type: 'tool_use',
  calls: [{ id, name, input }],
  content: [{ type: 'tool_use', id, name, input }],
});
const text = (t: string): AssistTurnResponse => ({ type: 'text', text: t, content: [{ type: 'text', text: t }] });

describe('runAssistLoop — multi-shot tool loop', () => {
  it('applies a tool sequence to the live graph and stops on text', async () => {
    const { graph, alias } = fixture();
    const h = harness(graph);
    const script = scriptedPostTurn([
      toolUse('t1', 'addParam', { name: 'OD', default: 3.5, min: 1, max: 10 }),
      toolUse('t2', 'wireArgToParam', { node: alias, key: 'd', param: 'OD' }),
      text('Wired d to OD.'),
    ]);

    const result = await runAssistLoop('wire d to OD', {
      ...h,
      postTurn: script.fn,
    });

    expect(result.status).toBe('done');
    expect(result.text).toBe('Wired d to OD.');
    expect(result.turns).toBe(3);
    // graph mutated: param added + arg wired
    expect(h.current().params.OD).toEqual({ default: 3.5, min: 1, max: 10 });
    const callNode = Object.values(h.current().nodes).find((n) => n.type === 'call') as CallNode;
    expect(callNode.args.d).toEqual({ kind: 'param', param: 'OD' });
    // transcript: user + 2 ok tools + assistant_text
    expect(result.steps.map((s) => s.kind)).toEqual(['user', 'tool', 'tool', 'assistant_text']);
    expect(result.steps.filter((s) => s.kind === 'tool' && s.ok).length).toBe(2);
  });

  it('feeds an is_error tool_result back and keeps looping (and logs the error)', async () => {
    const { graph } = fixture();
    const h = harness(graph);
    const logFixError = vi.fn();
    const script = scriptedPostTurn([
      // bad node id → dispatcher returns { error }
      toolUse('t1', 'setCallArg', { node: 'n_nope', key: 'w', value: 2 }),
      text('Could not find that node.'),
    ]);

    const result = await runAssistLoop('set w to 2', {
      ...h,
      postTurn: script.fn,
      logFixError,
    });

    expect(result.status).toBe('done');
    // the SECOND turn's messages must carry the assistant content + an is_error tool_result
    const secondTurnMsgs = script.seenMessages[1];
    const toolResultTurn = secondTurnMsgs[secondTurnMsgs.length - 1];
    expect(toolResultTurn.role).toBe('user');
    const blocks = toolResultTurn.content as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe('tool_result');
    expect(blocks[0].tool_use_id).toBe('t1');
    expect(blocks[0].is_error).toBe(true);
    // logFixError fired once with the failing tool
    expect(logFixError).toHaveBeenCalledTimes(1);
    expect(logFixError.mock.calls[0][0]).toMatchObject({ tool: 'setCallArg', partId: 'g_test' });
    // error step recorded, ok:false
    const errStep = result.steps.find((s) => s.kind === 'tool' && !s.ok);
    expect(errStep).toBeTruthy();
  });

  it('enforces the hard step cap when the model never stops', async () => {
    const { graph } = fixture();
    const h = harness(graph);
    // Always return a (valid, idempotent) tool_use — never text.
    const fn: PostTurn = vi.fn(async () => toolUse('tx', 'addParam', { name: 'X', default: 1 }));

    const result = await runAssistLoop('loop forever', { ...h, postTurn: fn });

    expect(result.status).toBe('capped');
    expect(result.turns).toBe(MAX_STEPS);
    expect(fn).toHaveBeenCalledTimes(MAX_STEPS);
    expect(result.steps.some((s) => s.kind === 'note')).toBe(true);
  });

  it('stops cooperatively when shouldStop flips', async () => {
    const { graph } = fixture();
    const h = harness(graph);
    let turnsSeen = 0;
    let stop = false;
    const fn: PostTurn = vi.fn(async () => {
      turnsSeen += 1;
      if (turnsSeen >= 1) stop = true; // request stop after the first turn
      return toolUse('tx', 'addParam', { name: `P${turnsSeen}`, default: 1 });
    });

    const result = await runAssistLoop('do many things', {
      ...h,
      postTurn: fn,
      shouldStop: () => stop,
    });

    expect(result.status).toBe('stopped');
    // first turn applied, then the post-POST stop check halts before turn 2
    expect(turnsSeen).toBe(1);
  });

  it('surfaces a postTurn (network) failure as a terminal error, never throws', async () => {
    const { graph } = fixture();
    const h = harness(graph);
    const fn: PostTurn = vi.fn(async () => {
      throw new Error('assist endpoint 502: boom');
    });

    const result = await runAssistLoop('break', { ...h, postTurn: fn });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/502: boom/);
    expect(result.steps.some((s) => s.kind === 'error')).toBe(true);
  });

  it('treats an empty tool_use (no calls) as a benign no-op stop', async () => {
    const { graph } = fixture();
    const h = harness(graph);
    const fn: PostTurn = vi.fn(async () => ({ type: 'tool_use', calls: [], content: [] }));

    const result = await runAssistLoop('nothing', { ...h, postTurn: fn });

    expect(result.status).toBe('done');
    expect(result.steps.some((s) => s.kind === 'note')).toBe(true);
  });

  it('threads priorMessages so a follow-up continues the conversation', async () => {
    const { graph } = fixture();
    const h = harness(graph);
    const prior: AnthMessage[] = [
      { role: 'user', content: 'first instruction' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    const script = scriptedPostTurn([text('ok')]);

    const result = await runAssistLoop('second instruction', {
      ...h,
      postTurn: script.fn,
      priorMessages: prior,
    });

    expect(result.status).toBe('done');
    // the first POST should see prior (2) + the new user turn (1) = 3 messages
    expect(script.seenMessages[0].length).toBe(3);
    expect(script.seenMessages[0][2]).toEqual({ role: 'user', content: 'second instruction' });
  });
});
