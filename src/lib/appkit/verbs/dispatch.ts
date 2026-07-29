// src/lib/appkit/verbs/dispatch.ts — run a verb by name. The single execution path
// shared by the AI loop (Layer 5) and the HTTP routes (/api/app/verb/[name]).
import { getVerb, type Ctx } from './registry';

export async function dispatch(name: string, args: unknown, ctx: Ctx = {}): Promise<unknown> {
  const verb = getVerb(name);
  if (!verb) throw new Error(`appkit: unknown verb "${name}"`);
  return verb.handler(args as any, ctx);
}
