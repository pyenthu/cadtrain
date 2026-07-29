// src/lib/appkit/verbs/registry.ts
// Layer 1 — the SINGLE SOURCE OF TRUTH for the app harness.
// Every app operation is defined ONCE here and projects to the AI tool schema
// (schema/to-aisdk.ts), the HTTP routes (routes/api/app/verb/[name]), and the
// authoring guide (schema/to-apimd.ts). See docs/architecture/app-harness.md §2.
import { DATA_VERBS } from './data';
import { MUTATE_VERBS } from './mutate';
import { GUI_VERBS } from './gui';

/** A minimal JSON-Schema — the AI-facing `params` contract on each verb. */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema & { description?: string }>;
  required?: string[];
  items?: JSONSchema;
  [k: string]: unknown;
}

export type VerbGroup = 'data' | 'mutate' | 'gui';

/** The live `.app` document a gui/mutate verb edits (self-contained; see §4). */
export interface AppDoc {
  app: string;
  title?: string;
  docType?: string;
  panels?: Array<Record<string, unknown>>;
  popovers?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** A document the engine can enumerate (a volume part / well). */
export interface EngineDoc {
  id: string;
  name?: string;
  params?: Record<string, unknown>;
  source?: string;
}

/** The capability the data/mutate verbs call — INJECTED by the environment (a client
 *  engine that fetches /api/primitives/*, or a server engine in the AI loop). Keeps
 *  the verbs pure + environment-agnostic. */
export interface AppEngine {
  list(opts?: { docType?: string; category?: string }): Promise<EngineDoc[]>;
  /** Bake a doc with params → geometry stats (rung 3b). Optional — not every engine bakes. */
  bake?(id: string, params?: Record<string, unknown>): Promise<{ ok: boolean; verts?: number; tris?: number }>;
  /** A doc's source text (ENG-engine). */
  getSource?(id: string): Promise<{ source: string }>;
  /** Compile a doc → dep-inlined script + scriptHash (ENG-engine). */
  compile?(id: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** Runtime handles a verb handler may use. Optional so headless tests can dispatch
 *  with a partial Ctx. */
export interface Ctx {
  /** Load/patch a graph doc (Layer 3 — mutate verbs; rung 3b). */
  docStore?: unknown;
  /** Enumerate/bake docs — the injected engine (rung 3). */
  engine?: AppEngine;
  /** The live `.app` being authored (store/). */
  appStore?: AppDoc;
}

export interface Verb<A = any, R = any> {
  name: string;
  group: VerbGroup;
  /** AI-facing — this string IS the tool prompt. */
  desc: string;
  /** Input schema (the params contract). */
  params: JSONSchema;
  returns?: JSONSchema;
  handler: (args: A, ctx: Ctx) => Promise<R> | R;
}

/** The assembled catalog. Every projection (schema / HTTP / API.md) reads from this. */
export const VERBS: Verb[] = [...DATA_VERBS, ...MUTATE_VERBS, ...GUI_VERBS];

export function getVerb(name: string): Verb | undefined {
  return VERBS.find((v) => v.name === name);
}

export function verbsByGroup(group: VerbGroup): Verb[] {
  return VERBS.filter((v) => v.group === group);
}
