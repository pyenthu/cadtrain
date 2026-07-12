/**
 * Anthropic SDK wrapper. Both backends (identify, wells) instantiate the
 * client identically. Centralized here so model defaults / common headers
 * can evolve in one place.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

export function requireAnthropicKey(): void {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set (required for api backend)');
  }
}

export function createAnthropicClient(): Anthropic {
  requireAnthropicKey();
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}
