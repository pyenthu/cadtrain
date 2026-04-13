/**
 * POST /api/refine
 *
 * Iterative refinement step:
 * - Compares uploaded image vs current 3D render via Python (cv2/skimage)
 * - If not converged, asks Claude to suggest new params
 * - Returns updated params + scores
 */

import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { COMPONENTS } from '$components/library';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import { compareImages } from '$lib/training/image_diff';
import type { RequestHandler } from './$types';

const SSIM_THRESHOLD = 0.92;

function dataUrlToBuffer(dataUrl: string): Buffer {
  const b64 = dataUrl.split(',')[1] || dataUrl;
  return Buffer.from(b64, 'base64');
}

export const POST: RequestHandler = async ({ request }) => {
  if (!ANTHROPIC_API_KEY) {
    throw error(500, 'ANTHROPIC_API_KEY not set');
  }

  const body = await request.json();
  const { original_image, current_render, component_id, current_params } = body;

  if (!original_image || !current_render || !component_id) {
    throw error(400, 'Missing required fields');
  }

  const comp = COMPONENTS.find(c => c.id === component_id);
  if (!comp) throw error(400, `Unknown component_id: ${component_id}`);

  // === 1. Compare images via pure-TS implementation ===
  let scores: any = {};
  try {
    const origBuffer = dataUrlToBuffer(original_image);
    const rendBuffer = dataUrlToBuffer(current_render);
    scores = await compareImages(origBuffer, rendBuffer);
  } catch (e: any) {
    scores = { error: e.message };
  }

  // === 2. Check convergence ===
  const ssim = scores.ssim || 0;
  if (ssim >= SSIM_THRESHOLD) {
    return json({
      converged: true,
      scores,
      message: `Converged at SSIM ${ssim.toFixed(3)}`,
    });
  }

  // === 4. Ask Claude to suggest new params ===
  const paramSpec = Object.entries(comp.params)
    .map(([k, p]) => `${k} (${p.label}): ${p.min}-${p.max}, current=${current_params[k]}`)
    .join('\n');

  const prompt = `You are tuning a parametric 3D CAD model to match a target image.

Component: ${comp.name} (${comp.id})
Description: ${comp.description}

Current parameters:
${paramSpec}

Image comparison scores (target vs current render):
- SSIM: ${scores.ssim} (1.0 = identical)
- Pixel diff: ${scores.pixel_diff_pct}%
- Edge diff: ${scores.edge_diff_pct}%
- Shape match: ${scores.shape_match}

The TARGET image is shown first. The CURRENT RENDER is shown second.

Look at both images and propose UPDATED parameter values that would make the render match the target better. Consider:
- Aspect ratio differences (length vs OD)
- Wall thickness (visible bore size)
- Feature counts (threads, grooves, slots)
- Proportions of sub-features

Return ONLY a JSON object with the new parameter values:
{
  "new_params": { "od": 2.8, "wall": 0.25, "length": 5.2 },
  "reasoning": "The target is taller and thinner — increased length, decreased OD"
}

Use the EXACT param keys shown above. Stay within the min/max ranges. Make proportional changes (don't overshoot).`;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'TARGET image (what we want to match):' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: dataUrlToBuffer(original_image).toString('base64') },
            },
            { type: 'text', text: 'CURRENT RENDER (3D model with current params):' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: dataUrlToBuffer(current_render).toString('base64') },
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

    return json({
      converged: false,
      scores,
      new_params: result.new_params,
      reasoning: result.reasoning,
    });
  } catch (e: any) {
    console.error('Refine error:', e);
    throw error(500, e.message || 'Refinement failed');
  }
};
