// src/lib/appkit/ai/sanitize.ts — deterministic post-build cleanup: strip any binding
// that references an UNKNOWN verb (the model sometimes invents one, e.g. a "static"
// source on a text panel). Keeps the AI's output valid regardless of what it emitted.
// No AI-SDK import → headless-testable.
import { VERBS, type AppDoc } from '../verbs/registry';

const VERB_NAMES = new Set(VERBS.map((v) => v.name));
const BINDING_KEYS = ['source', 'onSelect', 'onEdit', 'add', 'onClick'] as const;

function knownVerb(b: unknown): boolean {
  return !!b && typeof b === 'object' && typeof (b as any).verb === 'string' && VERB_NAMES.has((b as any).verb);
}

function cleanBindings(o: any): void {
  if (!o || typeof o !== 'object') return;
  for (const k of BINDING_KEYS) if (o[k] && !knownVerb(o[k])) delete o[k];
}

/** Drop unknown-verb bindings across panels + controls + popovers (mutates in place). */
export function sanitizeApp(app: AppDoc): AppDoc {
  for (const p of (app.panels as any[]) ?? []) {
    cleanBindings(p);
    for (const c of (p.controls as any[]) ?? []) cleanBindings(c);
  }
  for (const p of (app.popovers as any[]) ?? []) cleanBindings(p);
  return app;
}
