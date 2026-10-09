import { rankByBm25 } from './bm25'
import { evaluateRetrieval, reciprocalRankFusion, type RetrievalCandidate, type RetrievalEvaluationCase } from './rag'

/**
 * A small, deterministic corpus for retrieval quality checks.
 *
 * Kept inline (rather than fixture files) so the evaluation is hermetic: no
 * network, no database, no provider, and identical results on every run.
 */
export interface EvalDocument {
  id: string
  title: string
  body: string
  /** Deterministic pseudo-embedding: unit vectors over hashed terms. */
  terms: string[]
}

export const EVAL_CORPUS: readonly EvalDocument[] = [
  {
    id: 'doc-tokio',
    title: 'Tokio task runtime',
    body: 'The tokio runtime schedules asynchronous tasks across worker threads and drives futures to completion.',
    terms: ['tokio', 'runtime', 'async', 'tasks', 'futures', 'threads'],
  },
  {
    id: 'doc-sqlite',
    title: 'SQLite FTS5 indexing',
    body: 'FTS5 builds an inverted index in SQLite so full text search returns ranked matches quickly.',
    terms: ['sqlite', 'fts5', 'index', 'search', 'ranked', 'inverted'],
  },
  {
    id: 'doc-wasm',
    title: 'WebAssembly component model',
    body: 'The WebAssembly component model defines typed interfaces between hosts and guests, including events.',
    terms: ['webassembly', 'component', 'model', 'interfaces', 'host', 'guest', 'events'],
  },
  {
    id: 'doc-react',
    title: 'React rendering model',
    body: 'React re-renders a component tree and reconciles elements to update the DOM efficiently.',
    terms: ['react', 'rendering', 'components', 'reconciliation', 'dom', 'updates'],
  },
  {
    id: 'doc-raft',
    title: 'Raft consensus algorithm',
    body: 'Raft elects a leader and replicates log entries so a cluster agrees on an ordered sequence.',
    terms: ['raft', 'consensus', 'leader', 'log', 'replication', 'cluster'],
  },
]

export const EVAL_CASES: readonly { query: string; relevant: string[] }[] = [
  { query: 'tokio async runtime tasks', relevant: ['doc-tokio'] },
  { query: 'sqlite full text search index', relevant: ['doc-sqlite'] },
  { query: 'webassembly component host guest', relevant: ['doc-wasm'] },
  { query: 'react reconciliation dom', relevant: ['doc-react'] },
  { query: 'raft leader replication consensus', relevant: ['doc-raft'] },
]

/** Build a keyword candidate list for a query, mirroring the production BM25 path. */
export function keywordCandidates(query: string): RetrievalCandidate[] {
  const ranked = rankByBm25(query, EVAL_CORPUS, doc => `${doc.title}\n${doc.body}`)
  return ranked.map((item, index) => ({
    documentId: item.document.id,
    chunkIndex: 0,
    excerpt: '',
    score: 1 / (index + 1),
  }))
}

/** Build a deterministic vector candidate list from exact term overlap. */
export function vectorCandidates(query: string): RetrievalCandidate[] {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return EVAL_CORPUS.map(doc => {
    const overlap = doc.terms.filter(term => queryTerms.includes(term)).length
    return { documentId: doc.id, chunkIndex: 0, excerpt: '', score: overlap / Math.max(1, queryTerms.length) }
  })
    .filter(item => (item.score ?? 0) > 0)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
}

/** Run the full hybrid retrieval stack for one query. */
export function retrieve(query: string, limit = 3): string[] {
  return reciprocalRankFusion(keywordCandidates(query), vectorCandidates(query), {
    limit,
    maxChunksPerDocument: 3,
  }).map(hit => hit.documentId)
}

/** Evaluate the hybrid retriever over {@link EVAL_CASES}. */
export function evaluateHybridRetrieval(k = 3): ReturnType<typeof evaluateRetrieval> {
  const cases: RetrievalEvaluationCase[] = EVAL_CASES.map(item => ({
    relevantDocumentIds: item.relevant,
    retrievedDocumentIds: retrieve(item.query, k),
  }))
  return evaluateRetrieval(cases, k)
}