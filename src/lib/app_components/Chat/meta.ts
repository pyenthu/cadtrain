// app_components/Chat/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Chat.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'chat',
    name: 'AI Chat',
    description: 'The AI-build surface — a prompt box that edits the app.',
    useWhen:
      'An AI prompt box that edits the app itself — use to embed the AI-build/assistant surface ' +
      'inside a running app.',
    example: { id: 'ai', kind: 'chat' },
    dataMode: 'client',
    group: 'ai',
    tags: ['chat', 'ai', 'prompt', 'assistant', 'build', 'copilot'],
  },
];
