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

export interface BuildResult {
  app: AppDoc;
  steps: number;
  text: string;
}

/** Run the Build stage: the model calls the GUI verbs to compose the .app. */
export async function buildApp(opts: BuildOpts): Promise<BuildResult> {
  const { prompt, app, apiKey, model, provider, baseURL, engine, maxSteps = 14, grounding = '' } = opts;
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

  const result = await generateText({
    model: resolveModel({ provider, apiKey, model, baseURL }),
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
    'A panel has a "kind" (list, form, table, grid, edittable, bake3d, svg, text, chat, container, card, button, tabs, toolbar) and may carry a "source" binding {verb, args} plus "controls". grid = a read-only data table from any source (props.columns); edittable = rows editable in the CLIENT (add/edit/delete are instant, local — no server) seeded from source, with on.save wired to a persist verb (the only round-trip); tabs/toolbar = layout containers with children (tabs: props.labels; toolbar: props.align).',
    'A binding references a data/mutate verb by NAME; args may use $active (the selected doc), $item (a list row), or $params (the doc params).',
    'Layout/HTML kinds: div (generic block), row (horizontal), col (vertical), card (bordered) all HOLD "children"; heading (props.level+text) + divider are display. A panel may carry "props" (typed per its kind) and "children" (nested panels — HTML-style encapsulation): e.g. a div with children [{kind:"heading",props:{text:"Casings",level:2}}, {kind:"row", children:[{kind:"edittable",...},{kind:"bake3d",...}]}]. Nest freely; the addChildPanel verb appends a child to a container by id.',
    'A "button" panel fires declarative events: on:{ click: {verb,args} } or a SEQUENCE on:{ click: [{verb:"save"},{verb:"bake"}] } run in order. props:{label, variant:"ghost"?}. Any node may carry an "on" event map.',
    'Grid placement: a panel may carry "layout" {col,row,w,h} (12-column grid; w = column span). A theme: app.theme {mode:"light"|"dark", accent:"#hex"}.',
    'Computed variables: app.computed { name: "= formula" } (e.g. {"area":"= w * h", "label":"= \\"area=\\" + area"}) — arithmetic/logic; formulas reference the doc params by NAME directly (w, h, rows) or params.x, and earlier vars by name. Reference a computed value elsewhere as $vars.<name> (e.g. a text prop text:"$vars.area", or a binding arg).',
    'API calls: the "http" verb calls any endpoint declaratively — wire it as a panel source {verb:"http", args:{url:"/api/...", pick:"items"}} or a button on.click {verb:"http", args:{url:"/api/...", method:"POST", body:{...}}}.',
    'Data files (the app is STATELESS — data lives in files): declare app.files [{slot,type,label}]; add a "file" panel (props.slot) so the user opens a data file into that slot; wire any component source to it via {verb:"loadData", args:{slot:"well", pick?:"casings"}}. An app can have MULTIPLE slots.',
    '',
    'Verbs you can REFERENCE in bindings (only CALL the gui ones):',
    toApiMd(VERBS),
    '',
    `Current app: ${JSON.stringify(cur)}`,
    '',
    'A TEXT panel carries props {text, size, weight, align, color, muted} and NO source. Only reference verbs that appear in the guide above — NEVER invent a verb name (e.g. there is no "static" verb).',
    'Guidance: a data app usually wants a list panel (source listDocs, onSelect loadDoc), a form panel (source getParams with id:"$active") holding a table control bound to a list<record> param with an add verb, and a bake3d panel (source bake, id:"$active"). Keep panel ids short. Do NOT explain — just call the tools to build what the user asked for.',
  ].join('\n');
}
