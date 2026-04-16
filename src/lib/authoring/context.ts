/**
 * Growing context doc builder.
 *
 * Regenerated every time an authored component is saved. The result is
 * written to training_data/authored_context.md and loaded into the
 * system prompt of /api/author/suggest as a cached preamble. This gives
 * Claude a global view of everything the user has built, complementing
 * the top-K few-shot examples from findSimilar.
 *
 * The doc is capped at ~2000 tokens so it stays inside the prompt-cache
 * budget. Each component gets a 1-line structural fingerprint.
 */

import type { AuthoredCache } from './cache';
import { writeFileSync, renameSync } from 'fs';

/**
 * Build a markdown summary of all authored components in the cache.
 */
export function buildContextDoc(cache: AuthoredCache): string {
  const records = cache.getAll();
  if (records.length === 0) return '# Authored Components\n\nNo components authored yet.\n';

  const lines = records.map((r) => {
    const partSummary = r.parts.map((p) => p.prim).join(' + ');
    const opSummary = r.ops.length > 0
      ? r.ops.map((o) => `${o.op}(${o.inputs.join(',')})`).join(', ')
      : 'implicit union';
    const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
    return `- **${r.name}** (\`${r.id}\`): ${partSummary} | ${opSummary}${tags}`;
  });

  return [
    '# Authored Components',
    '',
    `${records.length} components built so far. Use these as reference when suggesting new compositions.`,
    '',
    ...lines,
    '',
  ].join('\n');
}

/**
 * Atomically write the context doc to disk. Same temp+rename pattern
 * as the JSONL caches.
 */
export function writeContextDoc(path: string, cache: AuthoredCache): void {
  const doc = buildContextDoc(cache);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, doc);
  renameSync(tmp, path);
}
