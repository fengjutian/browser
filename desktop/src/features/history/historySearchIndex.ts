import type { HistoryEntry } from './dedupeHistory'

/**
 * Pure fuzzy search over the browser history. Reuses the scoring logic from
 * `features/browser/tabSearchIndex` so titles / urls behave the same way the
 * user already learned in the tab search palette.
 */

export interface HistorySearchResult extends HistoryEntry {
  /** Higher score → ranked higher. */
  score: number
  /** Highlight spans inside the title — pairs of [start, end). */
  titleHighlights: ReadonlyArray<[number, number]>
  /** Highlight spans inside the url. */
  urlHighlights: ReadonlyArray<[number, number]>
}

export interface HistorySearchOptions {
  limit?: number
  minScore?: number
}

const DEFAULT_LIMIT = 30
const DEFAULT_MIN_SCORE = 1

function scoreText(text: string, query: string): { score: number; spans: Array<[number, number]> } | null {
  if (!text || !query) return null
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerText === lowerQuery) return { score: 1000, spans: [[0, text.length]] }

  let ti = 0
  let qi = 0
  let score = 0
  const spans: Array<[number, number]> = []
  let spanStart = -1
  let consecutive = 0
  while (ti < lowerText.length && qi < lowerQuery.length) {
    if (lowerText[ti] === lowerQuery[qi]) {
      if (spanStart < 0) spanStart = ti
      consecutive += 1
      score += 5 + consecutive
      if (ti === qi) score += 12
      ti += 1
      qi += 1
      if (qi === lowerQuery.length) {
        spans.push([spanStart, ti])
        break
      }
    } else {
      if (spanStart >= 0) {
        spans.push([spanStart, ti])
        spanStart = -1
        consecutive = 0
      }
      ti += 1
    }
  }
  if (qi < lowerQuery.length) return null
  score -= Math.min(text.length, 200) / 4
  return { score, spans }
}

export function searchHistory(query: string, entries: HistoryEntry[], options: HistorySearchOptions = {}): HistorySearchResult[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const trimmed = query.trim()
  if (!trimmed) return entries.slice(0, limit).map(entry => ({ ...entry, score: 0, titleHighlights: [], urlHighlights: [] }))

  const ranked: HistorySearchResult[] = []
  for (const entry of entries) {
    const title = scoreText(entry.title ?? '', trimmed)
    const url = scoreText(entry.url ?? '', trimmed)
    if (!title && !url) continue
    let score = 0
    if (title) score += title.score * 1.4
    if (url) score += url.score
    if (score < minScore) continue
    // Slight recency boost: visited within the last hour climbs 8 points.
    const ageMs = Date.now() - entry.visitedAt
    if (ageMs >= 0 && ageMs < 60 * 60_000) score += 8
    ranked.push({
      ...entry,
      score,
      titleHighlights: title?.spans ?? [],
      urlHighlights: url?.spans ?? [],
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}