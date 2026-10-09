import { describe, expect, it } from 'vitest'
import type { HybridRetrievalHit } from './rag'
import { applyReranker, rrfReranker, type Reranker } from './reranker'

function hit(documentId: string, rrfScore: number, score?: number): HybridRetrievalHit {
  return { documentId, chunkIndex: 0, excerpt: '', rrfScore, score }
}

describe('reranker', () => {
  it('keeps the fused order for the default baseline', async () => {
    const hits = [hit('a', 0.9), hit('b', 0.5)]
    const result = await rrfReranker.rerank('query', hits, 5)
    expect(result.map(item => item.documentId)).toEqual(['a', 'b'])
  })

  it('breaks ties on the raw retrieval score', async () => {
    const hits = [hit('low', 0.5, 0.1), hit('high', 0.5, 0.9)]
    const result = await rrfReranker.rerank('query', hits, 5)
    expect(result.map(item => item.documentId)).toEqual(['high', 'low'])
  })

  it('applies the limit', async () => {
    const hits = [hit('a', 0.9), hit('b', 0.5), hit('c', 0.1)]
    expect(await rrfReranker.rerank('query', hits, 2)).toHaveLength(2)
  })

  it('falls back to the original order when a reranker throws', async () => {
    const broken: Reranker = {
      name: 'broken',
      rerank: async () => { throw new Error('model unavailable') },
    }
    const hits = [hit('a', 0.9), hit('b', 0.5)]
    const result = await applyReranker(broken, 'query', hits, 5)
    expect(result.map(item => item.documentId)).toEqual(['a', 'b'])
  })
})