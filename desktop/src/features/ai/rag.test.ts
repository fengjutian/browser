import { describe, expect, it } from 'vitest'
import { evaluateRetrieval, reciprocalRankFusion, validateAnswerCitations } from './rag'

const hit = (documentId: string, chunkIndex: number, excerpt = documentId) => ({ documentId, chunkIndex, excerpt })

describe('reciprocalRankFusion', () => {
  it('promotes chunks found by both keyword and vector retrieval', () => {
    const result = reciprocalRankFusion(
      [hit('keyword-only', 0), hit('shared', 0)],
      [hit('shared', 0), hit('vector-only', 0)],
      { limit: 3 },
    )
    expect(result[0].documentId).toBe('shared')
    expect(result[0].keywordRank).toBe(2)
    expect(result[0].vectorRank).toBe(1)
  })

  it('deduplicates identical chunks and caps chunks from one document', () => {
    const result = reciprocalRankFusion(
      [hit('a', 0), hit('a', 1), hit('a', 2), hit('b', 0)],
      [hit('a', 0), hit('a', 1)],
      { limit: 8, maxChunksPerDocument: 2 },
    )
    expect(result.filter(item => item.documentId === 'a')).toHaveLength(2)
    expect(result.filter(item => item.documentId === 'a' && item.chunkIndex === 0)).toHaveLength(1)
    expect(result.some(item => item.documentId === 'b')).toBe(true)
  })
})

describe('validateAnswerCitations', () => {
  it('accepts statements grounded in known citations', () => {
    const result = validateAnswerCitations('SQLite 支持事务。[doc-1]\nFTS5 用于全文检索。[doc-2]', [1, 2])
    expect(result.valid).toBe(true)
    expect(result.citedIds).toEqual([1, 2])
  })

  it('reports unknown citations and uncited factual statements', () => {
    const result = validateAnswerCitations('第一句没有引用。第二句有错误引用。[doc-9]', [1, 2])
    expect(result.valid).toBe(false)
    expect(result.unknownIds).toEqual([9])
    expect(result.uncitedStatements).toEqual(['第一句没有引用。'])
  })

  it('allows the explicit not-found response without citations', () => {
    expect(validateAnswerCitations('知识库中未找到相关信息。', []).valid).toBe(true)
  })
})

describe('evaluateRetrieval', () => {
  it('computes macro recall at K and mean reciprocal rank', () => {
    const metrics = evaluateRetrieval([
      { relevantDocumentIds: ['a', 'b'], retrievedDocumentIds: ['x', 'a', 'b'] },
      { relevantDocumentIds: ['c'], retrievedDocumentIds: ['c', 'z'] },
    ], 2)
    expect(metrics.recallAtK).toBeCloseTo(0.75)
    expect(metrics.meanReciprocalRank).toBeCloseTo(0.75)
    expect(metrics.evaluatedCases).toBe(2)
  })

  it('returns stable zero metrics for an empty evaluation set', () => {
    expect(evaluateRetrieval([], 5)).toEqual({ recallAtK: 0, meanReciprocalRank: 0, evaluatedCases: 0 })
  })
})
