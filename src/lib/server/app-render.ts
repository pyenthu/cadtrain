// src/lib/server/app-render.ts — server-side data resolution for the SSR harness
// (app-server-render.md, Phase 1). Walks the .app tree; for every panel whose component is
// `dataMode:'server'` (catalog) and has a `source`, resolves it through the injected engine
// via dispatch → a { panelId → data } map baked into the first paint. Panels read it
// synchronously; unresolved ones (e.g. sources needing $active before any selection) fall
// back to the client onMount fetch. Headless (no Svelte) — appkit + an injected engine only.
import { dispatch } from '$lib/appkit/verbs/dispatch';
import { resolveArgs } from '$lib/appkit/manifest/refs';
import { getComponentMeta } from '$lib/appkit/catalog/components';
import type { AppEngine } from '$lib/appkit/verbs/registry';

type Panel = { id?: string; kind?: string; source?: { verb: string; args?: Record<string, unknown> }; children?: Panel[] };

export async function resolvePreloaded(
  app: { panels?: Panel[] } & Record<string, unknown>,
  engine: AppEngine,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const ctx = { engine, appStore: app as any };

  async function walk(panels: Panel[] | undefined): Promise<void> {
    for (const p of panels ?? []) {
      const mode = p.kind ? getComponentMeta(p.kind)?.dataMode : undefined;
      if (mode === 'server' && p.id && p.source?.verb) {
        try {
          // No active/item/params at first paint — refs like $active resolve to undefined,
          // so refs-only sources simply stay unresolved and the client fills them in.
          const args = resolveArgs(p.source.args, {});
          out[p.id] = await dispatch(p.source.verb, args, ctx);
        } catch {
          /* leave unresolved → client onMount fetch handles it */
        }
      }
      if (p.children) await walk(p.children);
    }
  }

  await walk(app.panels);
  return out;
}
