/**
 * Lightweight BM25 scorer for the cross-document ask prompt.
 *
 * Why BM25 here: when the local knowledge base grows past a few dozen
 * documents, sending every full markdown into the prompt blows past the
 * model context. BM25 lets us keep the documents most relevant to the
 * question and drop the rest, while still being explainable (term-frequency
 * based, no embeddings required).
 *
 * Tokenisation mixes English / numeric word splits with CJK bigrams so a
 * single tokenizer handles Chinese, English, and mixed content without a
 * full segmentation dictionary.
 */

export const BM25_K1 = 1.5
export const BM25_B = 0.75

const WORD_RE = /[a-z0-9_]+/g
const CJK_RE = /[\u4e00-\u9fff]+/g

function bigrams(segment: string): string[] {
  const result: string[] = []
  for (let i = 0; i < segment.length - 1; i++) {
    result.push(segment.slice(i, i + 2))
  }
  return result
}

export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase()
  const tokens: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  WORD_RE.lastIndex = 0
  while ((match = WORD_RE.exec(lowered)) !== null) {
    if (match.index > cursor) {
      const gap = lowered.slice(cursor, match.index)
      const cjk = gap.match(CJK_RE)
      if (cjk) cjk.forEach(seg => tokens.push(...bigrams(seg)))
    }
    tokens.push(match[0])
    cursor = match.index + match[0].length
  }
  if (cursor < lowered.length) {
    const tail = lowered.slice(cursor)
    const cjk = tail.match(CJK_RE)
    if (cjk) cjk.forEach(seg => tokens.push(...bigrams(seg)))
  }
  return tokens
}

export interface ScoredDocument<T> {
  document: T
  originalIndex: number
  score: number
}

export function rankByBm25<T>(
  query: string,
  documents: readonly T[],
  getText: (doc: T) => string,
): ScoredDocument<T>[] {
  const queryTokens = Array.from(new Set(tokenize(query)))
  if (queryTokens.length === 0) {
    return documents.map((doc, index) => ({ document: doc, originalIndex: index, score: 0 }))
  }

  const docTerms = documents.map((doc, index) => {
    const tokens = tokenize(getText(doc))
    const termFreq = new Map<string, number>()
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1)
    }
    return { tokens, termFreq, length: tokens.length, index }
  })

  const totalLength = docTerms.reduce((sum, term) => sum + term.length, 0)
  const averageLength = docTerms.length === 0 ? 0 : totalLength / docTerms.length

  const documentFrequency = new Map<string, number>()
  for (const term of docTerms) {
    for (const token of term.termFreq.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }

  const totalDocs = docTerms.length

  const scored: ScoredDocument<T>[] = docTerms.map(term => {
    let score = 0
    for (const qt of queryTokens) {
      const frequency = term.termFreq.get(qt) ?? 0
      if (frequency === 0) continue
      const df = documentFrequency.get(qt) ?? 0
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))
      const numerator = frequency * (BM25_K1 + 1)
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (averageLength === 0 ? 0 : term.length / averageLength))
      score += idf * (numerator / denominator)
    }
    return { document: documents[term.index], originalIndex: term.index, score }
  })

  return scored.sort((a, b) => b.score - a.score)
}
