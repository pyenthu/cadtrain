/**
 * POST /api/identify
 *
 * Accepts an image upload, sends it to Claude vision with the component
 * library, and returns the identified component + estimated parameters.
 */

import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { COMPONENTS } from '$components/library';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  if (!ANTHROPIC_API_KEY) {
    throw error(500, 'ANTHROPIC_API_KEY not set in .env');
  }

  const formData = await request.formData();
  const file = formData.get('image') as File;

  if (!file) {
    throw error(400, 'No image file provided');
  }

  // Convert to base64
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mediaType = file.type || 'image/png';

  // Build component catalog text
  const catalog = COMPONENTS.map((c) => {
    const params = Object.entries(c.params)
      .map(([k, p]) => `${k} (${p.label}): ${p.min}-${p.max}`)
      .join(', ');
    return `- ${c.id} ("${c.name}") — ${c.description}\n  Tags: ${c.tags.join(', ')}\n  Params: ${params}`;
  }).join('\n\n');

  const prompt = `You are a downhole tool component identifier. The user uploaded a cross-section image of a parametric tool component.

Match the image to ONE of these 18 components:

${catalog}

Look at the image and:
1. Identify which component_id best matches the shape
2. Estimate parameter values based on visible proportions (use the param ranges as guide)
3. Provide a confidence score (0-1) and brief reasoning

Return ONLY a JSON object with this exact structure:
{
  "component_id": "hollow_cylinder",
  "component_name": "Hollow Cylinder",
  "confidence": 0.85,
  "reasoning": "Clear plain tube shape, no threads, visible wall thickness",
  "estimated_params": {
    "od": 2.5,
    "wall": 0.3,
    "length": 4.0
  }
}

Use the EXACT parameter keys from the component's param list (lowercase, snake_case where applicable).`;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType as any, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    let text = (response.content[0] as any).text.trim();
    if (text.includes('```')) {
      text = text.split('```')[1];
      if (text.startsWith('json')) text = text.slice(4);
      text = text.trim();
    }

    const result = JSON.parse(text);
    return json(result);
  } catch (e: any) {
    console.error('Identify error:', e);
    throw error(500, e.message || 'Identification failed');
  }
};
