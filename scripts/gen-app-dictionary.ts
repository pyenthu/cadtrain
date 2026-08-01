// scripts/gen-app-dictionary.ts — generate the App-Builder RAG DICTIONARY from the SSOT
// (component catalog + verb registry) so the LOCAL model can build .app UIs without Claude.
// Re-run after enriching meta.ts / verbs. Emits docs/rag/app-builder-dictionary.md.
//   bun run scripts/gen-app-dictionary.ts
import { writeFileSync } from 'node:fs';
import { COMPONENT_CATALOG } from '../src/lib/appkit/catalog/components';
import { componentCard, componentIndex } from '../src/lib/appkit/ai/component-cards';
import { VERBS } from '../src/lib/appkit/verbs/registry';
import { toApiMd } from '../src/lib/appkit/schema/to-apimd';

const md = [
  '# App-Builder RAG Dictionary',
  '',
  '_Auto-generated from the SSOT by `bun run scripts/gen-app-dictionary.ts` — the component catalog',
  '(`appkit/catalog`) + the verb registry (`appkit/verbs`). This is what the LOCAL model reads to',
  'build `.app` UIs with NO Claude API (restricted / air-gapped). Regenerate after enriching a',
  '`meta.ts` or a verb — it never drifts from the code._',
  '',
  `**${COMPONENT_CATALOG.length} components · ${VERBS.length} verbs**`,
  '',
  '---',
  '',
  '## Components — the UI kinds you can place',
  '',
  `Index — ${componentIndex()}`,
  '',
  'Each card: what it is · when to reach for it · props · a concrete example call.',
  '',
  ...COMPONENT_CATALOG.map((m) => componentCard(m) + '\n'),
  '',
  '---',
  '',
  '## Verbs — the function-calls you emit',
  '',
  toApiMd(VERBS),
  '',
].join('\n');

writeFileSync('docs/rag/app-builder-dictionary.md', md);
console.log(`docs/rag/app-builder-dictionary.md — ${COMPONENT_CATALOG.length} components · ${VERBS.length} verbs`);
