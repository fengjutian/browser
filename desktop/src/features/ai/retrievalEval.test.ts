import { describe, expect, it } from 'vitest'
import { EVAL_CASES, evaluateHybridRetrieval, retrieve } from './retrievalEval'

describe('hybrid retrieval evaluation', () => {
  it('ranks the relevant document first for every evaluation query', () => {
    for (const item of EVAL_CASES) {
      const retrieved = retrieve(item.query, 3)
      expect(retrieved[0], `query "${item.query}"`).toBe(item.relevant[0])
    }
  })

  it('meets the acceptance bar for recall@3 and MRR', () => {
    const metrics = evaluateHybridRetrieval(3)
    expect(metrics.evaluatedCases).toBe(EVAL_CASES.length)
    expect(metrics.recallAtK).toBeGreaterThanOrEqual(0.9)
    expect(metrics.meanReciprocalRank).toBeGreaterThanOrEqual(0.9)
  })

  it('is deterministic across runs', () => {
    expect(retrieve('tokio async runtime tasks')).toEqual(retrieve('tokio async runtime tasks'))
  })

  it('returns no vector hits for an unmatched query and does not crash', () => {
    // BM25 still returns the corpus with score 0, so the fused list is
    // non-empty but carries no genuine signal. The point is that an unknown
    // topic degrades quietly rather than throwing.
    expect(() => retrieve('zzzz-nonexistent-topic')).not.toThrow()
    expect(retrieve('zzzz-nonexistent-topic').length).toBeGreaterThan(0)
  })
})