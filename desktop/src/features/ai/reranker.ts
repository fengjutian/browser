import type { HybridRetrievalHit } from './rag'

/**
 * Reranking stage applied after hybrid retrieval.
 *
 * Kept as a swappable interface so a cross-encoder or LLM reranker can replace
 * the default without touching the retrieval pipeline.
 */
export interface Reranker {
  readonly name: string
  rerank(query: string, hits: readonly HybridRetrievalHit[], limit: number): Promise<HybridRetrievalHit[]>
}

/**
 * Default reranker: the fused RRF score with the raw retrieval score as the
 * tie-breaker.
 *
 * This is intentionally a no-op reordering relative to `reciprocalRankFusion`,
 * but it defines the contract and gives a single place to swap in a real model
 * later. Deterministic and dependency-free.
 */
export const rrfReranker: Reranker = {
  name: 'rrf-baseline',
  async rerank(_query, hits, limit) {
    return [...hits]
      .sort((left, right) => right.rrfScore - left.rrfScore || (right.score ?? 0) - (left.score ?? 0))
      .slice(0, Math.max(1, limit))
  },
}

/** Run `hits` through `reranker`, falling back to the input order on failure. */
export async function applyReranker(
  reranker: Reranker,
  query: string,
  hits: readonly HybridRetrievalHit[],
  limit: number,
): Promise<HybridRetrievalHit[]> {
  try {
    return await reranker.rerank(query, hits, limit)
  } catch {
    // A reranker is an enhancement: never let it break retrieval.
    return hits.slice(0, Math.max(1, limit))
  }
}