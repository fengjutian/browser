export interface RetrievalCandidate {
  documentId: string
  chunkIndex: number
  excerpt: string
  score?: number
}

export interface HybridRetrievalHit extends RetrievalCandidate {
  rrfScore: number
  keywordRank?: number
  vectorRank?: number
}

export interface CitationValidation {
  valid: boolean
  citedIds: number[]
  unknownIds: number[]
  uncitedStatements: string[]
}

export interface RetrievalEvaluationCase {
  relevantDocumentIds: readonly string[]
  retrievedDocumentIds: readonly string[]
}

export interface RetrievalMetrics {
  recallAtK: number
  meanReciprocalRank: number
  evaluatedCases: number
}

const citationPattern = /\[doc-(\d+)\]/g
const hasCitationPattern = /\[doc-\d+\]/

function candidateKey(candidate: RetrievalCandidate): string {
  return `${candidate.documentId}\u0000${candidate.chunkIndex}`
}

/** Fuse independently ranked keyword/vector results using reciprocal-rank fusion. */
export function reciprocalRankFusion(
  keyword: readonly RetrievalCandidate[],
  vector: readonly RetrievalCandidate[],
  options: { k?: number; limit?: number; maxChunksPerDocument?: number } = {},
): HybridRetrievalHit[] {
  const k = Math.max(1, options.k ?? 60)
  const limit = Math.max(1, options.limit ?? 8)
  const maxChunksPerDocument = Math.max(1, options.maxChunksPerDocument ?? 2)
  const fused = new Map<string, HybridRetrievalHit>()

  const add = (candidate: RetrievalCandidate, rank: number, source: 'keyword' | 'vector') => {
    const key = candidateKey(candidate)
    const current = fused.get(key) ?? { ...candidate, rrfScore: 0 }
    current.rrfScore += 1 / (k + rank)
    if (source === 'keyword') current.keywordRank = rank
    else current.vectorRank = rank
    if (!current.excerpt && candidate.excerpt) current.excerpt = candidate.excerpt
    fused.set(key, current)
  }

  keyword.forEach((candidate, index) => add(candidate, index + 1, 'keyword'))
  vector.forEach((candidate, index) => add(candidate, index + 1, 'vector'))

  const perDocument = new Map<string, number>()
  return [...fused.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore
      || (right.score ?? 0) - (left.score ?? 0)
      || left.documentId.localeCompare(right.documentId)
      || left.chunkIndex - right.chunkIndex)
    .filter(candidate => {
      const count = perDocument.get(candidate.documentId) ?? 0
      if (count >= maxChunksPerDocument) return false
      perDocument.set(candidate.documentId, count + 1)
      return true
    })
    .slice(0, limit)
}

/** Validate that every factual-looking statement cites a supplied context item. */
export function validateAnswerCitations(answer: string, availableCitationIds: readonly number[]): CitationValidation {
  const available = new Set(availableCitationIds)
  const citedIds = Array.from(new Set(
    Array.from(answer.matchAll(citationPattern), match => Number(match[1]))
      .filter(id => Number.isInteger(id) && id > 0),
  ))
  const unknownIds = citedIds.filter(id => !available.has(id))
  const statements = answer.match(/[^。！？.!?\n]+[。！？.!?]?(?:\s*\[doc-\d+\])*/g) ?? []
  const uncitedStatements = statements
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0)
    .filter(statement => !/^知识库中未找到相关信息[。.]?$/.test(statement))
    .filter(statement => /[\p{L}\p{N}]/u.test(statement))
    .filter(statement => !hasCitationPattern.test(statement))
  return {
    valid: unknownIds.length === 0 && uncitedStatements.length === 0,
    citedIds,
    unknownIds,
    uncitedStatements,
  }
}

/** Compute retrieval Recall@K and MRR over a small deterministic evaluation set. */
export function evaluateRetrieval(cases: readonly RetrievalEvaluationCase[], k: number): RetrievalMetrics {
  const cutoff = Math.max(1, k)
  if (cases.length === 0) return { recallAtK: 0, meanReciprocalRank: 0, evaluatedCases: 0 }
  let recall = 0
  let reciprocalRank = 0

  for (const item of cases) {
    const relevant = new Set(item.relevantDocumentIds)
    const retrieved = item.retrievedDocumentIds.slice(0, cutoff)
    const hits = new Set(retrieved.filter(id => relevant.has(id)))
    recall += relevant.size === 0 ? 1 : hits.size / relevant.size
    const firstRelevant = retrieved.findIndex(id => relevant.has(id))
    reciprocalRank += firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1)
  }

  return {
    recallAtK: recall / cases.length,
    meanReciprocalRank: reciprocalRank / cases.length,
    evaluatedCases: cases.length,
  }
}
