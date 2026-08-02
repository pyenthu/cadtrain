// src/lib/appkit/verbs/api.ts — the `http` verb: a declarative HTTP call. Lets an .app
// wire a panel source or an event action to an app-API / external endpoint. Runs on the
// universal fetch (client + server). Group 'data' → referenceable in bindings + kept by
// sanitize. Same-origin relative URLs (/api/…) are the common case.
import type { Verb } from './registry';

export interface HttpArgs {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Dotted path to select from the response (e.g. "data.items" → feed a list panel). */
  pick?: string;
}

export async function httpCall(a: HttpArgs): Promise<unknown> {
  if (!a?.url) throw new Error('appkit: http verb needs a url');
  const method = (a.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(a.headers ?? {}) };
  const init: RequestInit = { method, headers };
  if (a.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(a.url, init);
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!a.pick) return data;
  return a.pick.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), data);
}

export const API_VERBS: Verb[] = [
  {
    name: 'loadData',
    group: 'data',
    desc:
      'Read the DATA a File component opened into a slot (§0.5 — the app is stateless; data ' +
      'lives in files). { slot, pick? } → the parsed content (or a nested path via pick). Wire ' +
      "a component's source to it: {verb:'loadData', args:{slot:'well'}}.",
    example: { args: { slot: 'well', pick: 'casings' }, note: 'read the casings rows from the opened well file' },
    params: {
      type: 'object',
      properties: {
        slot: { type: 'string', description: 'The file-slot name (declared in app.files).' },
        pick: { type: 'string', description: 'Dotted path to select from the file data.' },
      },
      required: ['slot'],
    },
    returns: {},
    handler: (a: { slot: string; pick?: string }, ctx) => {
      const data = ctx.slots?.[a.slot]?.data;
      if (!a.pick) return data;
      return a.pick.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), data);
    },
  },
  {
    name: 'http',
    group: 'data',
    desc:
      'Call an HTTP endpoint declaratively: { url, method?, body?, headers?, pick? }. Returns the ' +
      'parsed JSON (or text). "pick" selects a nested path (e.g. "data.items") — use it to feed a ' +
      'list panel an array. Same-origin URLs like "/api/..." are typical. Wire it as a panel source ' +
      'or an on-event action.',
    example: { args: { url: '/api/primitives/list', pick: 'items' }, note: 'GET a list and feed a grid its rows' },
    params: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The endpoint URL (relative /api/... or absolute).' },
        method: { type: 'string', description: 'GET (default) | POST | PUT | DELETE.' },
        body: { type: 'object', description: 'Request body (JSON-encoded for non-GET).' },
        headers: { type: 'object' },
        pick: { type: 'string', description: 'Dotted path to select from the response.' },
      },
      required: ['url'],
    },
    returns: {},
    handler: (a: HttpArgs) => httpCall(a),
  },
];
