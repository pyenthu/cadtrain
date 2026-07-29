// src/lib/appkit/ai/pipeline.ts — Layer 5, the BUILD stage (rung 4).
// Given a prompt + the live .app, the AI calls the GUI verbs to build the app's GUI.
// SERVER-SIDE ONLY (imports the Vercel AI SDK). Uses the SAME verb registry (SSOT) →
// AI SDK tools, so what the AI can do can never drift from the API. D8.
import { generateText, tool, jsonSchema, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { VERBS, verbsByGroup, type Ctx, type AppDoc, type AppEngine } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { toApiMd } from '../schema/to-apimd';
import { sanitizeApp } from './sanitize';

export interface BuildOpts {
  prompt: string;
  /** The live .app — the AI mutates it in place via the gui verbs. */
  app: AppDoc;
  apiKey: string;
  model?: string;
  engine?: AppEngine;
  maxSteps?: number;
  /** Few-shot grounding from past builds (rung 4a.2 learning loop). */
  grounding?: string;
}

export interface BuildResult {
  app: AppDoc;
  steps: number;
  text: string;
}

/** Run the Build stage: the model calls the GUI verbs to compose the .app. */
export async function buildApp(opts: BuildOpts): Promise<BuildResult> {
  const { prompt, app, apiKey, model = 'claude-sonnet-4-6', engine, maxSteps = 14, grounding = '' } = opts;
  const ctx: Ctx = { appStore: app, engine };

  // Only the GUI verbs are CALLABLE (they mutate the .app). data/mutate verbs are
  // documented in the system prompt so the AI REFERENCES them in panel bindings —
  // the Build stage composes GUI, it doesn't run data.
  const tools: Record<string, unknown> = {};
  for (const v of verbsByGroup('gui')) {
    tools[v.name] = tool({
      description: v.desc,
      inputSchema: jsonSchema(v.params as any),
      execute: async (args: unknown) => dispatch(v.name, args, ctx),
    });
  }

  const anthropic = createAnthropic({ apiKey });
  const result = await generateText({
    model: anthropic(model),
    system: systemPrompt(app, grounding),
    prompt,
    tools: tools as any,
    stopWhen: stepCountIs(maxSteps),
  });

  sanitizeApp(app); // drop any hallucinated-verb bindings the model emitted
  return { app, steps: result.steps?.length ?? 0, text: result.text ?? '' };
}

function systemPrompt(app: AppDoc, grounding = ''): string {
  const cur = { app: app.app, title: app.title, panels: (app.panels ?? []).map((p: any) => ({ id: p.id, kind: p.kind })) };
  return [
    ...(grounding ? [grounding, ''] : []),
    'You build a declarative app GUI by CALLING the provided gui tools (definePanel, addControl, bindAction, patchApp).',
    'The app is a .app manifest { app, title, panels[], popovers[] }; you edit THIS app in place via the tools.',
    'A panel has a "kind" (list, form, table, bake3d, svg, text, chat) and may carry a "source" binding {verb, args} plus "controls".',
    'A binding references a data/mutate verb by NAME; args may use $active (the selected doc), $item (a list row), or $params (the doc params).',
    '',
    'Verbs you can REFERENCE in bindings (only CALL the gui ones):',
    toApiMd(VERBS),
    '',
    `Current app: ${JSON.stringify(cur)}`,
    '',
    'A TEXT panel carries a "text" field and NO source. Only reference verbs that appear in the guide above — NEVER invent a verb name (e.g. there is no "static" verb).',
    'Guidance: a data app usually wants a list panel (source listDocs, onSelect loadDoc), a form panel (source getParams with id:"$active") holding a table control bound to a list<record> param with an add verb, and a bake3d panel (source bake, id:"$active"). Keep panel ids short. Do NOT explain — just call the tools to build what the user asked for.',
  ].join('\n');
}
