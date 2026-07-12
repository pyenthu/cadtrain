/**
 * ge-assist.svelte.ts — the reactive `$state` wrapper around the pure
 * multi-shot loop in the sibling `ge-assist.ts`. Mirrors SVTC's
 * `chat.svelte.js`; the project's pure↔rune split (cf. `graph-editor-bake.ts`
 * vs `graph-editor-bake.svelte.ts`) keeps the loop logic unit-testable while
 * the `$state` lives here (a `.svelte.ts` so runes compile).
 *
 * `createAssistSession` is a FACTORY, not a module singleton: `/primitives`
 * mounts N `GraphEditorPane`s and each pane needs its OWN transcript + busy flag
 * + graph getter/setter. A singleton would cross-wire two open tabs
 * (ai-rag-system.md §M, ai-multishot-assist.md §C).
 *
 * What it owns:
 *   • `running` / `error` / `steps` (transcript) as `$state` for a future panel.
 *   • the default `postTurn` — POST `/api/rag/assist` (prod-proxied so the key
 *     stays server-side). Override via `opts.postTurn` for tests / a web-llm
 *     backend.
 *   • cooperative Stop + a one-instruction `run()` that threads messages across
 *     submissions (chat-style continuation).
 *
 * It does NOT mount UI, touch the DOM, or persist to the volume — the pane wires
 * `getGraph/setGraph/getCtx/logFixError` and binds the popover to this surface
 * (deferred to a later GraphEditorPane step).
 */
import {
  runAssistLoop,
  MAX_STEPS,
  type AnthMessage,
  type AssistLoopDeps,
  type AssistRunResult,
  type AssistStep,
  type AssistTurnResponse,
  type FixErrorInput,
  type PostTurn,
} from './ge-assist';
import type { Graph } from '$lib/graph/composition-graph';
import type { EditorContext } from '$lib/graph/editor-tools';

export { MAX_STEPS };
export type { AssistStep, AssistRunResult, AnthMessage, PostTurn, FixErrorInput };

export type CreateAssistSessionOpts = {
  /** Read the pane's live graph $state. */
  getGraph: () => Graph;
  /** Assign the pane's reactive `graph` $state (triggers re-bake). */
  setGraph: (g: Graph) => void;
  /** UI-only context: { partId, activeTab, selectedId }. */
  getCtx: () => EditorContext;
  /** Override the network turn (tests / web-llm backend). Defaults to a POST
   *  to `/api/rag/assist`. */
  postTurn?: PostTurn;
  /** Fire-and-forget error capture (e.g. POST `/api/ai/fix-errors`). Optional. */
  logFixError?: (rec: FixErrorInput) => void;
  /** Per-request model override. */
  model?: string;
  /** Keep the message thread across `run()` calls so "now make it taller"
   *  continues with context. Default true. */
  continueThread?: boolean;
};

/** Default per-turn proxy: POST the running thread to the server-side Anthropic
 *  endpoint. The endpoint uses `messages` verbatim and re-injects `graphState`
 *  into the (cached-prefix) system prompt every turn. */
async function defaultPostTurn(body: {
  messages: AnthMessage[];
  graphState: unknown;
  model?: string;
}): Promise<AssistTurnResponse> {
  const res = await fetch('/api/rag/assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.text()) || detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(`assist endpoint ${res.status}: ${detail}`);
  }
  return (await res.json()) as AssistTurnResponse;
}

export type AssistSession = {
  /** True while a `run()` loop is in flight. */
  readonly running: boolean;
  /** Terminal error of the last run (postTurn threw), else null. */
  readonly error: string | null;
  /** The transcript — accumulates across `run()` calls until `reset()`. */
  readonly steps: AssistStep[];
  /** Whether a Stop has been requested for the in-flight run. */
  readonly stopping: boolean;
  /** Run the loop for one instruction. No-op if empty or already running. */
  run: (prompt: string) => Promise<AssistRunResult | undefined>;
  /** Cooperatively halt the in-flight run after the current turn. */
  requestStop: () => void;
  /** Alias of requestStop. */
  stop: () => void;
  /** Clear the transcript, error, and message thread. */
  reset: () => void;
};

export function createAssistSession(opts: CreateAssistSessionOpts): AssistSession {
  let running = $state(false);
  let error = $state<string | null>(null);
  let steps = $state<AssistStep[]>([]);
  let stopping = $state(false);

  // Message thread carried across run() calls for chat-style continuation.
  let thread: AnthMessage[] = [];

  const postTurn = opts.postTurn ?? defaultPostTurn;
  const continueThread = opts.continueThread ?? true;

  async function run(prompt: string): Promise<AssistRunResult | undefined> {
    const instruction = (prompt ?? '').trim();
    if (!instruction || running) return undefined;

    running = true;
    error = null;
    stopping = false;

    const deps: AssistLoopDeps = {
      getGraph: opts.getGraph,
      setGraph: opts.setGraph,
      getCtx: opts.getCtx,
      postTurn,
      logFixError: opts.logFixError,
      model: opts.model,
      shouldStop: () => stopping,
      // Push each step into reactive $state (reassign so Svelte tracks it).
      onStep: (s) => {
        steps = [...steps, s];
      },
      priorMessages: continueThread ? thread : undefined,
    };

    try {
      const result = await runAssistLoop(instruction, deps);
      if (continueThread) thread = result.messages;
      if (result.status === 'error') error = result.error ?? 'assist failed';
      return result;
    } catch (e) {
      // runAssistLoop is contracted not to throw, but never let an unexpected
      // throw wedge the session's busy flag.
      const msg = e instanceof Error ? e.message : String(e);
      error = msg;
      steps = [...steps, { kind: 'error', text: msg }];
      return undefined;
    } finally {
      running = false;
      stopping = false;
    }
  }

  function requestStop() {
    if (running) stopping = true;
  }

  function reset() {
    steps = [];
    error = null;
    thread = [];
  }

  return {
    get running() {
      return running;
    },
    get error() {
      return error;
    },
    get steps() {
      return steps;
    },
    get stopping() {
      return stopping;
    },
    run,
    requestStop,
    stop: requestStop,
    reset,
  };
}
