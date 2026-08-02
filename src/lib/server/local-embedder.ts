// src/lib/server/local-embedder.ts — the LOCAL EmbeddingProvider (D11) via transformers.js.
//
// Residency-clean: the embed model runs on OUR infra (Node here; the SAME lib runs in-browser later,
// so the vector index is portable) — never a 3rd-party embeddings API, so retrieval quality improves
// without user prompts egressing. `bge-small-en-v1.5`: 384-dim, ~33MB quantized, strong short-text
// retrieval. The model + onnxruntime are loaded LAZILY on first embed (dynamic import) so nothing is
// paid unless vector retrieval is actually switched on (APP_RAG_VECTOR).
import type { EmbeddingProvider } from '$lib/appkit/ai/embeddings';
import { l2normalize } from '$lib/appkit/ai/embeddings';

const MODEL = 'Xenova/bge-small-en-v1.5';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipePromise: Promise<any> | null = null;
function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', MODEL);
    })();
  }
  return pipePromise;
}

export const localEmbedder: EmbeddingProvider = {
  id: MODEL,
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const pipe = await getPipe();
    // mean-pool over tokens + normalize → one 384-vec per input text.
    const out = await pipe(texts, { pooling: 'mean', normalize: true });
    // `out` is a Tensor [n, dim]; `.tolist()` → nested number[][].
    const data = (typeof out?.tolist === 'function' ? out.tolist() : out) as number[][];
    return data.map(l2normalize);
  },
};
