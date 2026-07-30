// src/lib/appkit/ai/pipeline.ts — Layer 5, the BUILD stage (rung 4).
// Given a prompt + the live .app, the AI calls the GUI verbs to build the app's GUI.
// SERVER-SIDE ONLY (imports the Vercel AI SDK). Uses the SAME verb registry (SSOT) →
// AI SDK tools, so what the AI can do can never drift from the API. D8.
import { generateText, tool, jsonSchema, stepCountIs } from 'ai';
import { resolveModel, type Provider } from './providers';
import { VERBS, verbsByGroup, type Ctx, type AppDoc, type AppEngine } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { toApiMd } from '../schema/to-apimd';
import { sanitizeApp } from './sanitize';
import { renderComponentKnowledge, collectKinds } from './component-cards';

export interface BuildOpts {
  prompt: string;
  /** The live .app — the AI mutates it in place via the gui verbs. */
  app: AppDoc;
  /** Cloud key (required for provider 'cloud'; unused for 'local'). */
  apiKey?: string;
  model?: string;
  /** 'cloud' (Anthropic, default) or 'local' (Ollama) — rung 5. */
  provider?: Provider;
  baseURL?: string;
  engine?: AppEngine;
  maxSteps?: number;
  /** Few-shot grounding from past builds (rung 4a.2 learning loop). */
  grounding?: string;
}

/** One gui-verb call the model made during a build — the actual action + args + outcome.
 *  This is what turns "N steps ran" into "setComponentProp({panelId,name:'color',value:'red'})". */
export interface VerbCall {
  verb: string;
  args: unknown;
  ok: boolean;
  error?: string;
}

export interface BuildResult {
  app: AppDoc;
  steps: number;
  text: string;
  /** The ordered list of verb calls the model emitted (drives debugging + the learning loop). */
  trace: VerbCall[];
  /** The RAW model output the verbs were parsed from — set on the CLI path (the emitted JSON
   *  verb-list text). Undefined on the native tool-call path (calls arrive as tool_use, not text).
   *  Its whole value is debugging a build that parsed to 0 verbs: you see what the model said. */
  raw?: string;
}

/** Run the Build stage: the model calls the GUI verbs to compose the .app. */
export async function buildApp(opts: BuildOpts): Promise<BuildResult> {
  const { prompt, app, apiKey, model, provider, baseURL, engine, maxSteps = 14, grounding = '' } = opts;
  const ctx: Ctx = { appStore: app, engine };

  // Only the GUI verbs are CALLABLE (they mutate the .app). data/mutate verbs are
  // documented in the system prompt so the AI REFERENCES them in panel bindings —
  // the Build stage composes GUI, it doesn't run data.
  const trace: VerbCall[] = [];
  const tools: Record<string, unknown> = {};
  for (const v of verbsByGroup('gui')) {
    tools[v.name] = tool({
      description: v.desc,
      inputSchema: jsonSchema(v.params as any),
      execute: async (args: unknown) => {
        try {
          const out = await dispatch(v.name, args, ctx);
          trace.push({ verb: v.name, args, ok: true });
          return out;
        } catch (e) {
          trace.push({ verb: v.name, args, ok: false, error: String((e as any)?.message ?? e) });
          throw e;
        }
      },
    });
  }

  const result = await generateText({
    model: resolveModel({ provider, apiKey, model, baseURL }),
    system: systemPrompt(app, grounding, prompt),
    prompt,
    tools: tools as any,
    stopWhen: stepCountIs(maxSteps),
  });

  sanitizeApp(app); // drop any hallucinated-verb bindings the model emitted
  return { app, steps: result.steps?.length ?? 0, text: result.text ?? '', trace };
}

export function systemPrompt(app: AppDoc, grounding = '', prompt = ''): string {
  const cur = { app: app.app, title: app.title, panels: (app.panels ?? []).map((p: any) => ({ id: p.id, kind: p.kind })) };
  const appKinds = collectKinds(app.panels as any);
  return [
    ...(grounding ? [grounding, ''] : []),
    'You build a declarative app GUI by CALLING the provided gui tools (definePanel, addChildPanel, setComponentProp, setPanelProp, patchApp). You edit the .app manifest { app, title, panels[], popovers[] } in place.',
    'A panel has a "kind", "props" (typed per kind — see COMPONENT KNOWLEDGE below), an optional "source" binding {verb,args} (its data), an "on" event map, "layout" {col,row,w,h} (12-col grid; w = span), and "children" (nested panels, HTML-style; a kind that HOLDS children nests via children[] or the addChildPanel verb).',
    '',
    renderComponentKnowledge(prompt, appKinds),
    '',
    'Data-component wiring: list (source listDocs, onSelect loadDoc) · form (source getParams id:"$active") · table/grid = read-only rows from a source (props.columns) · edittable = rows editable in the CLIENT (add/edit/delete instant, local — no server), seeded from source, on.save wired to a persist verb (the only round-trip) · bake3d (source bake id:"$active").',
    'A binding references a data/mutate verb by NAME; args may use $active (the selected doc), $item (a list row), or $params (the doc params).',
    'Events: on:{ click:{verb,args} } or a SEQUENCE on:{ click:[{verb:"save"},{verb:"bake"}] } run in order. Any node may carry an "on" event map.',
    'Computed variables: app.computed { name:"= formula" } (arithmetic/logic over params + earlier vars) — reference elsewhere as $vars.<name>.',
    'API calls: the "http" verb — a source {verb:"http",args:{url:"/api/...",pick:"items"}} or a button on.click {verb:"http",args:{url,method,body}}.',
    'Data files (the app is STATELESS — data lives in files): app.files [{slot,type,label}] + a "file" panel (props.slot); wire a source via {verb:"loadData",args:{slot:"well",pick?:"casings"}}.',
    'Theme: app.theme {mode:"light"|"dark", accent:"#hex"}.',
    '',
    'Verbs you can REFERENCE in bindings (only CALL the gui ones):',
    toApiMd(VERBS),
    '',
    `Current app: ${JSON.stringify(cur)}`,
    '',
    'Only reference verbs that appear in the guide above — NEVER invent a verb name (e.g. there is no "static" verb). Keep panel ids short. Do NOT explain — just call the tools to build what the user asked for.',
  ].join('\n');
}
