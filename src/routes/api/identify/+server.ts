/**
 * POST /api/identify
 *
 * Retrieval-Augmented identification:
 * 1. Compute pHash of uploaded image
 * 2. Retrieve top-K most similar training records from persistent cache
 * 3. Build few-shot Claude prompt with catalog + retrieved examples + target
 * 4. Return identified component + estimated params
 */

import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { COMPONENTS } from '$components/library';
import { env } from '$env/dynamic/private';
import { getCache } from '$lib/training/cache';
import { computePHash } from '$lib/training/phash';
import type { RequestHandler } from './$types';
import { join } from 'path';

const CACHE_PATH = join(process.cwd(), 'training_data', 'cache.jsonl');
const TOP_K = 5;

export const POST: RequestHandler = async ({ request }) => {
  if (!env.ANTHROPIC_API_KEY) {
    throw error(500, 'ANTHROPIC_API_KEY not set');
  }

  const formData = await request.formData();
  const file = formData.get('image') as File;
  if (!file) throw error(400, 'No image file provided');

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');
  const mediaType = file.type || 'image/png';

  // === 1. Retrieve similar examples from cache ===
  const cache = await getCache(CACHE_PATH);
  const hash = await computePHash(buffer);
  const similar = cache.findSimilar(hash, TOP_K);

  console.log(`[identify] pHash=${hash}, retrieved ${similar.length} neighbors:`,
    similar.map((r) => `${r.component_id} (${r.source})`));

  // Increment use counter (background, not blocking)
  cache.incrementUse(similar.map((r) => r.id));

  // === 2. Build catalog prompt (cacheable) ===
  const catalog = COMPONENTS.map((c) => {
    const params = Object.entries(c.params)
      .map(([k, p]) => `${k} (${p.label}): ${p.min}-${p.max}`)
      .join(', ');
    return `- ${c.id} ("${c.name}") — ${c.description}\n  Tags: ${c.tags.join(', ')}\n  Params: ${params}`;
  }).join('\n\n');

  const catalogPrompt = `You are a downhole tool component identifier.

COMPONENT CATALOG (18 types):
${catalog}`;

  // === 3. Build messages with few-shot examples ===
  const content: any[] = [];

  // Catalog (cached)
  content.push({
    type: 'text',
    text: catalogPrompt,
    cache_control: { type: 'ephemeral' },
  });

  // Retrieved examples — each with image + known params
  if (similar.length > 0) {
    content.push({
      type: 'text',
      text: `\n\nHere are ${similar.length} similar examples from training data. Study them — they show how to identify and parameterize components like the target:`,
    });

    similar.forEach((rec, i) => {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: rec.image_b64 },
      });
      content.push({
        type: 'text',
        text: `Example ${i + 1} → component_id: "${rec.component_id}", params: ${JSON.stringify(rec.params)}`,
      });
    });
  }

  // Target image + instructions
  content.push({
    type: 'text',
    text: `\n\nNow identify this NEW image using the same format as the examples above:`,
  });
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: mediaType as any, data: base64 },
  });
  content.push({
    type: 'text',
    text: `Return ONLY a JSON object:
{
  "component_id": "...",
  "component_name": "...",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation referencing the examples if useful",
  "estimated_params": { ... }
}

Use the EXACT parameter keys from the component's param list. Reference the most similar training example in your reasoning.`,
  });

  // === 4. Call Claude ===
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    let text = (response.content[0] as any).text.trim();
    if (text.includes('```')) {
      text = text.split('```')[1];
      if (text.startsWith('json')) text = text.slice(4);
      text = text.trim();
    }

    const result = JSON.parse(text);

    // Include retrieval metadata for debugging
    result.retrieved_examples = similar.map((r) => ({
      id: r.id,
      component_id: r.component_id,
      distance: 'hamming',
      source: r.source,
    }));

    return json(result);
  } catch (e: any) {
    console.error('Identify error:', e);
    throw error(500, e.message || 'Identification failed');
  }
};
