import type { BrowserTab } from '../../types'

/**
 * Pure fuzzy search over the tab list. We deliberately use a tiny, dependency-
 * free scoring function (subsequence match with weighted bonuses) so the
 * palette works offline and tests run without `node_modules` bootstrapping.
 */

export interface TabSearchEntry {
  id: string
  title: string
  url: string
  loading: boolean
  active: boolean
  pinned: boolean
  private?: boolean
}

export interface TabSearchResult extends TabSearchEntry {
  /** Higher score → ranked higher. 0 means the entry was filtered out. */
  score: number
  /** Highlight ranges inside the title — pairs of [start, end) indices. */
  titleHighlights: ReadonlyArray<[number, number]>
  /** Highlight ranges inside the url. */
  urlHighlights: ReadonlyArray<[number, number]>
}

export interface TabSearchOptions {
  /** Hard cap on the number of returned rows. */
  limit?: number
  /** Score below this is filtered out (default 1). */
  minScore?: number
  /** When true, pinned tabs always rank above non-pinned at equal score. */
  boostPinned?: boolean
}

const DEFAULT_LIMIT = 12
const DEFAULT_MIN_SCORE = 1

/**
 * Subsequence match: characters in `query` must appear in `text` in order.
 * Returns the matched spans (for UI) and a numeric score that rewards:
 *   - prefix matches
 *   - consecutive characters
 *   - shorter strings (less filler to read)
 */
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
      if (ti === qi) score += 12 // prefix bonus
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
  // Penalise long candidates so the exact match outranks a long substring hit.
  score -= Math.min(text.length, 200) / 4
  return { score, spans }
}

function entryOf(tab: BrowserTab): TabSearchEntry {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    active: tab.active,
    pinned: tab.pinned,
    private: tab.private,
  }
}

export function searchTabs(query: string, tabs: BrowserTab[], options: TabSearchOptions = {}): TabSearchResult[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const boostPinned = options.boostPinned ?? true
  const trimmed = query.trim()

  if (!trimmed) {
    // No query → show a sensible "switch to…" list (active first, then pinned,
    // then most recently used). The caller is responsible for ordering by
    // lastActiveAt if it has the data.
    return tabs.slice(0, limit).map(tab => ({
      ...entryOf(tab),
      score: tab.active ? 100 : tab.pinned && boostPinned ? 50 : 0,
      titleHighlights: [],
      urlHighlights: [],
    }))
  }

  const ranked: TabSearchResult[] = []
  for (const tab of tabs) {
    const title = scoreText(tab.title ?? '', trimmed)
    const url = scoreText(tab.url ?? '', trimmed)
    if (!title && !url) continue
    let score = 0
    const titleHighlights = title?.spans ?? []
    const urlHighlights = url?.spans ?? []
    if (title) score += title.score * 1.4 // title weight outranks url
    if (url) score += url.score
    if (score < minScore) continue
    if (tab.active) score += 30
    if (tab.pinned && boostPinned) score += 12
    if (tab.private) score -= 1 // mild demotion but still shown
    ranked.push({
      ...entryOf(tab),
      score,
      titleHighlights,
      urlHighlights,
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}