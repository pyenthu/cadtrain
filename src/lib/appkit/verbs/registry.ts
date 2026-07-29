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

/** Runtime handles a verb handler may use. Optional for now (filled in as later
 *  layers land) so headless tests can dispatch with a partial Ctx. */
export interface Ctx {
  /** Load/patch a graph doc (Layer 3 + engine). */
  docStore?: unknown;
  /** Bake via /api/primitives/bake-preview. */
  engine?: unknown;
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
