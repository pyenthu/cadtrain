// src/lib/appkit/ai/prompt.ts — the builder's system prompt + verb-list parser, extracted so
// BOTH the server paths (pipeline.ts / build-cli.ts) AND the in-browser WebLLM path (#40) can
// use them WITHOUT pulling in the Vercel AI SDK ('ai'). Pure + client-safe: imports only the
// headless verb registry, the API.md projection, and the component-knowledge cards.
import { VERBS, verbsByGroup, type AppDoc } from '../verbs/registry';
import { toApiMd } from '../schema/to-apimd';
import { renderComponentKnowledge, collectKinds } from './component-cards';

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

/** The instruction appended for the EMIT-verbs paths (CLI + WebLLM) — the model can't run our
 *  tool callbacks, so it outputs a JSON array of {verb,args} which we dispatch ourselves. */
export function emitInstruction(): string {
  const guiNames = verbsByGroup('gui').map((v) => v.name);
  return [
    '',
    'OUTPUT FORMAT: respond with ONLY a JSON array of gui-verb calls that build the app —',
    'no prose, no markdown fences, no explanation. Each element is',
    `{"verb": "<one of: ${guiNames.join(', ')}>", "args": { ... }}.`,
    'They run in order and mutate the app in place. Example:',
    '[{"verb":"definePanel","args":{"panel":{"id":"t","kind":"text","props":{"text":"Hi","color":"red"}}}}]',
  ].join('\n');
}

/** Pull the JSON verb array out of the model's text, tolerating ```fences``` + surrounding
 *  prose. Pure → unit-testable without spawning anything. */
export function parseVerbCalls(raw: string): Array<{ verb: string; args: unknown }> {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is { verb: string; args?: unknown } => !!x && typeof (x as { verb?: unknown }).verb === 'string')
    .map((x) => ({ verb: x.verb, args: x.args ?? {} }));
}
