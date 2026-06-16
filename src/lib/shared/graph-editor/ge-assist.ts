/**
 * ge-assist.ts — the PURE multi-shot tool-loop for the graph editor's ✨ "edit
 * this part" assistant (docs/plans/ai-multishot-assist.md §B/§C, Phase 1 of the
 * umbrella docs/plans/ai-rag-system.md). Mirrors SVTC's `chat.svelte.js` loop,
 * but kept rune-free so it
 *   (a) unit-tests with a plain local `graph` variable + a stubbed `postTurn`
 *       (no browser, no Svelte compiler — this project's vitest config has no
 *       svelte plugin, so `$state` cannot compile in a test), and
 *   (b) is reused verbatim by the reactive `$state` wrapper in the sibling
 *       `ge-assist.svelte.ts` `createAssistSession()` factory.
 *
 * The loop is CLIENT-APPLIED (SVTC parity): the caller holds the live `Graph`
 * (`getGraph`/`setGraph`), `/api/rag/assist` is a thin per-turn proxy that
 * returns `{calls|text}` but never mutates, and each tool call is applied here
 * via the PURE `dispatchEditorTool`. The user sees each edit land and can Stop.
 *
 * Termination (always honoured — never trust the model to stop):
 *   • the model replies with `type:'text'`  → status 'done'
 *   • the model returns `tool_use` with zero calls (no-op) → status 'done'
 *   • `shouldStop()` flips true (user Stop)  → status 'stopped'
 *   • `MAX_STEPS` turns elapse (HARD cap)    → status 'capped'
 *   • `postTurn` throws (network/endpoint)   → status 'error'
 * A per-call dispatcher failure does NOT stop the loop: the error is logged
 * (logFixError) and fed back as an `is_error` tool_result so the model can
 * recover on the next turn.
 */
import { dispatchEditorTool, readEditorState, type EditorContext } from '$lib/cad/editor-tools';
import type { Graph } from '$lib/cad/composition-graph';

/** Hard cap on model turns per `run()`. SVTC used 5; 6 covers a realistic edit
 *  (addParam → wireArgToParam → addCall → addCsg → setMethodInput → confirm). */
export const MAX_STEPS = 6;

/** One Anthropic Messages-API message (role + opaque content array). The loop
 *  appends the assistant `content` VERBATIM (incl. tool_use + thinking blocks)
 *  before each tool_result user turn — adaptive-thinking blocks replay raw. */
export type AnthMessage = { role: 'user' | 'assistant'; content: unknown };

/** The `/api/rag/assist` per-turn response (see that endpoint's header). */
export type AssistTurnResponse =
  | {
      type: 'tool_use';
      calls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
      content: unknown;
      stopReason?: string;
    }
  | { type: 'text'; text: string; content: unknown; stopReason?: string };

/** The network boundary, injected so the loop is backend-agnostic (Anthropic
 *  proxy by default; a future web-llm worker produces the same shape — see
 *  ai-rag-system.md §E). The reactive wrapper supplies the default `fetch`. */
export type PostTurn = (body: {
  messages: AnthMessage[];
  graphState: unknown;
  model?: string;
}) => Promise<AssistTurnResponse>;

/** One record appended to `ai/fix-errors.jsonl` (the self-repair corpus). The
 *  endpoint that persists it is out of this engine's scope — `logFixError` is
 *  injected; if absent, tool errors are still surfaced in the transcript. */
export type FixErrorInput = {
  partId?: string | null;
  prompt: string;
  tool: string;
  input: unknown;
  error: string;
  step: number;
  model?: string;
};

/** One transcript row for the (future) UI panel. */
export type AssistStep =
  | { kind: 'user'; text: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool'; tool: string; input: unknown; ok: true; result?: unknown }
  | { kind: 'tool'; tool: string; input: unknown; ok: false; error: string }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

export type AssistStatus = 'done' | 'stopped' | 'capped' | 'error';

export type AssistRunResult = {
  status: AssistStatus;
  /** The final plain-text answer when the model stops with text. */
  text?: string;
  /** A terminal error message (postTurn threw) — distinct from per-tool errors. */
  error?: string;
  /** Every transcript row produced by this run (also streamed via onStep). */
  steps: AssistStep[];
  /** The full Anthropic message thread after the run — thread it back into the
   *  next `run()` (priorMessages) for chat-style continuation. */
  messages: AnthMessage[];
  /** How many model turns were consumed. */
  turns: number;
};

export type AssistLoopDeps = {
  /** Read the live graph (re-read per applied call so a turn's calls compound). */
  getGraph: () => Graph;
  /** Commit a mutated graph (assigns the pane's reactive `graph` $state). */
  setGraph: (g: Graph) => void;
  /** UI-only context the graph can't carry: { partId, activeTab, selectedId }. */
  getCtx: () => EditorContext;
  /** The per-turn network call (default supplied by the reactive wrapper). */
  postTurn: PostTurn;
  /** Fire-and-forget error capture (optional). */
  logFixError?: (rec: FixErrorInput) => void;
  /** Streamed transcript callback (the wrapper pushes into reactive $state). */
  onStep?: (step: AssistStep) => void;
  /** Cooperative cancellation — checked before each turn AND after each POST. */
  shouldStop?: () => boolean;
  /** Optional per-request model override. */
  model?: string;
  /** Prior message thread, for chat-style continuation across `run()` calls. */
  priorMessages?: AnthMessage[];
};

/**
 * Run the multi-shot tool loop for ONE user instruction. Pure of DOM/Svelte —
 * all I/O is injected. Never throws: a thrown `postTurn` resolves to a terminal
 * `{ status:'error' }` result.
 */
export async function runAssistLoop(prompt: string, deps: AssistLoopDeps): Promise<AssistRunResult> {
  const steps: AssistStep[] = [];
  const push = (s: AssistStep) => {
    steps.push(s);
    try {
      deps.onStep?.(s);
    } catch {
      /* a UI callback must never break the loop */
    }
  };

  const instruction = (prompt ?? '').trim();
  const messages: AnthMessage[] = [...(deps.priorMessages ?? []), { role: 'user', content: instruction }];
  push({ kind: 'user', text: instruction });

  const done = (r: Omit<AssistRunResult, 'steps' | 'messages'>): AssistRunResult => ({
    ...r,
    steps,
    messages,
  });

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    if (deps.shouldStop?.()) {
      push({ kind: 'note', text: 'stopped by user' });
      return done({ status: 'stopped', turns: turn });
    }

    // Re-inject fresh editor state every turn so the model sees ids/aliases
    // created mid-loop (CURRENT EDITOR STATE in the system prompt).
    const graphState = readEditorState(deps.getGraph(), deps.getCtx());

    let resp: AssistTurnResponse;
    try {
      resp = await deps.postTurn({ messages, graphState, model: deps.model });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ kind: 'error', text: msg });
      return done({ status: 'error', error: msg, turns: turn });
    }

    // Honour Stop requested during the (awaited) network round-trip, before we
    // apply anything.
    if (deps.shouldStop?.()) {
      push({ kind: 'note', text: 'stopped by user' });
      return done({ status: 'stopped', turns: turn });
    }

    if (resp.type === 'text') {
      push({ kind: 'assistant_text', text: resp.text });
      return done({ status: 'done', text: resp.text, turns: turn + 1 });
    }

    // tool_use — append the assistant content VERBATIM before the tool_result.
    messages.push({ role: 'assistant', content: resp.content });

    const calls = Array.isArray(resp.calls) ? resp.calls : [];
    if (calls.length === 0) {
      // The model emitted a tool_use envelope with no calls — nothing to apply.
      // Treat as a benign no-op stop (don't burn the loop re-querying).
      push({ kind: 'note', text: 'no tool calls returned' });
      return done({ status: 'done', turns: turn + 1 });
    }

    // Apply ALL calls in this turn, returning ALL tool_results in ONE user turn.
    const ctx = deps.getCtx();
    const toolResults: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      let res: ReturnType<typeof dispatchEditorTool> | null = null;
      let thrown: string | null = null;
      try {
        res = dispatchEditorTool(call.name, input, deps.getGraph(), ctx);
      } catch (e) {
        // dispatchEditorTool is internally try/caught, but guard the contract:
        // a thrown/null result is surfaced, never crashes the loop.
        thrown = e instanceof Error ? e.message : String(e);
      }

      const error = thrown ?? res?.error ?? (res ? undefined : 'dispatcher returned no result');

      if (error) {
        deps.logFixError?.({
          partId: ctx.partId ?? null,
          prompt: instruction,
          tool: call.name,
          input,
          error,
          step: turn,
          model: deps.model,
        });
        push({ kind: 'tool', tool: call.name, input, ok: false, error });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: error, is_error: true });
      } else {
        deps.setGraph(res!.graph); // commit; getGraph() now reflects it for the next call
        push({ kind: 'tool', tool: call.name, input, ok: true, result: res!.result });
        let content: string;
        try {
          content = JSON.stringify(res!.result ?? {});
        } catch {
          content = '{}';
        }
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Step cap is a HARD stop with a surfaced note (a UI can offer "continue?").
  push({ kind: 'note', text: `stopped after the ${MAX_STEPS}-step cap` });
  return done({ status: 'capped', turns: MAX_STEPS });
}
